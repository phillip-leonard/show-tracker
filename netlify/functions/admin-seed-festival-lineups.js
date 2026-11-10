/**
 * admin-seed-festival-lineups — Admin-only. Writes the announced lineups in
 * data/festival-lineups.json to the shared festival catalog (5.58.0).
 *
 * POST body:   { commit?: boolean }   DRY RUN unless commit is exactly true.
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * Response:    { success, dryRun, entryCount, counts, plan, report, written? }
 *   counts  { set, replace, unchanged, missing, failed }
 *   report  the plan as plain-text tables (what the admin card shows)
 *   written (commit only) { written, failed[] }
 *
 * What a lineup from the file is, where it is stored and why Ticketmaster
 * never replaces it: netlify/functions/lib/festivalLineupSeed.js. This
 * function only reads the festival documents the file names and updates
 * their four lineup fields. It never creates a festival, never touches any
 * other field, and never writes to anyone's attendance record or shows.
 *
 * Writing the same file twice writes nothing the second time: every entry
 * comes back `unchanged`.
 *
 * The file is bundled with the function by the static require below, the
 * way admin-seed-festivals.js bundles data/festival-seed.json, so a change
 * to the file reaches this function on the next deploy.
 */

const LINEUPS = require('../../data/festival-lineups.json');
const { getDb, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
const { lineupDocIds, planLineups, formatLineupReport } = require('./lib/festivalLineupSeed');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Firestore caps a batch at 500 writes.
const WRITE_BATCH_SIZE = 400;

function reply(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/** Map of id -> data for the festival documents the file names. */
async function loadFestivals(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const refs = ids.map(id => db.collection('festivals').doc(id));
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    snaps.forEach(s => { if (s.exists) out.set(s.id, s.data()); });
  }
  return out;
}

/**
 * Updates the lineup fields for the plan's set and replace rows. A batch
 * that fails is retried one document at a time, so one bad row costs only
 * itself. update() refuses a document that has been deleted since the
 * read, which is reported as a failure rather than recreating it.
 */
async function writeLineups(db, rows, serverTimestamp) {
  const result = { written: 0, failed: [] };
  const patch = (row) => ({ ...row.write, lineupFetchedAt: serverTimestamp() });

  for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
    const slice = rows.slice(i, i + WRITE_BATCH_SIZE);
    try {
      const batch = db.batch();
      slice.forEach(row => batch.update(db.collection('festivals').doc(row.docId), patch(row)));
      await batch.commit();
      result.written += slice.length;
      continue;
    } catch (batchError) {
      console.warn(`Lineup batch ${i / WRITE_BATCH_SIZE + 1} failed (${batchError.message}); retrying one by one`);
    }
    for (const row of slice) {
      try {
        await db.collection('festivals').doc(row.docId).update(patch(row));
        result.written++;
      } catch (e) {
        console.error(`Lineup write failed for ${row.docId}:`, e.message);
        result.failed.push({ docId: row.docId, label: row.label, reason: e.message });
      }
    }
  }
  return result;
}

async function handle(event, { db, verify = verifyUser, entries = LINEUPS.lineups, now = () => new Date() } = {}) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const claims = await verify(event);
  if (!claims) return reply(401, { error: 'Unauthorized' });
  if (!isAdminClaims(claims)) return reply(403, { error: 'Forbidden' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { error: 'Body must be JSON' });
  }
  // Writing needs the literal boolean. "true", 1 or a typo'd key all dry-run.
  const commit = body.commit === true;

  try {
    const list = Array.isArray(entries) ? entries : [];
    const festivals = await loadFestivals(db, lineupDocIds(list));
    const plan = planLineups(list, festivals, { today: now().toISOString().slice(0, 10) });
    const report = formatLineupReport(plan, { entryCount: list.length });
    console.log(
      `Festival lineups ${commit ? 'COMMIT' : 'dry run'}: ` +
      Object.entries(plan.counts).map(([k, v]) => `${k} ${v}`).join(', ')
    );

    const response = { success: true, dryRun: !commit, entryCount: list.length, counts: plan.counts, plan, report };
    if (commit) {
      const { FieldValue } = require('firebase-admin/firestore');
      response.written = await writeLineups(db, [...plan.set, ...plan.replace], () => FieldValue.serverTimestamp());
      console.log(`Festival lineups wrote ${response.written.written}, failed ${response.written.failed.length}`);
    }
    return reply(200, response);
  } catch (error) {
    console.error('Festival lineup seed error:', error);
    return reply(500, { error: error.message });
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  try {
    return await handle(event, { db: getDb() });
  } catch (error) {
    console.error('Festival lineup seed failed:', error);
    return reply(500, { error: error.message });
  }
};
exports.handle = handle;
exports.loadFestivals = loadFestivals;
exports.writeLineups = writeLineups;
