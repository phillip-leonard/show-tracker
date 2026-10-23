/**
 * admin-resync-setlists — walks every user's shows, finds the ones whose
 * artist resolves to a band source, and re-fetches their setlists from that
 * source.
 *
 * Shaped after admin-populate-setlist.js: admin-only, Authorization: Bearer
 * {idToken} verified against ADMIN_EMAILS, CORS headers, firebase-admin
 * server-side.
 *
 * POST body:
 *   {
 *     dryRun?: boolean,   // DEFAULT TRUE. See below.
 *     limit?: number,     // max shows to consider (default 25, max 1000)
 *     userId?: string,    // restrict to one account
 *     source?: string,    // restrict to one band source id
 *     delayMs?: number,   // override the inter-request delay
 *     cursor?: string,    // resume token from a previous run's nextCursor
 *     budgetMs?: number,  // override the time budget (see the constants)
 *     skipShowIds?: string[],    // shows to leave alone, by show id
 *     excludeUserIds?: string[], // accounts to leave alone, by uid
 *     includeTestAccounts?: boolean, // default false; see below
 *   }
 *
 * ── Who is walked ─────────────────────────────────────────────────────
 *
 * Users are listed with listDocuments(), not collection('users').get().
 * A user's `users/{uid}` document does not exist in production: a show is
 * written to users/{uid}/shows/{id} and nothing ever writes the parent, and
 * a query only returns documents that exist. Until 5.47.7 this walk asked
 * the query, got zero users, and every run, dry or not, scanned nothing.
 *
 * The App Review accounts are left out unless `includeTestAccounts: true`:
 * a profile whose handle is in REVIEW_ACCOUNT_HANDLES or that is marked
 * `isTestUser`, and any show whose id starts with `seed-` (written by
 * scripts/seed-review-account.js). Their setlists are fixtures Apple's
 * reviewers see; a re-sync would rewrite them. Each exclusion is listed in
 * the report's `excluded`.
 *
 * ── dryRun defaults to TRUE, on purpose ──────────────────────────────
 *
 * This is a data migration over show documents people care about. The
 * default has to be the harmless one, so that forgetting a parameter
 * reports a plan instead of rewriting a few thousand setlists. Writing
 * requires `dryRun: false` explicitly.
 *
 * A dry run writes NOTHING and returns, per show: user, show id, date,
 * venue, current source, current song count, incoming song count, and the
 * diff summary from lib/bandSetlistMerge — songs added, songs removed,
 * songs whose set or position changed, fields newly populated, and what
 * user-authored data was carried over. That summary is produced by the same
 * merge rule a real run would use, so the plan is not an approximation of
 * what would happen; it is what would happen.
 *
 * ── Rate limiting ─────────────────────────────────────────────────────
 *
 * elgoose.net and phish.net are small community projects and this walks
 * every show in the database. Two things keep that civil:
 *
 *   1. The cache in band-setlist.js means each distinct (source, date) is
 *      fetched upstream once, however many users attended that night. On a
 *      jam-band tracker that is a big multiplier — a Goose run at the Cap
 *      might be logged by dozens of users and costs one request.
 *   2. DEFAULT_DELAY_MS between requests, skipped entirely on a cache hit
 *      since that never touches the upstream host. See the note on the
 *      constants below for why this is 300ms and not the 1200ms the first
 *      version used.
 *
 * Internet Archive (Grateful Dead) shows are different in three ways: the
 * lookup runs in-process with a 1-second gap between Archive requests (see
 * fetchSetlistFor); a live run writes a `setlistProposal` for the user to
 * accept, never the setlist itself (see buildProposal); and the whole
 * source is skipped when config/internet-archive.json has it switched off.
 *
 * A Netlify function is killed at 10 seconds, so a full backfill runs as
 * several invocations rather than one. Each returns `truncated: true` and a
 * `nextCursor`; pass that back as `cursor` to resume exactly where it
 * stopped. The walk stops on its own time budget before Netlify kills it,
 * so a truncated run still returns its report.
 */

const https = require('https');

