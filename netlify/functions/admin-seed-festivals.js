/**
 * admin-seed-festivals — Admin-only seeder that pre-populates the shared
 * festival catalog from data/festival-seed.json (293 US festival editions,
 * 2021–2027), so most users find their festival already there and join it
 * instead of creating it.
 *
 * POST body:   { commit?: boolean, confidence?: string[] }
 *   commit      DRY RUN unless this is exactly true.
 *   confidence  which seedConfidence levels may be created, e.g.
 *               ["verified", "high"]. Omitted = all. The rest are reported
 *               as `excluded`, and a later run that includes them creates
 *               only those. An unknown level is a 400, never ignored.
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * Response:    { success, dryRun, seedCount, catalogCount, confidence,
 *                counts, plan, report, written? }
 *   counts  { create, matched_existing, conflict, skip, excluded, failed }
 *   plan    the entries behind each count, sorted by start date
 *   report  the same plan as plain-text tables (what AdminView and
 *           scripts/festival-seed-dryrun.js print)
 *   written (commit only) { created, skipped, failed[] } — what the writes
 *           actually did, which can differ from the plan if something
 *           changed between the read and the write
 *
 * The planning rules (what counts as a match, a conflict, a skip) and the
 * shape of a seeded document live in netlify/functions/lib/festivalSeed.js,
 * with the reasons. In short:
 *   - It uses the app's own match rule (lib/festivalMatchRule.js, kept equal
 *     to lib/festivalMatch.js by festivalMatchParity.test.js).
 *   - It never writes to a festival that already exists, user-created or
 *     seeded, and never writes to anyone's attendance record or shows.
 *   - Matches and conflicts are reported, never merged. Merging stays with
 *     admin-merge-festivals.js, by hand.
 *
 * IDEMPOTENT. Every seeded festival's id is deterministic, seed_<seedKey>
 * (e.g. seed_bonnaroo-2025), and is written with create(), which refuses an
 * id that already exists. A second run plans every record it created as
 * `skip`, and even a run racing another one cannot write a document twice.
 *
 * FAILURE ISOLATION. Writes go in batches of WRITE_BATCH_SIZE. A batch that
 * fails is retried one document at a time, so one bad record costs only
 * itself; the rest are written and the failure is reported.
 *
 * The seed file is bundled with the function by the static require below,
 * the way admin-resync-setlists.js bundles config/internet-archive.json.
 */

const { withCors } = require('./lib/cors');
const SEED = require('../../data/festival-seed.json');
const { planSeed, formatPlanReport, normalizeConfidence } = require('./lib/festivalSeed');

// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Firestore caps a batch at 500 writes.
const WRITE_BATCH_SIZE = 400;

// gRPC ALREADY_EXISTS: create() on an id someone wrote since our read.
const ALREADY_EXISTS = 6;

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
  if (!isAdmin(decoded)) throw new Error('Forbidden');
  return decoded;
}

/** Every document in the top-level `festivals` collection (not the per-user ones). */
async function loadCatalog(db) {
  const snap = await db.collection('festivals').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Writes the plan's creates. Returns { created, skipped, failed[] }.
 * Exported so the batching and the per-document fallback can be tested
 * against a fake Firestore.
 */
async function writeCreates(db, creates, serverTimestamp) {
  const result = { created: 0, skipped: 0, failed: [] };
  const docFor = (entry) => ({ ...entry.doc, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  for (let i = 0; i < creates.length; i += WRITE_BATCH_SIZE) {
    const slice = creates.slice(i, i + WRITE_BATCH_SIZE);
    try {
      const batch = db.batch();
      slice.forEach(entry => batch.create(db.collection('festivals').doc(entry.docId), docFor(entry)));
      await batch.commit();
      result.created += slice.length;
      continue;
    } catch (batchError) {
      console.warn(`Seed batch ${i / WRITE_BATCH_SIZE + 1} failed (${batchError.message}); retrying one by one`);
    }

    for (const entry of slice) {
      try {
        await db.collection('festivals').doc(entry.docId).create(docFor(entry));
        result.created++;
      } catch (e) {
        if (e && e.code === ALREADY_EXISTS) {
          result.skipped++;
        } else {
          console.error(`Seed create failed for ${entry.seedKey}:`, e.message);
          result.failed.push({ seedKey: entry.seedKey, docId: entry.docId, reason: e.message });
        }
      }
    }
  }
  return result;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  try {
    await verifyAdmin(token);
  } catch (e) {
    const status = e.message === 'Forbidden' ? 403 : 401;
    return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Body must be JSON' }) };
  }
  // Writing needs the literal boolean. "true", 1 or a typo'd key all dry-run.
  const commit = body.commit === true;

  // Which seedConfidence levels may be created this run. Omitted means all.
  // An unknown level is refused rather than ignored, so a typo can't widen
  // or empty the run.
  let confidence;
  try {
    confidence = normalizeConfidence(body.confidence);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore();

  try {
    const records = Array.isArray(SEED.festivals) ? SEED.festivals : [];
    const catalog = await loadCatalog(db);
    const plan = planSeed(records, catalog, { confidence });
    const report = formatPlanReport(plan, { catalogCount: catalog.length });

    console.log(
      `Festival seed ${commit ? 'COMMIT' : 'dry run'} [${confidence.join(',')}]: catalog ${catalog.length}, ` +
      Object.entries(plan.counts).map(([k, v]) => `${k} ${v}`).join(', ')
    );

    const response = {
      success: true,
      dryRun: !commit,
      seedCount: records.length,
      catalogCount: catalog.length,
      confidence,
      counts: plan.counts,
      plan,
      report,
    };

    if (commit) {
      response.written = await writeCreates(db, plan.create, () => FieldValue.serverTimestamp());
      console.log(
        `Festival seed wrote: created ${response.written.created}, ` +
        `skipped ${response.written.skipped}, failed ${response.written.failed.length}`
      );
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Festival seed error:', error);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

exports.loadCatalog = loadCatalog;
exports.writeCreates = writeCreates;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
