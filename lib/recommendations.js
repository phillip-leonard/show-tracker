// lib/recommendations.js
//
// "Bands you might like" and festival picks: one scoring engine, used by the
// nightly job (netlify/functions/band-affinity.js) and by the app.
//
// CommonJS on purpose. A Netlify function requires it without a build step
// and the app imports it through webpack, so there is one copy of the math
// rather than an ESM module plus a CommonJS port and a parity test (the
// arrangement lib/festivalMatch.js needed). Nothing in here touches Firebase
// or the DOM.
//
// ── The rule ──────────────────────────────────────────────────────────
//
// A user "likes" a band they follow (userProfiles.favoriteArtists: follow
// and favorite are the same thing since 5.46.0) or have seen at least
// SEEN_THRESHOLD times. For every band A:
//
//   fans(A)   users who like A
//   co(A,B)   users who like A and saw B at least SEEN_THRESHOLD times
//   seen2(B)  users who saw B at least SEEN_THRESHOLD times (popularity)
//
// Every count is of distinct users. Someone who saw a band 40 times counts
// once, exactly like someone who saw it twice.
//
//   affinity(A,B) = co(A,B) / (fans(A) + SMOOTHING)
//   baseline(B)   = seen2(B) / totalActiveUsers
//   lift(A,B)     = affinity(A,B) / baseline(B)
//   pairScore     = affinity * lift ^ POPULARITY_DAMPING
//   userScore(B)  = Σ over the user's seed bands A: seedWeight(A) * pairScore(A,B)
//
// lift is what keeps Phish off the top of every list: a band everyone sees
// a lot has a baseline close to its affinity, so its lift is near (or
// under) 1, while a band that fans of A see far more than everyone else
// does gets a lift well above 1.
//
// ── Privacy ───────────────────────────────────────────────────────────
//
// The job stores counts only, never a user id or name, and drops every pair
// whose co is under MIN_CO_FANS, so a small band seen by one or two people
// can't be traced back to them. Since co(A,B) <= fans(A), a band with fewer
// than MIN_CO_FANS fans gets no affinity document at all.

// ── Constants (tune here) ─────────────────────────────────────────────

/** A followed band counts this much as a seed. */
const FAVORITE_WEIGHT = 2.0;
/** A band the user has seen (and doesn't follow) counts this much. */
const SEEN_WEIGHT = 1.0;
/** Each time seen beyond the first adds this share of the base weight... */
const REPEAT_BONUS = 0.1;
/** ...up to this much in all. */
const MAX_REPEAT_BONUS = 0.5;
/** Higher pushes harder toward smaller bands. 0 ignores popularity. */
const POPULARITY_DAMPING = 0.7;
/** Added to fans(A) so a band with three fans can't produce a huge lift. */
const SMOOTHING = 2;
/** Pairs (and popularity entries) with fewer distinct users are never stored. */
const MIN_CO_FANS = 3;
/** "Saw a band a lot" means at least this many shows. */
const SEEN_THRESHOLD = 2;
/** Candidates stored per band. */
const TOP_N = 50;
/** Affinity documents a user's Discover reads at most (their heaviest seeds). */
const MAX_SEED_READS = 25;
/** Suggestions Discover shows. */
const DISCOVER_LIMIT = 20;

// ── Band keys ─────────────────────────────────────────────────────────
//
// The same key as lib/setlistSources.js's artistNameKeyLoose, which the band
// screens use: bracketed qualifiers and a leading "The" are dropped, then
// the name is slugged like lib/wishlist.js's artistKeyFor. "Goose (US)",
// "The Goose" and "goose " are all `goose`. Re-implemented here because
// those are ESM modules that pull in Firebase;
// lib/__tests__/recommendations.test.js asserts they agree.
//
// The result is also a valid Firestore document id: no "/", no ".", no
// "__". A name with no Latin letters or digits keys to "" and is skipped.