const archiveAdapter = require('./lib/archiveAdapter');
const { mergeBandSetlist, describeSummary, titleAliasesFor } = require('./lib/bandSetlistMergeRule');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Fitting inside a Netlify function's execution window ─────────────
//
// A Netlify synchronous function is killed at 10 seconds by default, and
// nothing in netlify.toml raises it. That constraint dictates these
// numbers, and the first version of this file got them badly wrong: a
// 1200ms delay with a default limit of 50 meant 60 seconds of sleeping
// alone, so the function was guaranteed to be killed at 10s having
// processed about eight shows — and because the report is only returned at
// the very end, the caller got a 502 and NOTHING. Every invocation was
// wasted work, and a real run (dryRun:false) would have written a partial
// set of changes and then died without reporting which ones.
//
// So: 300ms, which is what every other admin function in this repo uses
// against setlist.fm, and a hard time budget that stops the walk cleanly
// and returns the partial report with a resumable cursor. The politeness
// argument for 1200ms was weaker than it looked — the real protection
// against hammering elgoose.net is the cache in band-setlist.js, which
// fetches each distinct date once however many users attended that night,
// and the delay only applies on a cache miss.
//
// A full backfill is therefore several invocations, each resuming from the
// previous one's `nextCursor`. If that becomes tedious, the proper fix is
// to rename this to admin-resync-setlists-background.js: Netlify gives a
// background function 15 minutes instead of 10 seconds. That changes how
// it is invoked (202 immediately, results only in the logs), which is why
// it is not done here — a dry run you can read the output of is the whole
// point of this endpoint.
// The App Review demo accounts (scripts/seed-review-account.js).
const REVIEW_ACCOUNT_HANDLES = ['alexreviewer', 'jordanmills'];
const SEED_SHOW_ID_PREFIX = 'seed-';

const DEFAULT_DELAY_MS = 300;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;

// Leaves ~2s of headroom under Netlify's 10s default to serialize and
// return the report. Overridable for a deployment configured with a longer
// timeout, or for local runs where there is no limit at all.
const DEFAULT_BUDGET_MS = 8000;

// How many distinct artist strings the report will name. Enough to read a
// whole account's Goose spellings, small enough not to dump a library.
const MAX_ARTISTS_REPORTED = 40;

// ── The artist → source registry, mirrored for CommonJS ───────────────
//
// lib/setlistSources.js is the registry, but it is an ESM module written
// against the `@/lib` alias and this is a Netlify function with no build
// step to resolve it — the same situation festivalMatchRule.js exists for.
// This is deliberately the *minimum* mirror: the name keys and nothing
// else, because that is all a server-side walk over show documents needs
// (show docs store a plain artist string with no mbid, so the mbid branch
// of resolveSource can never fire here).
//
// KEEP IN STEP with SETLIST_SOURCES in lib/setlistSources.js. Adding a
// source or an act there means adding it here too.
//
// Grateful Dead is here only while config/internet-archive.json has
// `enabled: true`, read through the adapter so the switch has one meaning
// everywhere. Off, the walk treats Grateful Dead shows as setlist.fm shows
// and sends the Archive nothing.
function bandSourceNameKeys(archiveEnabled = archiveAdapter.isEnabled()) {
  return {
    goose: { source: 'elgoose', artistId: 'goose' },
    phish: { source: 'phishnet', artistId: '1' },
    ...(archiveEnabled ? { 'grateful-dead': { source: 'archive', artistId: archiveAdapter.COLLECTION } } : {}),
  };
}

// artistKeyFor's name branch, from lib/wishlist.js, with the same
// leading trim artistNameKey in lib/setlistSources.js applies — and for the
// same reason: artistKeyFor collapses whitespace to hyphens *before* it
// trims, so an untrimmed "  Goose  " becomes "-goose-" and matches nothing.
function artistNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

// The loose second pass, mirroring artistNameKeyLoose in
// lib/setlistSources.js: bracketed qualifiers and a leading article
// removed, so "Goose (US)" and "The Goose" reach El Goose too. See that
// file for why this exists — an exact-only key is what made a stored
// artist string of "Goose (US)" resolve to setlist.fm and every part of
// this feature quietly do nothing.
function artistNameKeyLoose(name) {
  return artistNameKey(
    String(name || '')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      .trim()
      .replace(/^the\s+/i, '')
  );
}

