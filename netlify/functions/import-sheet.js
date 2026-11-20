/**
 * import-sheet — the CSV and Excel import for the native app (Stage 6,
 * F-10, call C). The web reads and matches in the browser with the same
 * modules; native has no Swift parser, so it sends the file here.
 * Stateless: the app keeps the table and sends it back with each step.
 *
 *   POST { action: 'parse', fileName, file }           file: base64, ≤ 2 MB
 *     200 { headers, rows, mapping, dateOrder, dateOrderAmbiguous, signature, truncated, columns }
 *   POST { action: 'plan', headers, rows, mapping, dateOrder, split: [rowIndex] }
 *     200 { shows: [{ rowIndex, part, key, artist, date, venue, city, state, country,
 *                     rating, comment, tour, ambiguousDate, problem, duplicate }], counts }
 *   POST { action: 'match', show }                      one planned show
 *     200 { status, reason, artist, sourceLabel, setlist: { count, source } | null,
 *           proposal, input | null, skip | null }
 *   Authorization: Bearer {idToken}
 *     400 bad input or an unreadable file · 401 · 403 account_required (guests)
 *     · 413 too big · 415 not a spreadsheet · 429 a daily limit (Retry-After)
 *
 * - parse: lib/sheetFile.js reads the file (CSV, or the first sheet of a
 *   workbook with SheetJS), capped at 2,000 data rows, 30 columns and 500
 *   characters a cell (`truncated` says so); lib/importSheet.js finds the
 *   columns and the date order.
 * - plan: lib/importSheet.js buildRows and planShows, the duplicates
 *   checked against the caller's stored shows, read here (classifyDuplicate).
 * - match: lib/importMatch.js matchShow for one show (a call stays well
 *   under Netlify's 10 seconds; the app paces 600 ms between calls, as the
 *   web does), the band source and search-setlists called in-process.
 *   `input` is the `csv-row` input to commit through normalize-show (the
 *   app mints the showId), or `skip` says why the show can't be saved.
 *
 * Accounts only (Stage 1: imports are for signed-in accounts). Each
 * action has a daily count per account; `match` also counts toward the
 * network's setlist.fm proxy limit, as the web's lookups do.
 */

const { corsHeaders: baseCors } = require('./lib/cors');
const { requireAccount } = require('./lib/requestAuth');
const { getDb } = require('./lib/firebaseAdmin');
const { takeDailyQuota } = require('./lib/rateLimit');
const { checkProxyLimit, internalProxyHeader } = require('./lib/proxyLimit');
const { userShows } = require('./lib/normalizeShowServer');
const {
  SHEET_LIMITS, SHEET_EXTENSIONS, extensionOf, csvTable, workbookTable, capTable,
} = require('../../lib/sheetFile');
const {
  IMPORT_COLUMNS, detectColumns, headerSignature, inferDateOrder, buildRows, planShows, showDataFor,
} = require('../../lib/importSheet');
const { createMatchContext, matchShow } = require('../../lib/importMatch');

// Per account per UTC day. A 2,000-row file is one parse, a few plans
// (each split or date-order change re-plans) and up to 2,000 matches.
const DAILY = { parse: 50, plan: 300, match: 3000 };
// setlist.fm allows about two requests a second per key, shared by
// everyone; one match makes up to four lookups.
const MATCH_GAP_MS = 550;
const FIELDS = IMPORT_COLUMNS.map((c) => c.key);
const MAX_TEXT = 200;
const MAX_COMMENT = 2000;

const MESSAGES = {
  type: 'That file type isn’t supported. Use a .csv or .xlsx file.',
  big: 'That file is over 2 MB. Split it into smaller files, or save it as .csv.',
  excel: 'Couldn’t read that Excel file. Try saving it again as .xlsx or .csv.',
  csv: 'Couldn’t read that file. Try saving it again as .csv.',
  empty: 'That file has no rows to import.',
  limit: 'That’s a lot of importing for one day. Please try again tomorrow.',
};

class Refused extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const str = (v, max = MAX_TEXT) => (v == null ? '' : String(v).trim().slice(0, max));

// ── parse ─────────────────────────────────────────────────────────────

