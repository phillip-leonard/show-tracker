#!/usr/bin/env node
/**
 * The setlist.fm cache's expiry, enforced by Firestore itself.
 *
 *   node scripts/setlist-cache-ttl.js            report only (default)
 *   node scripts/setlist-cache-ttl.js --apply    turn on the TTL policy and
 *                                                delete expired entries
 *
 * Reads FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * from the environment or .env.local, like the other admin scripts.
 *
 * Two jobs, both about setlist.fm's "short periods only" caching rule (see
 * netlify/functions/lib/setlistCache.js):
 *
 *   1. The TTL policy. Firestore deletes a setlistCache document on its own
 *      once `expiresAt` has passed (usually within 24 hours of it). The same
 *      policy is declared in firestore.indexes.json, so `npm run
 *      deploy:rules` keeps it; this script sets it through the Firestore
 *      Admin API so it can be turned on without a full rules deploy.
 *
 *   2. The purge. Firestore works through a TTL backlog at its own pace,
 *      and before 5.47.5 nothing deleted an expired entry, so this deletes
 *      right away every entry outside the 24-hour window: expiresAt passed
 *      or missing, or written under the old rules to live longer than 24
 *      hours (search results were cached for up to seven days). Those are
 *      only cache misses afterwards; the next request refetches.
 *
 * Only setlistCache is touched.
 */

const fs = require('fs');
const path = require('path');

const { COLLECTION, MAX_TTL_HOURS } = require('../netlify/functions/lib/setlistCache');

const APPLY = process.argv.includes('--apply');
const FIELD = 'expiresAt';

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

function credentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required');
  }
  return { projectId, clientEmail, privateKey };
}

// ── TTL policy (Firestore Admin API: projects.databases.collectionGroups.fields) ──

async function adminClient({ clientEmail, privateKey }) {
  const { JWT } = require('google-auth-library');
  return new JWT({ email: clientEmail, key: privateKey, scopes: ['https://www.googleapis.com/auth/datastore'] });
}

function fieldUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${COLLECTION}/fields/${FIELD}`;
}

async function ttlState(client, projectId) {
  const res = await client.request({ url: fieldUrl(projectId), method: 'GET' });
  return res.data.ttlConfig?.state || 'NOT_SET';
}

async function enableTtl(client, projectId) {
  // Same field settings as firestore.indexes.json: TTL on, and no
  // single-field indexes (nothing queries expiresAt, and an indexed
  // timestamp that only moves forward is a write hotspot).
  const res = await client.request({
    url: `${fieldUrl(projectId)}?updateMask=ttlConfig,indexConfig`,
    method: 'PATCH',
    data: { ttlConfig: {}, indexConfig: { indexes: [] } },
  });
  return res.data.name; // a long-running operation
}

// ── Entries outside the window ──

// Expired, undated, or set to outlive MAX_TTL_HOURS from when it was fetched.
function outsideWindow(data, now) {
  const exp = data.expiresAt?.toMillis?.() || 0;
  const fetched = data.fetchedAt?.toMillis?.() || 0;
  if (exp <= now || !fetched) return true;
  return exp - fetched > MAX_TTL_HOURS * 3600 * 1000;
}

async function expiredEntries(db, now) {
  const snap = await db.collection(COLLECTION).get();
  const expired = [];
  let live = 0;
  let oldestFetch = Infinity;
  for (const d of snap.docs) {
    const data = d.data();
    if (!outsideWindow(data, now)) { live++; continue; }
    expired.push(d.ref);
    oldestFetch = Math.min(oldestFetch, data.fetchedAt?.toMillis?.() || Infinity);
  }
  return { total: snap.size, live, expired, oldestFetch };
}

async function deleteAll(db, refs) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += Math.min(400, refs.length - i);
  }
  return deleted;
}

async function main() {
  loadEnv();
  const creds = credentials();
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ credential: cert(creds), projectId: creds.projectId });
  const db = getFirestore();
  const client = await adminClient(creds);

  console.log(`Project ${creds.projectId}, collection ${COLLECTION}${APPLY ? '' : ' (report only; pass --apply to change anything)'}`);

  const state = await ttlState(client, creds.projectId);
  console.log(`TTL policy on ${FIELD}: ${state}`);

  const now = Date.now();
  const { total, live, expired, oldestFetch } = await expiredEntries(db, now);
  console.log(`Entries: ${total} (${live} live, ${expired.length} expired or over 24h${expired.length ? `, oldest fetched ${new Date(oldestFetch).toISOString().slice(0, 10)}` : ''})`);

  if (!APPLY) return;

  if (state !== 'ACTIVE' && state !== 'CREATING') {
    const op = await enableTtl(client, creds.projectId);
    console.log(`TTL policy requested (${op}). Firestore takes a few minutes to activate it.`);
  }
  if (expired.length) {
    const deleted = await deleteAll(db, expired);
    console.log(`Deleted ${deleted} entries.`);
  }
  const after = await expiredEntries(db, Date.now());
  console.log(`Now: ${after.total} entries, ${after.expired.length} outside the window. TTL policy: ${await ttlState(client, creds.projectId)}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.response?.data?.error?.message || e.message);
  process.exit(1);
});