// ── toIsoDate, mirrored from lib/utils.js ─────────────────────────────
// Show documents do not all store dates the same way: the ticket scanner
// saved setlist.fm's DD-MM-YYYY verbatim while every other add path
// reversed it into YYYY-MM-DD. parseDate reads both, so such a show
// displays correctly in the app — and then this walk asked the archive
// about "28-05-2025", which no archive has. Normalized before the request,
// with the same reading of an ambiguous DD-MM-YYYY the app uses.
function toIsoDate(value) {
  const str = String(value == null ? '' : value).trim();
  if (!str) return '';

  const ddmmyyyy = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return str;

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function resolveBandSource(artist, nameKeys = bandSourceNameKeys()) {
  const BAND_SOURCE_NAME_KEYS = nameKeys;
  const key = artistNameKey(artist);
  if (BAND_SOURCE_NAME_KEYS[key]) return { ...BAND_SOURCE_NAME_KEYS[key], matchedOn: 'name', nameKey: key };

  const loose = artistNameKeyLoose(artist);
  if (loose && loose !== key && BAND_SOURCE_NAME_KEYS[loose]) {
    return { ...BAND_SOURCE_NAME_KEYS[loose], matchedOn: 'name-loose', nameKey: loose };
  }

  return null;
}

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

async function verifyAdmin(token) {
  initFirebase();
  const { getAuth } = require('firebase-admin/auth');
  const decoded = await getAuth().verifyIdToken(token);
  if (!ADMIN_EMAILS.includes(decoded.email)) throw new Error('Forbidden');
  return decoded;
}

/**
 * Calls our own band-setlist function rather than the adapters directly, so
 * the backfill goes through the same cache, the same TTL ceiling, the same
 * disambiguation and the same key handling as every other caller. One code
 * path to the upstream, not two.
 */
function fetchViaBandSetlistFunction({ baseUrl, source, artist, date, venue, artistId }) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ source, artist, date });
    if (venue) params.set('venue', venue);
    if (artistId) params.set('artistId', artistId);

    const url = new URL(`${baseUrl}/api/band-setlist?${params.toString()}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}?${url.search.replace(/^\?/, '')}`,
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'MySetlists/5.33 (admin-resync)' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              cache: res.headers['x-cache'] || '',
              data: JSON.parse(data),
            });
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The Internet Archive, in-process ──────────────────────────────────
//
// An Archive lookup is up to five requests to archive.org, and over HTTP
// each one rode inside band-setlist.js's own 10-second window: one slow
// date was a 502 and a lost row. So the walk calls band-setlist.js's
// handler in-process instead — the same cache, the same show selection,
// the same response — with the adapter's request gap set, so the Archive
// never gets more than one request a second however many shows are
// walked. The other sources keep the HTTP path above.
const ARCHIVE_REQUEST_GAP_MS = 1000;

const bandSetlistFunction = require('./band-setlist');

async function fetchSetlistFor(args) {
  if (args.source !== 'archive') return fetchViaBandSetlistFunction(args);
  const params = { source: 'archive', artist: args.artist, date: args.date, artistId: args.artistId };
  if (args.venue) params.venue = args.venue;
  const res = await bandSetlistFunction.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: params });
  let data = null;
  try { data = JSON.parse(res.body); } catch (e) { throw new Error(`Parse error: ${e.message}`); }
  return { statusCode: res.statusCode, cache: (res.headers && res.headers['X-Cache']) || '', data };
}