function readFile({ fileName, file }, { XLSX } = {}) {
  const ext = extensionOf(fileName);
  if (!SHEET_EXTENSIONS.includes(ext)) throw new Refused(415, MESSAGES.type, 'bad_type');
  if (typeof file !== 'string' || !file) throw new Refused(400, MESSAGES.empty, 'empty');
  // Base64 is 4 characters for 3 bytes; checked before decoding anything.
  if (file.length > Math.ceil(SHEET_LIMITS.maxFileBytes / 3) * 4 + 4) throw new Refused(413, MESSAGES.big, 'too_large');
  const bytes = Buffer.from(file, 'base64');
  if (!bytes.length) throw new Refused(400, MESSAGES.empty, 'empty');
  if (bytes.length > SHEET_LIMITS.maxFileBytes) throw new Refused(413, MESSAGES.big, 'too_large');
  try {
    if (ext === 'csv' || ext === 'txt') return csvTable(bytes.toString('utf8'));
    return workbookTable(XLSX || require('xlsx'), bytes, { type: 'buffer' });
  } catch (e) {
    console.warn(`[import-sheet] ${ext} not read:`, e && e.message);
    throw new Refused(400, ext === 'csv' || ext === 'txt' ? MESSAGES.csv : MESSAGES.excel, 'unreadable');
  }
}

function parse(body, opts) {
  const { headers, rows, truncated } = capTable(readFile(body, opts));
  if (!headers.length || !rows.length) throw new Refused(400, MESSAGES.empty, 'empty');
  const mapping = detectColumns(headers);
  const dateOrder = inferDateOrder(rows.map((r) => r[mapping.date]));
  const dateOrderAmbiguous = mapping.date !== undefined
    && buildRows(rows, mapping, { order: dateOrder }).some((r) => r.date && r.date.ambiguous);
  return {
    headers, rows, mapping, dateOrder, dateOrderAmbiguous, signature: headerSignature(headers), truncated,
    columns: IMPORT_COLUMNS,
  };
}

// ── plan ──────────────────────────────────────────────────────────────

/** The table the app sends back, checked against parse's own caps. */
function tableFrom(body) {
  const { headers, rows } = body;
  if (!Array.isArray(headers) || !Array.isArray(rows)) throw new Refused(400, 'headers and rows are required.', 'bad_input');
  if (headers.length > SHEET_LIMITS.maxColumns || rows.length > SHEET_LIMITS.maxDataRows) {
    throw new Refused(413, 'That table is bigger than an import takes.', 'too_large');
  }
  const cellOk = (c) => typeof c === 'string' && c.length <= SHEET_LIMITS.maxCellChars;
  if (!headers.every(cellOk) || !rows.every((r) => Array.isArray(r) && r.length <= SHEET_LIMITS.maxColumns && r.every(cellOk))) {
    throw new Refused(400, 'The table isn’t in the shape parse returned.', 'bad_input');
  }
  const mapping = {};
  for (const [field, index] of Object.entries(body.mapping || {})) {
    if (!FIELDS.includes(field)) continue;
    if (!Number.isInteger(index) || index < 0 || index >= headers.length) throw new Refused(400, `The ${field} column isn’t in the file.`, 'bad_mapping');
    mapping[field] = index;
  }
  if (mapping.artist === undefined || mapping.date === undefined) throw new Refused(400, 'Choose the artist and date columns.', 'bad_mapping');
  const dateOrder = body.dateOrder === 'dmy' ? 'dmy' : 'mdy';
  const split = new Set((Array.isArray(body.split) ? body.split : []).filter((i) => Number.isInteger(i) && i >= 0 && i < rows.length));
  return { headers, rows, mapping, dateOrder, split };
}

