// netlify/functions/lib/festivalPicksServer.js — "Your picks" for one
// festival, scored on the server (5.60.36, Stage 5 call B) so the native
// app has no copy of the scoring. The rule is lib/recommendations.js
// festivalPicks, the same module the web runs in the browser
// (components/festivals/FestivalPicks.jsx), from the same inputs:
//
//   bands      profileBands: the caller's followed bands
//              (userProfiles.favoriteArtists) and shows (artist, date)
//   seeds      seedsFor(bands), heaviest first; the first MAX_SEED_READS
//              read their bandAffinity documents
//   dismissed  users/{uid}/discover/prefs.dismissed ("not interested")
//
//   picksFor(db, uid, lineup) -> { recommended: [{ key, name, reason }],
//                                  love: [{ key, name, timesSeen, favorite }],
//                                  everyoneElse: [{ key, name, seenOnce }] }
//
// Everything read is the caller's own, plus the count-only affinity data.

const {
  profileBands, seedsFor, festivalPicks, becauseText, MAX_SEED_READS,
} = require('../../../lib/recommendations');

async function picksFor(db, uid, lineup) {
  if (!Array.isArray(lineup) || lineup.length === 0) return null;
  const [showsSnap, profileSnap, prefsSnap] = await Promise.all([
    db.collection(`users/${uid}/shows`).select('artist', 'date').get(),
    db.doc(`userProfiles/${uid}`).get(),
    db.doc(`users/${uid}/discover/prefs`).get(),
  ]);
  const shows = showsSnap.docs.map((d) => d.data());
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const favorites = Array.isArray(profile.favoriteArtists) ? profile.favoriteArtists : [];
  const prefs = prefsSnap.exists ? prefsSnap.data() : {};
  const dismissed = Array.isArray(prefs.dismissed) ? prefs.dismissed : [];

  const bands = profileBands({ favorites, shows });
  const seeds = seedsFor(bands);
  const keys = [...new Set(seeds.slice(0, MAX_SEED_READS).map((s) => s.key).filter(Boolean))];
  const affinityDocs = {};
  await Promise.all(keys.map(async (k) => {
    try {
      const snap = await db.doc(`bandAffinity/${k}`).get();
      if (snap.exists) affinityDocs[k] = snap.data();
    } catch { /* no data for that band, as the web treats it */ }
  }));

  const picks = festivalPicks({ lineup, seeds, affinityDocs, bands, dismissed });
  return {
    recommended: picks.recommended.map((p) => ({ key: p.key, name: p.name, reason: becauseText(p.because) })),
    love: picks.love.map((p) => ({ key: p.key, name: p.name, timesSeen: p.timesSeen, favorite: p.favorite })),
    everyoneElse: picks.everyoneElse.map((p) => ({ key: p.key, name: p.name, seenOnce: p.seenOnce })),
  };
}

module.exports = { picksFor };