// ── Proposals, not writes ─────────────────────────────────────────────
//
// An Archive setlist is reconstructed from tapes, so a live run never
// writes one over a show's setlist. It writes `setlistProposal` on the
// show instead — the incoming setlist, where it came from, and the diff —
// and the app asks the user ("Update setlist from the Internet Archive?").
// Accepting re-runs the merge against the setlist as it is then. A
// proposal the user declined for this same recording is not offered again.
function buildProposal(data, summary, picked, nowIso) {
  return {
    source: 'archive',
    status: 'pending',
    createdAt: nowIso,
    songs: picked.songs || data.songs || [],
    sourceShowId: picked.sourceShowId || '',
    sourcePermalink: picked.sourcePermalink || '',
    setlistNotes: picked.setlistNotes || '',
    licenseUrl: picked.licenseUrl == null ? null : picked.licenseUrl,
    needsReview: !!picked.needsReview,
    disagreement: picked.disagreement || null,
    confidence: picked.confidence || '',
    parsedFrom: picked.parsedFrom || '',
    partial: !!picked.partial,
    sourceType: picked.sourceType || '',
    showSlot: picked.showSlot || '',
    summary: {
      existingCount: summary.existingCount,
      incomingCount: summary.incomingCount,
      resultCount: summary.resultCount,
      added: summary.added,
      removed: summary.removed,
      movedSet: summary.movedSet,
      movedPosition: summary.movedPosition,
      keptManual: summary.keptManual,
      keptNotInSource: summary.keptNotInSource || [],
      carriedOver: summary.carriedOver,
    },
  };
}

// The user already decided about this recording: kept their own setlist
// over it, accepted it, or was blocked by the stats check. Not offered
// again; a different recording of the show would be.
function declinedSame(show, data) {
  const p = show.setlistProposal;
  return !!p && ['declined', 'accepted', 'blocked'].includes(p.status) && !!p.sourceShowId && p.sourceShowId === data.sourceShowId;
}

/**
 * runResync(body, { defaultBudgetMs }) -> { report } | { error, report }
 *
 * The walk itself, apart from the HTTP handler, so the same walk runs in
 * three places: this function (10 seconds, resumable by cursor),
 * admin-resync-setlists-background.js (15 minutes, report saved to
 * Firestore), and scripts/archive-resync-dry-run.js (local, dry run only).
 * `body` is the POST body described at the top of this file.
 */