function bandKey(name) {
  const stripped = String(name || '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .trim()
    .replace(/^the\s+/i, '')
    .trim();
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

// ── One user's data ───────────────────────────────────────────────────

/** The day a show happened, so two docs for one night count once. */
function showDay(show) {
  const d = show && show.date;
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d.seconds === 'number') return new Date(d.seconds * 1000).toISOString().slice(0, 10);
  return String(d);
}

/**
 * profileBands({ favorites, shows }) -> Map key -> { key, name, favorite, timesSeen }
 *
 * favorites: userProfiles.favoriteArtists (objects with `name`) or plain names.
 * shows:     the user's show documents (`artist`, `date`).
 * timesSeen counts distinct days, so a duplicated show doc isn't a second visit.
 * name is the spelling the user used most.
 */
function profileBands({ favorites = [], shows = [] } = {}) {
  const bands = new Map();
  const spellings = new Map();
  const touch = (key) => {
    if (!bands.has(key)) bands.set(key, { key, name: '', favorite: false, timesSeen: 0, days: new Set() });
    return bands.get(key);
  };
  for (const fav of favorites) {
    const name = typeof fav === 'string' ? fav : fav && fav.name;
    const key = bandKey(name);
    if (!key) continue;
    const b = touch(key);
    b.favorite = true;
    b.name = b.name || String(name).trim();
  }
  for (const show of shows) {
    const key = bandKey(show && show.artist);
    if (!key) continue;
    const b = touch(key);
    const day = showDay(show) || `doc:${b.days.size}`;
    b.days.add(day);
    const name = String(show.artist).trim();
    const counts = spellings.get(key) || new Map();
    counts.set(name, (counts.get(name) || 0) + 1);
    spellings.set(key, counts);
  }
  for (const b of bands.values()) {
    b.timesSeen = b.days.size;
    delete b.days;
    const counts = spellings.get(b.key);
    if (!b.favorite && counts) {
      b.name = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    }
  }
  return bands;
}

/** How much one seed band counts toward a user's suggestions. */
function seedWeight({ favorite = false, timesSeen = 0 } = {}) {
  if (!favorite && timesSeen < 1) return 0;
  const base = favorite ? FAVORITE_WEIGHT : SEEN_WEIGHT;
  const bonus = Math.min(REPEAT_BONUS * Math.max(0, timesSeen - 1), MAX_REPEAT_BONUS);
  return base * (1 + bonus);
}

/**
 * seedsFor(bands) -> [{ key, name, weight, favorite, timesSeen }], heaviest first.
 * Every followed band and every band seen at least once.
 */
function seedsFor(bands) {
  return [...bands.values()]
    .map((b) => ({ ...b, weight: seedWeight(b) }))
    .filter((b) => b.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

// ── The score ─────────────────────────────────────────────────────────

/** pairScore for one (A, B). 0 when there's nothing to go on. */
function pairScore({ co, fans, seen2, totalActiveUsers, damping = POPULARITY_DAMPING, smoothing = SMOOTHING }) {
  if (!co || !fans || !seen2 || !totalActiveUsers) return 0;
  const affinity = co / (fans + smoothing);
  const baseline = seen2 / totalActiveUsers;
  const lift = affinity / baseline;
  return affinity * Math.pow(lift, damping);
}

// ── The nightly aggregation ───────────────────────────────────────────

/**
 * aggregate(users) -> { totalActiveUsers, popularity, affinity, stats }
 *
 * users: [{ favorites, shows }], one entry per account, with no ids (the job
 * leaves test accounts out before calling this).
 *
 * totalActiveUsers  accounts with at least one show
 * popularity        { key: { name, seen2 } } for seen2 >= MIN_CO_FANS
 * affinity          { A: { name, fans, candidates: [{ key, name, co, pairScore }] } },
 *                   only bands with at least one candidate at co >= MIN_CO_FANS
 */
function aggregate(users, opts = {}) {
  const minCo = opts.minCoFans ?? MIN_CO_FANS;
  const threshold = opts.seenThreshold ?? SEEN_THRESHOLD;
  const topN = opts.topN ?? TOP_N;

  const fans = new Map();      // A -> users who like A
  const seen2 = new Map();     // B -> users who saw B >= threshold
  const co = new Map();        // A -> Map(B -> count)
  const spellings = new Map(); // key -> Map(name -> users using it)
  let totalActiveUsers = 0;

  for (const user of users) {
    const bands = profileBands(user);
    if ((user.shows || []).length > 0) totalActiveUsers++;
    const likes = [];
    const lots = [];
    for (const b of bands.values()) {
      const spelled = spellings.get(b.key) || new Map();
      spelled.set(b.name, (spelled.get(b.name) || 0) + 1);
      spellings.set(b.key, spelled);
      const seenLots = b.timesSeen >= threshold;
      if (seenLots) lots.push(b.key);
      if (b.favorite || seenLots) likes.push(b.key);
    }
    for (const b of lots) seen2.set(b, (seen2.get(b) || 0) + 1);
    for (const a of likes) {
      fans.set(a, (fans.get(a) || 0) + 1);
      let row = co.get(a);
      if (!row) co.set(a, (row = new Map()));
      for (const b of lots) {
        if (b !== a) row.set(b, (row.get(b) || 0) + 1);
      }
    }
  }

  const nameOf = (key) => {
    const s = spellings.get(key);
    if (!s) return key;
    return [...s.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  };

  const popularity = {};
  for (const [key, n] of seen2) {
    if (n >= minCo) popularity[key] = { name: nameOf(key), seen2: n };
  }

  const affinity = {};
  let pairs = 0;
  for (const [a, row] of co) {
    const fansA = fans.get(a) || 0;
    const candidates = [];
    for (const [b, n] of row) {
      if (n < minCo) continue;
      const score = pairScore({ co: n, fans: fansA, seen2: seen2.get(b) || 0, totalActiveUsers });
      if (score > 0) candidates.push({ key: b, name: nameOf(b), co: n, pairScore: round(score) });
    }
    if (!candidates.length) continue;
    candidates.sort((x, y) => y.pairScore - x.pairScore || y.co - x.co || x.name.localeCompare(y.name));
    affinity[a] = { name: nameOf(a), fans: fansA, candidates: candidates.slice(0, topN) };
    pairs += Math.min(candidates.length, topN);
  }

  return {
    totalActiveUsers,
    popularity,
    affinity,
    stats: { users: users.length, totalActiveUsers, bandsWithFans: fans.size, affinityDocs: Object.keys(affinity).length, pairs },
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

// ── Reading it back: Discover ─────────────────────────────────────────

/**
 * recommend({ seeds, affinityDocs, bands, dismissed, limit })
 *   -> [{ key, name, score, because: [seed names], topSeed, topCo }]
 *
 * seeds:        seedsFor(...), heaviest first; only the first MAX_SEED_READS count.
 * affinityDocs: { seedKey: bandAffinity doc } (missing seeds are skipped).
 * bands:        profileBands(...); every band in it is excluded (seen at all, or followed).
 * dismissed:    band keys the user said "not interested" to.
 */
function recommend({ seeds = [], affinityDocs = {}, bands = new Map(), dismissed = [], limit = DISCOVER_LIMIT, maxSeeds = MAX_SEED_READS } = {}) {
  const excluded = new Set([...bands.keys(), ...dismissed]);
  const scored = new Map();
  for (const seed of seeds.slice(0, maxSeeds)) {
    const doc = affinityDocs[seed.key];
    if (!doc || !Array.isArray(doc.candidates)) continue;
    for (const c of doc.candidates) {
      if (!c || !c.key || excluded.has(c.key) || c.key === seed.key) continue;
      if (!(c.co >= MIN_CO_FANS)) continue;
      const contribution = seed.weight * (c.pairScore || 0);
      if (!(contribution > 0)) continue;
      let entry = scored.get(c.key);
      if (!entry) scored.set(c.key, (entry = { key: c.key, name: c.name, score: 0, parts: [] }));
      entry.score += contribution;
      entry.parts.push({ seed: seed.name, contribution, co: c.co });
    }
  }
  return [...scored.values()]
    .map((e) => {
      e.parts.sort((x, y) => y.contribution - x.contribution);
      return {
        key: e.key,
        name: e.name,
        score: round(e.score),
        because: e.parts.slice(0, 2).map((p) => p.seed),
        topSeed: e.parts[0].seed,
        topCo: e.parts[0].co,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "Because you like Goose" / "Goose and Umphrey's McGee". */
function becauseText(because = []) {
  if (!because.length) return '';
  return `Because you like ${because.join(' and ')}`;
}

/**
 * alsoSee(doc, bands, limit) -> the band page's "Fans of X also see…" list:
 * one band's candidates in stored order, minus anything the viewer has seen.
 */
function alsoSee(doc, bands = new Map(), limit = 10) {
  if (!doc || !Array.isArray(doc.candidates)) return [];
  return doc.candidates
    .filter((c) => c && c.key && c.co >= MIN_CO_FANS && !(bands.get(c.key)?.timesSeen > 0))
    .slice(0, limit);
}

// ── Festival picks ────────────────────────────────────────────────────

/**
 * festivalPicks({ lineup, seeds, affinityDocs, bands, dismissed })
 *   -> { recommended, love, everyoneElse }
 *
 * lineup: [{ name, key? }] or names.
 *   love          followed, or seen SEEN_THRESHOLD+ times
 *   recommended   never seen, not followed, scored above 0 (with the reason)
 *   everyoneElse  the rest, alphabetical; seen once gets `seenOnce: true`
 * A lineup band with no affinity data lands in everyoneElse, never dropped.
 * Dismissed bands aren't recommended but stay on the lineup.
 */
function festivalPicks({ lineup = [], seeds = [], affinityDocs = {}, bands = new Map(), dismissed = [] } = {}) {
  const seen = new Set();
  const entries = [];
  for (const item of lineup) {
    const name = String(typeof item === 'string' ? item : item && item.name || '').trim();
    const key = (item && item.key) || bandKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, name });
  }

  const scores = new Map(
    recommend({ seeds, affinityDocs, bands, dismissed, limit: Infinity, maxSeeds: Infinity }).map((r) => [r.key, r])
  );

  const recommended = [];
  const love = [];
  const everyoneElse = [];
  for (const e of entries) {
    const mine = bands.get(e.key);
    const timesSeen = mine ? mine.timesSeen : 0;
    if (mine && (mine.favorite || timesSeen >= SEEN_THRESHOLD)) {
      love.push({ ...e, timesSeen, favorite: !!mine.favorite });
    } else if (!timesSeen && scores.has(e.key)) {
      const r = scores.get(e.key);
      recommended.push({ ...e, score: r.score, because: r.because, topSeed: r.topSeed, topCo: r.topCo });
    } else {
      everyoneElse.push({ ...e, seenOnce: timesSeen === 1 });
    }
  }
  recommended.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  love.sort((a, b) => b.timesSeen - a.timesSeen || a.name.localeCompare(b.name));
  everyoneElse.sort((a, b) => a.name.localeCompare(b.name));
  return { recommended, love, everyoneElse };
}

module.exports = {
  FAVORITE_WEIGHT,
  SEEN_WEIGHT,
  REPEAT_BONUS,
  MAX_REPEAT_BONUS,
  POPULARITY_DAMPING,
  SMOOTHING,
  MIN_CO_FANS,
  SEEN_THRESHOLD,
  TOP_N,
  MAX_SEED_READS,
  DISCOVER_LIMIT,
  bandKey,
  profileBands,
  seedWeight,
  seedsFor,
  pairScore,
  aggregate,
  recommend,
  becauseText,
  alsoSee,
  festivalPicks,
};
