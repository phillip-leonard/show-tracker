/**
 * festivalLineupSeed — the pure half of admin-seed-festival-lineups.js
 * (5.58.0): what writing data/festival-lineups.json to the shared festival
 * catalog would do, and the report that says so.
 *
 * WHERE LINEUPS COME FROM. An upcoming festival's lineup has come from
 * Ticketmaster since 5.54.0, fetched when an attendee opens the festival
 * (netlify/functions/festival-lineup.js). Ticketmaster's terms rule out a
 * background job that watches for announcements, and plenty of festivals
 * are announced long before Ticketmaster lists them. So the admin keeps a
 * lineup file instead: when a festival announces its lineup, add it to
 * data/festival-lineups.json, deploy, and run the seeder from the admin
 * page. A lineup from the file:
 *   - is stored in the same four fields as a Ticketmaster lineup (lineup,
 *     lineupSource, lineupUrl, lineupFetchedAt) with lineupSource 'seed',
 *     so festival picks and every reader of those fields work unchanged;
 *   - replaces a Ticketmaster lineup, and is never replaced by one
 *     (festival-lineup.js checks lineupSource);
 *   - is replaced only by running the seeder again with a changed entry.
 *
 * Past festivals are not pre-seeded: setlist.fm's terms forbid storing its
 * data, and MusicBrainz had a usable lineup for 18 of the 252 past catalog
 * festivals when this was written (November 2026). An entry for a past
 * festival still works, because whatever is in the file was put there on
 * purpose, and the report marks it.
 *
 * THE FILE. { "lineups": [ entry, ... ] }, each entry:
 *   seedKey    the catalog festival's seedKey (data/festival-seed.json),
 *              e.g. "bonnaroo-2027". Its document is seed_<seedKey>.
 *   festivalId instead of seedKey: any festivals/{id} document, for a
 *              festival that isn't in the catalog. Exactly one of the two.
 *   artists    performer names, headliners first if you like. Trimmed,
 *              blank ones dropped, duplicates (ignoring case) dropped.
 *              At most MAX_LINEUP (Ticketmaster lineups use the same cap).
 *   sourceUrl  optional https link to the announcement. Shown as "The
 *              announced lineup ↗" under festival picks.
 *
 * Taking an entry out of the file does not take its lineup off the
 * festival. Delete the four fields with the Admin SDK (the console) for
 * that, the same way a Ticketmaster lineup is removed on request.
 */

const { SEED_ID_PREFIX } = require('./festivalSeed');
const { MAX_LINEUP } = require('./festivalLineup');

const SEED_LINEUP_SOURCE = 'seed';

const LINEUP_ACTIONS = ['set', 'replace', 'unchanged', 'missing', 'failed'];