async function plan(db, uid, body) {
  const { rows, mapping, dateOrder, split } = tableFrom(body);
  const built = buildRows(rows, mapping, { order: dateOrder });
  const existingShows = await userShows(db, uid);
  const planned = planShows(built, { split, existingShows });
  const shows = planned.map((s) => ({
    rowIndex: s.rowIndex,
    part: s.part,
    key: s.key,
    artist: s.artist || '',
    date: s.date || null,
    venue: s.venue || '',
    city: s.city || '',
    state: s.state || '',
    country: s.country || '',
    rating: s.rating == null ? null : s.rating,
    comment: s.comment || '',
    tour: s.tour || '',
    // Rows a split made share the row's flag; the app asks how the file
    // writes dates before importing any of them.
    ambiguousDate: !!(s.row && s.row.date && s.row.date.ambiguous),
    canSplit: !!(s.row && s.row.artists && s.row.artists.length > 1),
    problem: s.problem || '',
    duplicate: s.duplicate || null,
  }));
  const counts = {
    rows: rows.length,
    shows: shows.length,
    ready: shows.filter((s) => !s.problem && !s.duplicate).length,
    problems: shows.filter((s) => s.problem).length,
    duplicates: shows.filter((s) => s.duplicate).length,
    ambiguous: shows.filter((s) => s.ambiguousDate).length,
  };
  return { shows, counts };
}

// ── match ─────────────────────────────────────────────────────────────

/** One planned show, as plan returned it; only the fields a show keeps. */
function showFrom(body) {
  const s = body.show && typeof body.show === 'object' ? body.show : null;
  const date = s && typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : '';
  if (!s || !str(s.artist) || !date) throw new Refused(400, 'A show needs an artist and a date.', 'bad_input');
  const rating = Number.isInteger(s.rating) && s.rating >= 1 && s.rating <= 10 ? s.rating : null;
  return {
    artist: str(s.artist), date, venue: str(s.venue), city: str(s.city), state: str(s.state),
    country: str(s.country), rating, comment: str(s.comment, MAX_COMMENT), tour: str(s.tour),
  };
}

/** The two network reads, in-process with our own functions' code and caches. */
function serverMatchContext({ searchHandler, bandHandler } = {}) {
  const call = async (handler, params) => {
    const res = await handler({ httpMethod: 'GET', headers: { ...internalProxyHeader() }, queryStringParameters: params });
    let body = null;
    try { body = JSON.parse(res.body); } catch { body = null; }
    return { status: res.statusCode, body };
  };
  return createMatchContext({
    gapMs: MATCH_GAP_MS,
    searchSetlists: (params) => call(searchHandler || require('./search-setlists').handler, params),
    bandSetlistResponse: (params) => call(bandHandler || require('./band-setlist').handler, params),
  });
}

async function match(body, deps) {
  const show = showFrom(body);
  const m = await matchShow({ artist: show.artist, date: show.date, venue: show.venue }, serverMatchContext(deps));
  const data = showDataFor(show, m);
  return {
    status: m.status,
    reason: m.reason || '',
    artist: m.artist || show.artist,
    sourceLabel: m.sourceLabel || '',
    setlist: m.setlist && m.setlist.length ? { count: m.setlist.length, source: m.setlistSource || 'setlistfm' } : null,
    proposal: !!m.proposal,
    input: data.skip ? null : { kind: 'csv-row', ...data },
    skip: data.skip || null,
  };
}

// ── handler ───────────────────────────────────────────────────────────

// Replaced in the tests (__setTestDeps): SheetJS and the two handlers.
let testDeps = {};
function __setTestDeps(deps) { testDeps = deps || {}; }

const corsHeaders = (event) => baseCors(event, { methods: 'POST, OPTIONS' });

exports.handler = async function (event) {
  const headers = corsHeaders(event);
  const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...headers, ...extra }, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const user = await requireAccount(event, headers);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const action = body && body.action;
  if (!Object.prototype.hasOwnProperty.call(DAILY, action)) return reply(400, { error: 'Unknown action' });

  try {
    const db = getDb();
    if (action === 'match') {
      const refused = await checkProxyLimit(event, 'setlists', { db });
      if (refused) return refused;
    }
    if (!(await takeDailyQuota(db, `import_sheet_${action}_${user.uid}`, DAILY[action], { uid: user.uid })).allowed) {
      return reply(429, { error: MESSAGES.limit, code: 'daily_limit' }, { 'Retry-After': '3600' });
    }
    if (action === 'parse') return reply(200, parse(body, testDeps));
    if (action === 'plan') return reply(200, await plan(db, user.uid, body));
    return reply(200, await match(body, testDeps));
  } catch (e) {
    if (e instanceof Refused) return reply(e.status, { error: e.message, code: e.code });
    console.error(`[import-sheet] ${action} failed:`, e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.DAILY = DAILY;
exports.__setTestDeps = __setTestDeps;
