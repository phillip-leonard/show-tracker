#!/usr/bin/env node
/**
 * backfill-user-stats — write every user's server stats once, and report
 * how they differ from the numbers the app showed before (5.59.15, B-05).
 *
 *   node scripts/backfill-user-stats.js            # dry run: parity report, writes nothing
 *   node scripts/backfill-user-stats.js --apply    # write userStats, publicUserStats, communityStats
 *
 * The scheduled job (community-stats.js, every 6 hours) does the same
 * writes; this is for doing it now, after the deploy, before the rules
 * deploy (see the 5.59.15 PR runbook). It is idempotent: a second run
 * writes the same numbers.
 *
 * The parity report is counts only, no identities. For each number it
 * compares the old value with the new one and says why any differ:
 *   - stored profile counts (showCount, songCount, ratedSongCount,
 *     venueCount): the clients wrote these; a difference is either a stale
 *     counter (setlists filled in later never updated it) or a definition
 *     change (venues: distinct name + city since 5.59.10, B-04)
 *   - bands and unique songs: the old client definitions (raw name,
 *     lowercased title) vs the approved ones (artistNameKeyLoose,
 *     songTitleKey)
 *   - rank: every profile by stored showCount vs ranked accounts only
 *     (no test users, no banned, at least one show), ties sharing a rank
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


/** The numbers the app showed before 5.59.15, from the old definitions. */
function oldClientNumbers(shows) {
  const lowerSongs = new Set();
  shows.forEach((s) => (s.setlist || []).forEach((x) => lowerSongs.add(String((x && x.name) || '').toLowerCase().trim())));
  const withoutBlank = new Set([...lowerSongs].filter(Boolean));
  return {
    bands: new Set(shows.map((s) => s.artist)).size,
    // My Shows header (AppContext summaryStats): a blank setlist entry
    // counted as one song.
    uniqueSongs: lowerSongs.size,
    uniqueSongsWithoutBlank: withoutBlank.size,
    rawVenues: new Set(shows.map((s) => s.venue)).size,
  };
}

/** The pre-5.59.15 rank: every profile, by stored showCount, ties in sort order. */
function oldRanks(profiles) {
  const sorted = [...profiles].sort((a, b) => (b.showCount || 0) - (a.showCount || 0));
  return new Map(sorted.map((p, i) => [p.id, { rank: i + 1, of: sorted.length }]));
}

function parityReport({ statsByUid, ranks, profiles, showsByUid }) {
  const out = {};
  const bump = (field, reason) => {
    out[field] = out[field] || {};
    out[field][reason] = (out[field][reason] || 0) + 1;
  };
  const old = oldRanks([...profiles.values()]);
  for (const [uid, stats] of statsByUid) {
    const p = profiles.get(uid) || {};
    const shows = showsByUid.get(uid) || [];
    const before = oldClientNumbers(shows);
    for (const field of ['showCount', 'songCount', 'ratedSongCount']) {
      if (p[field] === undefined) bump(field, 'no stored value');
      else if (p[field] === stats[field]) bump(field, 'same');
      else bump(field, p[field] < stats[field] ? 'stored too low (stale counter)' : 'stored too high (stale counter)');
    }
    if (p.venueCount === undefined) bump('venueCount', 'no stored value');
    else if (p.venueCount === stats.venueCount) bump('venueCount', 'same');
    else if (p.venueCount === before.rawVenues) bump('venueCount', 'definition: distinct name + city (B-04)');
    else bump('venueCount', 'stale counter');
    bump('bands', before.bands === stats.bandCount ? 'same' : 'definition: artistNameKeyLoose');
    if (before.uniqueSongs === stats.uniqueSongCount) bump('uniqueSongs', 'same');
    else if (before.uniqueSongsWithoutBlank === stats.uniqueSongCount) bump('uniqueSongs', 'old bug: a blank setlist entry counted as a song');
    else bump('uniqueSongs', 'definition: songTitleKey (plus any blank entry)');
    const was = old.get(uid);
    const now = ranks.get(uid);
    if (!was && !now) bump('rank', 'unranked before and after');
    else if (!now) bump('rank', p.isTestUser ? 'now unranked: test user' : p.banned ? 'now unranked: banned' : 'now unranked: no shows');
    else if (was && was.rank === now.rank && was.of === now.of) bump('rank', 'same');
    else bump('rank', 'changed: test users and empty accounts left out, ties share a rank');
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { getDb } = require('../netlify/functions/lib/firebaseAdmin');
  const { rebuildAllStats, showsByUser } = require('../netlify/functions/lib/userStats');
  const db = getDb();
  const { FieldValue } = require('firebase-admin/firestore');

  console.log(apply ? 'APPLY: writing userStats, publicUserStats and communityStats' : 'DRY RUN: nothing is written (pass --apply to write)');
  const run = await rebuildAllStats(db, { write: apply, serverTimestamp: () => FieldValue.serverTimestamp() });
  const showsByUid = showsByUser(await db.collectionGroup('shows').get());
  console.log(`\n${run.users} users, ${run.ranked} ranked, ${run.shows} shows${apply ? `, ${run.written} documents written` : ''}`);
  console.log('\nParity, old number vs new (counts of users):');
  const report = parityReport({ ...run, showsByUid });
  for (const [field, reasons] of Object.entries(report)) console.log(`  ${field}: ${JSON.stringify(reasons)}`);
  console.log(`\nCommunity totals: ${run.community.totalUsers} users, ${run.community.totalShows} shows, ${run.community.totalSongs} songs`);
}

module.exports = { parityReport, oldClientNumbers, oldRanks };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