async function runResync(body, { defaultBudgetMs = DEFAULT_BUDGET_MS } = {}) {
  initFirebase();

  // `=== false` rather than a truthy read. `dryRun: false` is the ONLY
  // thing that turns writing on — a missing field, a null, an empty string
  // or the string "false" all leave it a dry run. Getting this backwards
  // would rewrite production setlists on a malformed request.
  const dryRun = body.dryRun !== false;

  const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const onlyUserId = body.userId || null;
  const onlySource = body.source || null;
  const delayMs = Number.isFinite(Number(body.delayMs)) ? Math.max(0, Number(body.delayMs)) : DEFAULT_DELAY_MS;
  const budgetMs = Number.isFinite(Number(body.budgetMs)) ? Math.max(1000, Number(body.budgetMs)) : defaultBudgetMs;

  // Resume token from a previous run's `nextCursor`: "<userId>::<showId>",
  // meaning "start at this user, after this show". Show ids are millisecond
  // timestamps as strings and Firestore orders documents by id, so both
  // halves page deterministically.
  const [cursorUserId, cursorShowId] = String(body.cursor || '').split('::');

  const asIdList = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const skipShowIds = new Set(asIdList(body.skipShowIds));
  const excludeUserIds = new Set(asIdList(body.excludeUserIds));
  const includeTestAccounts = body.includeTestAccounts === true;

  // Keyed by the raw artist string, so two spellings of the same band show
  // up as the two separate entries they are.
  const artistsSeen = new Map();

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > budgetMs;

  // Where to reach our own band-setlist function. Netlify sets URL/
  // DEPLOY_URL on the build; falls back to the production host.
  const baseUrl = (process.env.URL || process.env.DEPLOY_URL || 'https://mysetlists.net').replace(/\/$/, '');

  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();

  if ((!onlySource || onlySource === 'archive') && archiveAdapter.isEnabled()) {
    archiveAdapter.setRequestGap(ARCHIVE_REQUEST_GAP_MS);
  }

  const report = {
    dryRun,
    limit,
    delayMs,
    baseUrl,
    scannedUsers: 0,
    scannedShows: 0,
    bandSourceShows: 0,
    considered: 0,
    wouldChange: 0,
    changed: 0,
    unchanged: 0,
    // Internet Archive shows: a live run writes a proposal for each, never
    // the setlist itself.
    proposals: 0,
    needsReview: 0,
    declinedBefore: 0,
    // The interesting ones: a bad date, a side project the registry sends
    // to the wrong place, or an artist-name false positive (the Dutch
    // Goose). Reported separately rather than lumped in with "unchanged"
    // precisely because they are the list worth reading.
    // Every distinct artist string the walk saw, with the key it normalized
    // to and whether that key reached a band source. This is the answer to
    // the question the first two versions of this tool could not answer:
    // when bandSourceShows is 0, WHICH artist strings were scanned and what
    // did they key to? A stored "Goose (US)" keying to "goose-us" and
    // resolving to setlist.fm looks, without this, exactly like an account
    // with no Goose shows in it.
    artistsSeen: [],
    sourceReturnedNothing: [],
    ambiguousDates: [],
    // Accounts and shows left out, and why: excludeUserIds, the App Review
    // accounts, skipShowIds, seed fixtures.
    excluded: { users: [], shows: [] },
    errors: [],
    shows: [],
    truncated: false,
    // True when the walk stopped on its time budget rather than on `limit`.
    // Expected on a large database, not an error: resume with `nextCursor`.
    outOfTime: false,
    nextCursor: null,
    budgetMs,
  };

  try {
    const { FieldPath } = require('firebase-admin/firestore');

    // Users are walked in document-id order so a cursor means something.
    // `startAt` rather than `startAfter`: a cursor can point into the
    // middle of a user's shows, and that user still has shows left to do.
    // References, not snapshots: see "Who is walked" above. listDocuments
    // has no ordering guarantee, so the ids are sorted here for the cursor.
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const userDocs = (await db.collection('users').listDocuments())
      .sort(byId)
      .filter((ref) => (onlyUserId ? ref.id === onlyUserId : (!cursorUserId || ref.id >= cursorUserId)));

    // Why a user is left out, or null.
    const exclusionReason = async (userId) => {
      if (excludeUserIds.has(userId)) return 'excludeUserIds';
      if (includeTestAccounts) return null;
      const profile = (await db.collection('userProfiles').doc(userId).get()).data() || {};
      const handle = String(profile.handleLower || profile.handle || '').toLowerCase();
      if (REVIEW_ACCOUNT_HANDLES.includes(handle)) return `App Review account (@${handle})`;
      if (profile.isTestUser === true) return 'isTestUser';
      return null;
    };

    let processed = 0;

    // Records where to pick up: the last show actually looked at. Resuming
    // from it re-examines nothing and skips nothing.
    const markCursor = (userId, showId) => {
      report.truncated = true;
      report.nextCursor = `${userId}::${showId}`;
    };

    for (const userDoc of userDocs) {
      report.scannedUsers++;
      const userId = userDoc.id;

      const excludedBecause = await exclusionReason(userId);
      if (excludedBecause) {
        report.excluded.users.push({ userId, reason: excludedBecause });
        continue;
      }

      let showQuery = db.collection('users').doc(userId).collection('shows')
        .orderBy(FieldPath.documentId());
      // Only the user the cursor names resumes mid-way; every later user
      // starts from their first show.
      if (userId === cursorUserId && cursorShowId) {
        showQuery = showQuery.startAfter(cursorShowId);
      }
      const showsSnap = await showQuery.get();

      let lastShowId = null;

      for (const showDoc of showsSnap.docs) {
        // Two independent stops. `limit` is what the caller asked for;
        // the time budget is what Netlify's 10s window forces, and it is
        // the one that usually fires. Either way the report is returned
        // with a cursor rather than the function being killed mid-walk.
        if (processed >= limit) {
          // `lastShowId || ''` matters: breaking on a user's FIRST show
          // leaves nothing looked at yet, and the cursor has to mean
          // "start at this user, from the beginning" rather than being
          // omitted — an omitted cursor restarts the whole walk, which
          // would loop forever on a user with more shows than the budget.
          markCursor(userId, lastShowId || '');
          break;
        }
        if (outOfTime()) {
          report.outOfTime = true;
          markCursor(userId, lastShowId || '');
          break;
        }
        lastShowId = showDoc.id;

        report.scannedShows++;
        const show = showDoc.data();

        if (!show.artist || !show.date) continue;

        const resolved = resolveBandSource(show.artist);

        // Recorded for every show, matched or not, before the skip below.
        // Capped so a large account cannot turn the report into a listing
        // of its whole artist library.
        if (artistsSeen.size < MAX_ARTISTS_REPORTED || artistsSeen.has(show.artist)) {
          const seen = artistsSeen.get(show.artist) || {
            artist: show.artist,
            nameKey: artistNameKey(show.artist),
            looseKey: artistNameKeyLoose(show.artist),
            source: null,
            matchedOn: 'default',
            shows: 0,
          };
          seen.shows++;
          if (resolved) {
            seen.source = resolved.source;
            seen.matchedOn = resolved.matchedOn;
          }
          artistsSeen.set(show.artist, seen);
        }

        if (!resolved) continue;
        if (onlySource && resolved.source !== onlySource) continue;

        if (skipShowIds.has(showDoc.id)) {
          report.excluded.shows.push({ userId, showId: showDoc.id, date: show.date, reason: 'skipShowIds' });
          continue;
        }
        if (!includeTestAccounts && showDoc.id.startsWith(SEED_SHOW_ID_PREFIX)) {
          report.excluded.shows.push({ userId, showId: showDoc.id, date: show.date, reason: 'seed fixture' });
          continue;
        }

        report.bandSourceShows++;
        processed++;
        report.considered++;

        const isoDate = toIsoDate(show.date);

        const row = {
          userId,
          showId: showDoc.id,
          date: show.date,
          // Only present when the stored spelling was not already ISO, so
          // the report shows the conversion rather than hiding it.
          askedDate: isoDate && isoDate !== show.date ? isoDate : undefined,
          venue: show.venue || '',
          artist: show.artist,
          currentSource: show.setlistSource || 'setlistfm',
          incomingSource: resolved.source,
          currentSongCount: (show.setlist || []).length,
          incomingSongCount: 0,
          // What the user wrote on this show's songs, and what the merge
          // does with it. Read off the merge summary, so it is what a real
          // run would do.
          userNotes: {
            rated: (show.setlist || []).filter((x) => x.rating != null).length,
            commented: (show.setlist || []).filter((x) => typeof x.comment === 'string' ? x.comment.trim() !== '' : x.comment != null).length,
            ratingsCarried: 0,
            commentsCarried: 0,
            keptNotInSource: [],
          },
          selection: '',
          cache: '',
          summary: null,
          note: '',
        };

        try {
          if (!isoDate) {
            row.note = `unreadable date "${show.date}" — nothing was asked for`;
            report.sourceReturnedNothing.push({ ...row });
            report.errors.push({ userId, showId: showDoc.id, date: show.date, message: 'Unreadable date' });
            report.shows.push(row);
            continue;
          }

          const { statusCode, cache, data } = await fetchSetlistFor({
            baseUrl,
            source: resolved.source,
            artist: show.artist,
            date: isoDate,
            venue: show.venue,
            artistId: resolved.artistId,
          });

          row.cache = cache;

          if (statusCode !== 200 || !data || data.ok === false) {
            const message = (data && data.message) || `HTTP ${statusCode}`;
            row.note = `source error: ${message}`;
            report.sourceReturnedNothing.push({ ...row });
            report.errors.push({ userId, showId: showDoc.id, date: show.date, message });
          } else {
            const incoming = Array.isArray(data.songs) ? data.songs : [];
            row.incomingSongCount = incoming.length;
            row.selection = data.selection || '';

            // The band's title aliases, and on a date the source has more
            // than one show for, the contested shows: the existing setlist
            // chooses by song overlap, or nothing is written.
            const { setlist, changed, summary, chosenCandidate } = mergeBandSetlist(show.setlist || [], incoming, {
              aliases: titleAliasesFor(resolved.nameKey),
              candidates: data.contested,
            });
            row.summary = summary;
            if (chosenCandidate) row.incomingSongCount = (chosenCandidate.songs || []).length;
            row.userNotes.ratingsCarried = summary.carriedOver.rating || 0;
            row.userNotes.commentsCarried = summary.carriedOver.comment || 0;
            row.userNotes.keptNotInSource = summary.keptNotInSource || [];

            if (data.ambiguous) {
              row.note = summary.skipped === 'ambiguous-date'
                ? describeSummary(summary)
                : (summary.candidates?.reason === 'overlap'
                  ? `${data.message}; chose the show with ${Math.round(summary.candidates.scored[summary.candidates.chosen].overlap * 100)}% song overlap`
                  : (data.message || 'more than one show on this date'));
              report.ambiguousDates.push({ ...row, candidates: data.candidates || [] });
            }

            // Show-level fields from the show the merge actually used.
            const picked = chosenCandidate ? { ...data, ...chosenCandidate } : data;

            if (resolved.source === 'archive') {
              const notInSource = new Set(summary.keptNotInSource || []);
              row.archive = {
                identifier: picked.sourceShowId || '',
                confidence: picked.confidence || '',
                parsedFrom: picked.parsedFrom || '',
                partial: !!picked.partial,
                needsReview: !!picked.needsReview,
                disagreement: picked.disagreement || null,
                sourceType: picked.sourceType || '',
                showSlot: picked.showSlot || '',
                licenseUrl: picked.licenseUrl == null ? null : picked.licenseUrl,
                // A rating on a song the Archive's setlist doesn't list:
                // kept, flagged not-in-source, and named here so someone
                // can check whether it is a missing alias.
                ratingsNotMatched: (show.setlist || [])
                  .filter((x) => x.rating != null && notInSource.has(x.name))
                  .map((x) => ({ title: x.name, rating: x.rating })),
              };
            }

            if (!changed) {
              // The write-nothing rule. An empty incoming setlist, or a
              // date the existing setlist couldn't choose a show for (it is
              // already in ambiguousDates), leaves the document alone,
              // whether this is a dry run or not.
              if (summary.skipped !== 'ambiguous-date') {
                row.note = row.note || 'source returned no songs — leaving the existing setlist alone';
                report.sourceReturnedNothing.push({ ...row });
              }
              report.unchanged++;
            } else if (resolved.source === 'archive') {
              // Proposals only: see buildProposal. The show's setlist is
              // not touched by this walk, dry run or not.
              if (picked.needsReview) report.needsReview++;
              if (declinedSame(show, picked)) {
                report.declinedBefore++;
                row.note = 'the user kept their own setlist over this recording before; not offered again';
              } else if (dryRun) {
                report.wouldChange++;
                console.log(`[RESYNC dry] ${userId}/${showDoc.id} ${show.artist} ${show.date} — would propose ${picked.sourceShowId}: ${describeSummary(summary)}`);
              } else {
                await showDoc.ref.update({ setlistProposal: buildProposal(data, summary, picked, new Date().toISOString()) });
                report.proposals++;
                console.log(`[RESYNC proposal] ${userId}/${showDoc.id} ${show.artist} ${show.date} — ${picked.sourceShowId}: ${describeSummary(summary)}`);
              }
            } else if (dryRun) {
              report.wouldChange++;
              console.log(`[RESYNC dry] ${userId}/${showDoc.id} ${show.artist} ${show.date} — ${describeSummary(summary)}`);
            } else {
              await showDoc.ref.update({
                setlist,
                setlistSource: resolved.source,
                sourceShowId: picked.sourceShowId || '',
                sourcePermalink: picked.sourcePermalink || '',
                setlistNotes: picked.setlistNotes || '',
                setlistFetchedAt: new Date().toISOString(),
                isManual: false,
                ...(show.tour ? {} : (picked.tour ? { tour: picked.tour } : {})),
              });
              report.changed++;
              console.log(`[RESYNC write] ${userId}/${showDoc.id} ${show.artist} ${show.date} — ${describeSummary(summary)}`);
            }
          }
        } catch (err) {
          row.note = `fetch failed: ${err.message}`;
          report.errors.push({ userId, showId: showDoc.id, date: show.date, message: err.message });
        }

        report.shows.push(row);

        // Only pause when we actually went out to the upstream host. A
        // cache hit never touched elgoose.net or phish.net, so there is
        // nothing to be polite about.
        // The Archive's requests are spaced by the adapter's own gap.
        if (row.cache !== 'HIT' && delayMs > 0 && resolved.source !== 'archive') await sleep(delayMs);
      }

      if (report.truncated) break;
    }

    report.artistsSeen = [...artistsSeen.values()].sort((a, b) => b.shows - a.shows);

    return { report };
  } catch (err) {
    console.error('[RESYNC] Error:', err);
    return { error: err.message, report };
  } finally {
    archiveAdapter.setRequestGap(0);
  }
}