function cleanArtists(artists) {
  const seen = new Set();
  const out = [];
  for (const raw of artists) {
    const name = String(raw).replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Why an entry can't be used, or '' when it can. */
function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'not an object';
  const hasKey = typeof entry.seedKey === 'string' && entry.seedKey.trim() !== '';
  const hasId = typeof entry.festivalId === 'string' && entry.festivalId.trim() !== '';
  if (hasKey === hasId) return 'needs exactly one of seedKey or festivalId';
  if (hasId && !/^[A-Za-z0-9_-]{1,128}$/.test(entry.festivalId)) return `bad festivalId ${JSON.stringify(entry.festivalId)}`;
  if (!Array.isArray(entry.artists)) return 'artists must be a list';
  if (entry.artists.some(a => typeof a !== 'string')) return 'every artist must be a string';
  const artists = cleanArtists(entry.artists);
  if (artists.length === 0) return 'no artists';
  if (artists.length > MAX_LINEUP) return `${artists.length} artists (max ${MAX_LINEUP})`;
  if (entry.sourceUrl != null && !/^https:\/\/\S+$/.test(String(entry.sourceUrl))) {
    return `sourceUrl must be an https link, got ${JSON.stringify(entry.sourceUrl)}`;
  }
  return '';
}

function docIdFor(entry) {
  return entry.festivalId ? entry.festivalId.trim() : `${SEED_ID_PREFIX}${entry.seedKey.trim()}`;
}

/** The document ids the file refers to, for the caller to read. */
function lineupDocIds(entries) {
  return [...new Set((entries || []).filter(e => !entryProblem(e)).map(docIdFor))];
}

function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * planLineups(entries, festivalsById, { today }) -> plan
 *
 * entries        the file's `lineups`
 * festivalsById  Map of document id -> document data, for the ids
 *                lineupDocIds returned; a missing id means no document
 * today          yyyy-MM-dd, to mark entries for festivals already over
 *
 * Every entry lands in exactly one action:
 *   set        the festival has no lineup; the file's is written
 *   replace    the festival has a different lineup (Ticketmaster's, or an
 *              earlier version of the file's); the file's is written
 *   unchanged  the festival already has exactly this lineup from the file
 *   missing    no festival document with that id
 *   failed     the entry itself is unusable, or names a festival another
 *              entry already did
 */
function planLineups(entries, festivalsById, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const plan = Object.fromEntries(LINEUP_ACTIONS.map(a => [a, []]));
  const claimed = new Set();

  (entries || []).forEach((entry, index) => {
    const problem = entryProblem(entry);
    const label = (entry && (entry.seedKey || entry.festivalId)) || `#${index + 1}`;
    if (problem) {
      plan.failed.push({ index, label, reason: problem });
      return;
    }
    const docId = docIdFor(entry);
    if (claimed.has(docId)) {
      plan.failed.push({ index, label, docId, reason: `${docId} is already in the file` });
      return;
    }
    claimed.add(docId);

    const festival = festivalsById.get(docId);
    if (!festival) {
      plan.missing.push({ index, label, docId });
      return;
    }

    const artists = cleanArtists(entry.artists);
    const lineupUrl = entry.sourceUrl ? String(entry.sourceUrl) : null;
    const current = Array.isArray(festival.lineup) ? festival.lineup : [];
    const row = {
      index,
      label,
      docId,
      name: festival.name || '',
      startDate: festival.startDate || (festival.year ? String(festival.year) : ''),
      past: !!(festival.endDate || festival.startDate) && (festival.endDate || festival.startDate) < today,
      artists,
      lineupUrl,
      currentSource: festival.lineupSource || null,
      currentCount: current.length,
      write: { lineup: artists, lineupSource: SEED_LINEUP_SOURCE, lineupUrl },
    };

    if (festival.lineupSource === SEED_LINEUP_SOURCE && sameList(current, artists) && (festival.lineupUrl || null) === lineupUrl) {
      plan.unchanged.push(row);
    } else if (current.length === 0) {
      plan.set.push(row);
    } else {
      const before = new Set(current.map(a => String(a).toLowerCase()));
      const after = new Set(artists.map(a => a.toLowerCase()));
      row.added = artists.filter(a => !before.has(a.toLowerCase())).length;
      row.removed = current.filter(a => !after.has(String(a).toLowerCase())).length;
      plan.replace.push(row);
    }
  });

  for (const a of ['set', 'replace', 'unchanged']) {
    plan[a].sort((x, y) => x.startDate.localeCompare(y.startDate) || x.label.localeCompare(y.label));
  }
  return { ...plan, counts: Object.fromEntries(LINEUP_ACTIONS.map(a => [a, plan[a].length])) };
}

function table(rows, columns) {
  if (rows.length === 0) return '  (none)\n';
  const cells = rows.map(r => columns.map(([, get]) => String(get(r) ?? '')));
  const widths = columns.map(([label], i) => Math.max(label.length, ...cells.map(c => c[i].length)));
  const line = (vals) => '  ' + vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns.map(([l]) => l)), line(widths.map(w => '-'.repeat(w))), ...cells.map(line)].join('\n') + '\n';
}

const firstFew = (r) => r.artists.slice(0, 3).join(', ') + (r.artists.length > 3 ? ', …' : '');

/** The dry-run report, one table per action. */
function formatLineupReport(plan, { entryCount = null } = {}) {
  const c = plan.counts;
  const out = [];
  out.push(
    `Festival lineup plan — set ${c.set}, replace ${c.replace}, unchanged ${c.unchanged}, ` +
    `missing ${c.missing}, failed ${c.failed}` + (entryCount == null ? '' : ` (${entryCount} entries in the file)`)
  );
  const past = [...plan.set, ...plan.replace].filter(r => r.past).length;
  if (past) out.push(`${past} of the lineups to write are for festivals that are already over.`);
  out.push('');

  const main = [
    ['when', r => r.startDate],
    ['festival', r => r.name],
    ['id', r => r.docId],
    ['artists', r => r.artists.length],
    ['first', firstFew],
    ['source link', r => (r.lineupUrl ? 'yes' : '')],
    ['past', r => (r.past ? 'past' : '')],
  ];
  out.push(`SET (${c.set}) — the festival has no lineup yet.`);
  out.push(table(plan.set, main));
  out.push(`REPLACE (${c.replace}) — the festival has a different lineup, which this replaces.`);
  out.push(table(plan.replace, [
    ...main.slice(0, 4),
    ['now from', r => r.currentSource || '?'],
    ['now has', r => r.currentCount],
    ['+added', r => r.added],
    ['-removed', r => r.removed],
    ['past', r => (r.past ? 'past' : '')],
  ]));
  out.push(`UNCHANGED (${c.unchanged}) — already has exactly this lineup from the file.`);
  out.push(table(plan.unchanged, main.slice(0, 4)));
  out.push(`MISSING (${c.missing}) — no festival with that id. Check the seedKey, or that the festival was seeded.`);
  out.push(table(plan.missing, [['entry', r => r.label], ['id', r => r.docId]]));
  out.push(`FAILED (${c.failed}) — the entry can't be used. Nothing is written for it.`);
  out.push(table(plan.failed, [['entry', r => r.label], ['line item', r => r.index + 1], ['why', r => r.reason]]));
  return out.join('\n');
}

module.exports = {
  SEED_LINEUP_SOURCE,
  LINEUP_ACTIONS,
  cleanArtists,
  entryProblem,
  docIdFor,
  lineupDocIds,
  planLineups,
  formatLineupReport,
};
