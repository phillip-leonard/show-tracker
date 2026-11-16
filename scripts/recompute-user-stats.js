/**
 * recompute-user-stats — rebuild every user's server stats now, after a
 * change to what lib/stats writes (5.60.27: topSongs, and top 10 lists).
 *
 *   node scripts/recompute-user-stats.js            # dry run: what would change, writes nothing
 *   node scripts/recompute-user-stats.js --apply    # write userStats, publicUserStats, communityStats, reviews
 *
 * The scheduled job (community-stats.js, every 6 hours) runs the same
 * rebuild, so this only saves the wait. It's idempotent: a second --apply
 * writes the same numbers, and a dry run after it reports nothing to change.
 *
 * The report is counts only, never a uid, a name or a song:
 *   - users whose userStats document would change, and which fields
 *     (added, changed, same), ignoring computedAt
 *   - how long the new top lists are (users by length)
 * After --apply it reads every userStats document back and counts any
 * still missing topSongs.
 *
 * Credentials come from .env, same as the other scripts.
 */

(function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const IGNORED = new Set(['computedAt']);
const LISTS = ['topBands', 'topVenues', 'topSongs'];

/** What the stored userStats document would become (the fields the rebuild writes). */
function nextDocument(stats, rank) {
  return { ...stats, ranked: !!rank, rank: rank ? rank.rank : null, rankedOf: rank ? rank.of : null };
}

/**
 * changeReport(storedByUid, statsByUid, ranks) → counts only.
 *   { users, changing, fields: { field: { added, changed, same } }, lengths: { topSongs: { '0': n, … } } }
 */
function changeReport(storedByUid, statsByUid, ranks) {
  const fields = {};
  const lengths = Object.fromEntries(LISTS.map((l) => [l, {}]));
  let changing = 0;
  const bump = (field, what) => {
    fields[field] = fields[field] || { added: 0, changed: 0, same: 0 };
    fields[field][what] += 1;
  };
  for (const [uid, stats] of statsByUid) {
    const next = nextDocument(stats, ranks.get(uid) || null);
    const stored = storedByUid.get(uid) || null;
    let differs = !stored;
    for (const [field, value] of Object.entries(next)) {
      if (IGNORED.has(field)) continue;
      if (!stored || !(field in stored)) { bump(field, 'added'); differs = true; } else if (JSON.stringify(stored[field]) === JSON.stringify(value)) bump(field, 'same');
      else { bump(field, 'changed'); differs = true; }
    }
    for (const l of LISTS) {
      const n = String((next[l] || []).length);
      lengths[l][n] = (lengths[l][n] || 0) + 1;
    }
    if (differs) changing += 1;
  }
  return { users: statsByUid.size, changing, fields, lengths };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { getDb, getAdminAuth } = require('../netlify/functions/lib/firebaseAdmin');
  const { rebuildAllStats } = require('../netlify/functions/lib/userStats');
  const db = getDb();
  const { FieldValue } = require('firebase-admin/firestore');

  console.log(apply
    ? 'APPLY: writing userStats, publicUserStats, communityStats and existing Year in Review numbers'
    : 'DRY RUN: nothing is written (pass --apply to write)');

  const storedSnap = await db.collection('userStats').get();
  const storedByUid = new Map(storedSnap.docs.map((d) => [d.id, d.data()]));
  const run = await rebuildAllStats(db, { write: apply, serverTimestamp: () => FieldValue.serverTimestamp(), auth: getAdminAuth() });
  const report = changeReport(storedByUid, run.statsByUid, run.ranks);

  console.log(`\n${run.users} users (${run.guests} guests), ${run.ranked} ranked, ${run.shows} shows`);
  console.log(`${report.changing} of ${report.users} userStats documents ${apply ? 'changed' : 'would change'}`);
  console.log('\nFields (users):');
  for (const [field, c] of Object.entries(report.fields)) {
    if (c.added || c.changed) console.log(`  ${field}: ${c.added} added, ${c.changed} changed, ${c.same} same`);
  }
  console.log('\nTop list lengths (users by length):');
  for (const [list, byLength] of Object.entries(report.lengths)) console.log(`  ${list}: ${JSON.stringify(byLength)}`);
  console.log(`\nYear in Review documents: ${run.yearInReviews.docs}, ${run.yearInReviews.changed} ${apply ? `changed, ${run.yearInReviews.written} written` : 'would change'}`);

  if (apply) {
    console.log(`\n${run.written} stats documents written.`);
    const after = await db.collection('userStats').get();
    const missing = after.docs.filter((d) => !Array.isArray(d.data().topSongs)).length;
    console.log(`Check: ${after.size} userStats documents, ${missing} without topSongs${missing ? ' (re-run --apply)' : ''}.`);
    if (missing) process.exitCode = 1;
  }
}

module.exports = { changeReport, nextDocument };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