/**
 * authorizeAdmin(event) -> null when the caller is an admin, otherwise the
 * response to send. Shared with admin-resync-setlists-background.js.
 */
async function authorizeAdmin(event) {
  // ── Parsing the bearer token ──────────────────────────────────────
  // A regex rather than .replace('Bearer ', ''), which only strips the
  // prefix when exactly one space follows it. That cost real debugging
  // time: a caller whose $ID_TOKEN was unset sent `Authorization: Bearer`
  // with the trailing space trimmed, the prefix therefore did not match,
  // and the literal string "Bearer" became the token — non-empty, so it
  // passed the check below and failed verification instead, reporting
  // "Forbidden" for what was really a missing token. Also accepts a
  // lowercase scheme and extra whitespace, which are both legal.
  const rawAuth = (event.headers.authorization || '').trim();
  const token = /^Bearer\s+/i.test(rawAuth) ? rawAuth.replace(/^Bearer\s+/i, '').trim() : '';

  if (!token) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Unauthorized',
        // Named explicitly, because the two ways to get here look the same
        // from a shell and one of them is a typo.
        details: rawAuth
          ? 'The Authorization header carried no token after the Bearer scheme. If you are using a shell variable, check it is actually set.'
          : 'No Authorization header. Expected: Authorization: Bearer <firebase-id-token>',
      }),
    };
  }

  // ── Why this is not one bare catch ────────────────────────────────
  // verifyAdmin can fail three genuinely different ways, and collapsing
  // them into "Forbidden" sends you looking for a permissions problem when
  // the real one is a missing env var or an expired token. Same conflation
  // this file's readEnvelope sibling had, and just as misleading.
  try {
    await verifyAdmin(token);
  } catch (err) {
    const message = err?.message || '';

    if (message.includes('Firebase env vars not configured')) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Server misconfigured',
          details: 'FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID must be set on this deployment. This is not an authorization problem.',
        }),
      };
    }

    if (message === 'Forbidden') {
      // Verified successfully, but the email is not on ADMIN_EMAILS. The
      // only case that genuinely deserves a 403.
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Forbidden', details: 'That account is signed in but is not an admin.' }),
      };
    }

    // Anything else is the token itself: malformed, expired (Firebase ID
    // tokens last an hour), or issued for a different project.
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Invalid or expired token',
        details: 'Firebase ID tokens expire after an hour — fetch a fresh one and retry.',
        firebaseError: message,
      }),
    };
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const denied = await authorizeAdmin(event);
  if (denied) return denied;

  const { report, error } = await runResync(JSON.parse(event.body || '{}'));
  if (error) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error, partial: report }) };
  }
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(report) };
};

// For the tests: the registry mirror and the switch's effect on it.
exports.bandSourceNameKeys = bandSourceNameKeys;
exports.resolveBandSource = resolveBandSource;
exports.runResync = runResync;
exports.authorizeAdmin = authorizeAdmin;
exports.CORS_HEADERS = CORS_HEADERS;
