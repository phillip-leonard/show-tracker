/**
 * year-recap — the parts of a Year in Review that can't be stored on the
 * review document (Stage 6, call D), computed on the server so the web and
 * the native app show the same answer.
 *
 *   POST { year }
 *   Authorization: Bearer {idToken}
 *     200 { year, recap, rarity: { rarest, bustOuts }, buddy }
 *     400 bad year · 401 · 403 account_required (guests) · 429
 *
 * - recap: yearInReviews/{uid}_{year}.recap as stored (lib/yearRecap.js,
 *   written by the server since 5.60.16), else computed from the caller's
 *   stored shows; null for a year with no shows.
 * - rarity: the rarest catch and the bust-outs witnessed, for the bands
 *   with a full setlist archive (lib/yearRecapRarity.js), from the band-page
 *   snapshot's show lists read in-process (what /api/artist-shows serves).
 *   A band whose list can't be loaded is left out.
 * - buddy: the friend at the most of the year's shows (lib/yearRecap.js
 *   computeShowBuddy), from the caller's own accepted sent tags, the tags
 *   on their shows and their friends list, without anyone they've blocked.
 *   { uid, name, firstName, shows } or null.
 *
 * The rarity and the buddy aren't put on the review document because a
 * review made public is readable by anyone, and the buddy names a friend.
 * Accounts only, like friends and reviews.
 */

const { withCors } = require('./lib/cors');
const { requireAccount } = require('./lib/requestAuth');
const { getDb } = require('./lib/firebaseAdmin');
const { takeDailyQuota } = require('./lib/rateLimit');
const { userShows } = require('./lib/normalizeShowServer');
const { computeYearRecap, computeShowBuddy, showsInYear } = require('../../lib/yearRecap');
const { loadYearRarity } = require('../../lib/yearRecapRarity');

const PER_DAY = 300;
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

/** One band's /api/artist-shows JSON from the snapshot, or null. */
function snapshotLoader(event) {
  const { openBlobStore, loadArtistShows } = require('./lib/publicArtistSnapshot');
  const { artistShowsJson } = require('./lib/publicArtistPages');
  let store = null;
  return async (slug) => {
    try {
      if (!store) store = openBlobStore(event);
      const res = artistShowsJson(await loadArtistShows(store, slug));
      if (res.statusCode !== 200) return null;
      const json = JSON.parse(res.body);
      return json && json.ok !== false && Array.isArray(json.shows) ? json : null;
    } catch (e) {
      console.warn(`[year-recap] ${slug} archive not loaded:`, e && e.message);
      return null;
    }
  };
}

async function readBuddy(db, uid, yearShows) {
  const [tags, friends, blocks] = await Promise.all([
    db.collection('showTags').where('fromUid', '==', uid).where('status', '==', 'accepted').get(),
    db.collection(`users/${uid}/friends`).get(),
    db.doc(`userBlocks/${uid}`).get(),
  ]);
  const blocked = new Set(blocks.exists && Array.isArray(blocks.data().blockedUserIds) ? blocks.data().blockedUserIds : []);
  const accepted = tags.docs.map((d) => ({ toUid: d.data().toUid, showData: d.data().showData || null }));
  const list = friends.docs
    .map((d) => ({ friendUid: d.data().friendUid || d.id, friendName: d.data().friendName || '' }))
    .filter((f) => f.friendUid && !blocked.has(f.friendUid));
  return computeShowBuddy(yearShows, accepted, list);
}

// Replaced in the tests (__setTestDeps): the archive loader.
let testDeps = {};
function __setTestDeps(deps) { testDeps = deps || {}; }

exports.handler = async function (event) {
  const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const user = await requireAccount(event, HEADERS);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const year = Number(body && body.year);
  if (!Number.isInteger(year) || year < 1950 || year > 2100) return reply(400, { error: 'Which year?' });

  try {
    const db = getDb();
    if (!(await takeDailyQuota(db, `year_recap_${user.uid}`, PER_DAY, { uid: user.uid })).allowed) {
      return reply(429, { error: 'Too many requests today. Please try again tomorrow.' }, { 'Retry-After': '3600' });
    }
    const [shows, review] = await Promise.all([
      userShows(db, user.uid),
      db.doc(`yearInReviews/${user.uid}_${year}`).get(),
    ]);
    const yearShows = showsInYear(shows, year);
    const stored = review.exists ? review.data().recap : undefined;
    const recap = stored !== undefined ? stored : computeYearRecap(shows, year);
    const [rarity, buddy] = await Promise.all([
      yearShows.length ? loadYearRarity(yearShows, testDeps.loadArchive || snapshotLoader(event)) : { rarest: null, bustOuts: [] },
      yearShows.length ? readBuddy(db, user.uid, yearShows) : null,
    ]);
    return reply(200, { year, recap: recap || null, rarity, buddy: buddy || null });
  } catch (e) {
    console.error('[year-recap] failed:', e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.PER_DAY = PER_DAY;
exports.__setTestDeps = __setTestDeps;
module.exports.handler = withCors(module.exports.handler);
