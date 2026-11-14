#!/usr/bin/env node
/**
 * year-in-review-parity — what 5.60.4 changes in Year in Review, for every
 * user, as counts only; and, with --apply, the server's numbers written to
 * every stored review.
 *
 *   node scripts/year-in-review-parity.js            # dry run: report, writes nothing
 *   node scripts/year-in-review-parity.js --apply    # write yearInReviews/*.stats
 *
 * 5.60.4 makes /year-in-review (lib/yearInReviewStats.js) count bands and
 * songs the way lib/stats and the 2026 recap (lib/yearRecap.js) do:
 *   band  bandKey (artistNameKeyLoose), was the lowercased name
 *   song  songKey (songTitleKey), was normalizeSongTitle with no fallback
 *         to the raw title, so a title with no a–z/0–9 characters ("東京",
 *         "???") wasn't a song
 * and moves the numbers a visitor sees on a public review to the server
 * (netlify/functions/lib/userStats.js). The recap, the My Shows banner and
 * the Stats card use lib/yearRecap.js, whose keys are unchanged
 * (lib/__tests__/stats.test.js pins bandKey = artistNameKeyLoose and
 * songKey = songTitleKey), so their numbers can't move.
 *
 * The report, for every (user, year) with shows:
 *   - band count, top band, highest-rated band and most-heard song: old vs
 *     new definition, how many differ and which way
 *   - Year in Review vs recap band count: how often they disagreed before
 *     and after (after: never, or the report says so)
 * and for the stored reviews: how many there are, how many the server
 * would rewrite, and how many are filed under an id that isn't
 * `${userId}_${year}` (never filled in by the server).
 *
 * Counts only: no names, ids or addresses. The scheduled stats job
 * (community-stats.js, every 6 hours) does the same writes as --apply; run
 * --apply after the deploy to have them at once. Idempotent.
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

const { computeYearInReview, showYear } = require('../lib/yearInReviewStats');
const { bandKey, normalizeSongTitle } = require('../lib/stats/keys');
const { forEachSongOncePerShow } = require('../lib/stats/perShow');
const { parseDate } = require('../lib/showDate');

// ── The definitions before 5.60.4 (for the report only) ────────────────

const oldBandKey = (name) => (name || '').trim().toLowerCase();
const oldSongKey = (song) => normalizeSongTitle(((song && song.name) || '').trim());

/**
 * The numbers 5.60.4 can change, by the old definitions. Plain objects and
 * Object.entries, exactly as the calculator counts, so ties break the same
 * way (Object.entries lists number-like keys such as "1999" first, which a
 * Map would not).
 */
function oldNumbers(yearShows) {
  const bandCounts = {};
  const bandNames = {};
  const ratings = {};
  const songCounts = {};
  const songNames = {};
  yearShows.forEach((s) => {
    const k = oldBandKey(s.artist);
    if (k) {
      bandCounts[k] = (bandCounts[k] || 0) + 1;
      bandNames[k] = bandNames[k] || s.artist.trim();
      if (typeof s.rating === 'number') (ratings[k] = ratings[k] || []).push(s.rating);
    }
    forEachSongOncePerShow([s], oldSongKey, (key, song) => {
      songCounts[key] = (songCounts[key] || 0) + 1;
      songNames[key] = song.name;
    });
  });
  const first = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
  const avg = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  const bestRated = Object.entries(ratings).map(([k, l]) => ({ name: bandNames[k], avg: avg(l) })).sort((a, b) => b.avg - a.avg)[0];
  const top = first(bandCounts);
  const song = first(songCounts);
  return {
    totalArtists: Object.keys(bandCounts).length,
    topArtist: top ? `${bandNames[top[0]]}|${top[1]}` : null,
    highestRatedArtist: bestRated ? `${bestRated.name}|${bestRated.avg.toFixed(1)}` : null,
    mostSeenSong: song ? `${songNames[song[0]]}|${song[1]}` : null,
  };
}

function newNumbers(stats) {
  return {
    totalArtists: stats.totalArtists,
    topArtist: stats.topArtist ? `${stats.topArtist.name}|${stats.topArtist.showCount}` : null,
    highestRatedArtist: stats.highestRatedArtist ? `${stats.highestRatedArtist.name}|${stats.highestRatedArtist.avgRating.toFixed(1)}` : null,
    mostSeenSong: stats.mostSeenSong ? `${stats.mostSeenSong.name}|${stats.mostSeenSong.count}` : null,
  };
}

/** The recap's band count (lib/yearRecap.js): distinct bandKey. */
const recapBands = (yearShows) => new Set(yearShows.map((s) => bandKey(s.artist)).filter(Boolean)).size;

/**
 * parityReport(showsByUid) → counts. Pure, so tests can run it.
 * showsByUid: Map uid → [{ id, ...show }].
 */
function parityReport(showsByUid) {
  const r = {
    users: showsByUid.size,
    userYears: 0,
    bandCount: { same: 0, fewer: 0, more: 0 },
    topBandChanged: 0,
    highestRatedBandChanged: 0,
    mostHeardSongChanged: 0,
    recapDisagreedBefore: 0,
    recapDisagreesAfter: 0,
  };
  for (const shows of showsByUid.values()) {
    const years = new Set(shows.map(showYear).filter((y) => y !== null));
    for (const year of years) {
      // In date order, as the calculator reads them, so ties break the same way.
      const yearShows = shows.filter((s) => showYear(s) === year).sort((a, b) => parseDate(a.date) - parseDate(b.date));
      const stats = computeYearInReview(shows, year);
      if (!stats) continue;
      r.userYears += 1;
      const before = oldNumbers(yearShows);
      const after = newNumbers(stats);
      if (after.totalArtists === before.totalArtists) r.bandCount.same += 1;
      else if (after.totalArtists < before.totalArtists) r.bandCount.fewer += 1;
      else r.bandCount.more += 1;
      if (after.topArtist !== before.topArtist) r.topBandChanged += 1;
      if (after.highestRatedArtist !== before.highestRatedArtist) r.highestRatedBandChanged += 1;
      if (after.mostSeenSong !== before.mostSeenSong) r.mostHeardSongChanged += 1;
      const recap = recapBands(yearShows);
      if (before.totalArtists !== recap) r.recapDisagreedBefore += 1;
      if (after.totalArtists !== recap) r.recapDisagreesAfter += 1;
    }
  }
  return r;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!privateKey || !clientEmail || !projectId) {
      console.error('FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID must be set (in .env or the environment).');
      process.exit(1);
    }
    initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
  }
  const db = getFirestore();
  const { showsWithIdsByUser, yearInReviewUpdates } = require('../netlify/functions/lib/userStats');

  const [showsSnap, reviewsSnap] = await Promise.all([
    db.collectionGroup('shows').get(),
    db.collection('yearInReviews').get(),
  ]);
  const byUid = showsWithIdsByUser(showsSnap);
  const r = parityReport(byUid);

  console.log(`Year in Review parity, ${r.users} users, ${r.userYears} user-years with shows`);
  console.log(`  band count:            ${r.bandCount.same} same, ${r.bandCount.fewer} fewer, ${r.bandCount.more} more`);
  console.log(`  top band changed:      ${r.topBandChanged}`);
  console.log(`  highest-rated band:    ${r.highestRatedBandChanged} changed`);
  console.log(`  most heard song:       ${r.mostHeardSongChanged} changed`);
  console.log(`  disagreed with recap:  ${r.recapDisagreedBefore} before, ${r.recapDisagreesAfter} after`);

  const misfiled = reviewsSnap.docs.filter((d) => {
    const data = d.data() || {};
    return d.id !== `${data.userId}_${Number(data.year)}`;
  }).length;
  const updates = yearInReviewUpdates(reviewsSnap.docs, (uid) => byUid.get(uid));
  const publicDocs = reviewsSnap.docs.filter((d) => (d.data() || {}).privacy === 'public').length;
  const publicChanged = updates.filter((u) => (reviewsSnap.docs.find((d) => d.ref.path === u.ref.path).data() || {}).privacy === 'public').length;
  console.log(`\nStored reviews: ${reviewsSnap.size} (${publicDocs} public), ${misfiled} filed under an id that isn't userId_year`);
  console.log(`  the server would rewrite ${updates.length} (${publicChanged} public)`);

  if (!apply) {
    console.log('\nDry run: nothing written. --apply writes the server numbers to those reviews.');
    return;
  }
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    updates.slice(i, i + 400).forEach((u) => batch.update(u.ref, { stats: u.stats, statsComputedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  const again = yearInReviewUpdates((await db.collection('yearInReviews').get()).docs, (uid) => byUid.get(uid));
  console.log(`\nWrote ${updates.length}. A re-check finds ${again.length} still to change.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => { console.error('Failed:', err.message); process.exit(1); });
}

module.exports = { parityReport, oldNumbers };
