/**
 * adopt-guest-shows — a guest signs in to an account they already have:
 * move the guest's shows into it, then delete the guest (5.60.13, native
 * app Part 2, decision D-4).
 *
 *   POST /.netlify/functions/adopt-guest-shows   Auth: Bearer {account idToken}
 *   { guestIdToken, mode: 'preview' | 'commit', includePossible?: [guestShowId] }
 *
 * WHY. A guest upgrades by linking Apple, Google or email to their
 * anonymous account (same uid; account-linked.js does the rest). When that
 * credential already belongs to an account, link() fails ("credential
 * already in use") and the app has to sign in to the existing account,
 * leaving the guest's shows under the anonymous uid. Before switching, the
 * app keeps the guest's ID token; afterwards it calls this with both.
 * Holding both tokens is the proof that one person owns both accounts.
 *
 *   preview  what would happen; writes nothing:
 *            { move, duplicates: [...], possible: [...], upcoming, bands,
 *              wishlistSongs, favoriteTours, bucketListShows, bucketListVenues }
 *   commit   moves the shows, upcoming shows and followed bands, and the
 *            guest's lists (song wishlists, favorite tours, bucket list
 *            shows and venues, 5.60.34), deletes the guest account
 *            (lib/userDataPurge.js), recomputes the account's stats
 *
 * "The same show" is lib/showIdentity.js classifyDuplicate, as everywhere
 * (CLAUDE.md). A setlist.fm-id or same-show match is a duplicate: the
 * account's copy stays and the guest's is dropped. A `possible` match
 * (same band and night, different venue spelling) only moves when the user
 * picked it (`includePossible`); otherwise it is dropped with the guest.
 * Shows are copied as stored: normalize-show built them, and copying keeps
 * the guest's ratings and notes. A show keeps its id unless the account
 * already uses it.
 *
 * Idempotent: a retried commit finds the moved shows as duplicates.
 */

const { withCors } = require('./lib/cors');
const { getDb, getAdminAuth, isAnonymous } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { takeDailyQuota } = require('./lib/rateLimit');
const { purgeUserData } = require('./lib/userDataPurge');
const { recomputeUserStats } = require('./lib/userStats');
const { welcomeEmailAfterAdd } = require('./lib/welcomeEmail');
const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');
const { classifyDuplicate } = require('../../lib/showIdentity');
const { mintShowId } = require('../../lib/showDoc');
const { toIsoDate } = require('../../lib/showDate');

const DAILY_LIMIT = 10;
const BATCH = 400;
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
const bandName = (b) => (typeof b === 'string' ? b : b && b.name) || '';

/**
 * planAdoption({ guestShows, accountShows, includePossible }) → which guest
 * shows move. Pure, for preview, commit and the tests. Each show is
 * { id, ...data }. Guest shows are checked against the account's shows and
 * the ones already chosen to move, so two guest copies of one night move
 * once.
 */
function planAdoption({ guestShows = [], accountShows = [], includePossible = [] } = {}) {
  const picked = new Set((includePossible || []).map(String));
  const compareTo = [...accountShows];
  const move = [];
  const duplicates = [];
  const possible = [];
  for (const show of guestShows) {
    const { id, ...candidate } = show;
    const match = classifyDuplicate(compareTo, candidate);
    const summary = { guestShowId: id, artist: show.artist || '', venue: show.venue || '', date: toIsoDate(show.date) || show.date || '' };
    if (match && match.rule !== 'possible') {
      duplicates.push({ ...summary, existingShowId: match.show.id || null, rule: match.rule });
      continue;
    }
    if (match && match.rule === 'possible' && !picked.has(String(id))) {
      possible.push({ ...summary, existingShowId: match.show.id || null, existing: { venue: match.show.venue || '', date: toIsoDate(match.show.date) || '' } });
      continue;
    }
    move.push(show);
    compareTo.push(show);
  }
  return { move, duplicates, possible };
}

/** Upcoming shows that aren't already on the account (same band and day). */
function planUpcoming(guestUpcoming = [], accountUpcoming = []) {
  const key = (u) => `${lower(u.artist)}|${toIsoDate(u.date) || lower(u.date)}`;
  const have = new Set(accountUpcoming.map(key));
  const out = [];
  for (const u of guestUpcoming) {
    const k = key(u);
    if (have.has(k)) continue;
    have.add(k);
    out.push(u);
  }
  return out;
}

/** The account's followed bands plus the guest's, by name, account's first. */
function mergeFollowedBands(account = [], guest = []) {
  const seen = new Set((account || []).map((b) => lower(bandName(b))).filter(Boolean));
  const added = [];
  for (const b of guest || []) {
    const name = lower(bandName(b));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    added.push(typeof b === 'string' ? { name: b, mbid: null, addedAt: new Date().toISOString() } : b);
  }
  return { merged: [...(account || []), ...added], added: added.length };
}

// ── The guest's lists (5.60.34) ───────────────────────────────────────
// Top-level collections with a `userId` owner field (lib/wishlist.js,
// lib/favoriteTours.js, lib/bucketList.js, lib/bucketListVenues.js). Each is
// moved before the purge deletes it, the account's entry winning on a clash.
// The maps are merged here and written whole, so the result doesn't depend
// on how a merge write treats nested maps.

/** The key a per-item document's id carries after `${uid}_`, or null. */
function keyAfterUid(id, uid) {
  const prefix = `${uid}_`;
  return typeof id === 'string' && id.startsWith(prefix) && id.length > prefix.length ? id.slice(prefix.length) : null;
}

/**
 * planWishlists({ guest, account, accountUid, guestUid }) → { writes: [[id, data]], added }.
 * One wishlist per band (`${uid}_${artistKey}`): the guest's starred songs
 * join the account's for the same band; the account's entry wins a clash.
 */
function planWishlists({ guest = [], account = [], accountUid, guestUid }) {
  const accountByKey = new Map();
  for (const doc of account) {
    const key = keyAfterUid(doc.id, accountUid) || doc.artistKey;
    if (key) accountByKey.set(key, doc);
  }
  const writes = [];
  let added = 0;
  for (const doc of guest) {
    const key = keyAfterUid(doc.id, guestUid) || doc.artistKey;
    const songs = doc.songs && typeof doc.songs === 'object' ? doc.songs : {};
    if (!key || Object.keys(songs).length === 0) continue;
    const mine = accountByKey.get(key) || {};
    const mineSongs = mine.songs && typeof mine.songs === 'object' ? mine.songs : {};
    const newKeys = Object.keys(songs).filter((k) => !(k in mineSongs));
    if (newKeys.length === 0) continue;
    added += newKeys.length;
    writes.push([`${accountUid}_${key}`, {
      userId: accountUid,
      artistKey: mine.artistKey || doc.artistKey || key,
      artistName: mine.artistName || doc.artistName || '',
      artistMbid: mine.artistMbid || doc.artistMbid || null,
      songs: { ...songs, ...mineSongs },
    }]);
  }
  return { writes, added };
}

/** Favorite tours (one `favoriteTours/{uid}` doc, a `tours` map): the guest's join the account's. */
function mergeFavoriteTours(guest = {}, account = {}) {
  const guestTours = guest && guest.tours && typeof guest.tours === 'object' ? guest.tours : {};
  const mine = account && account.tours && typeof account.tours === 'object' ? account.tours : {};
  const added = Object.keys(guestTours).filter((k) => !(k in mine)).length;
  return { tours: { ...guestTours, ...mine }, added };
}

/**
 * planListItems({ guest, account, accountUid, guestUid }) → [[id, data]].
 * One document per item, `${uid}_${itemKey}` (bucketList,
 * bucketListVenues): the guest's items the account doesn't have, owned by
 * the account.
 */
function planListItems({ guest = [], account = [], accountUid, guestUid }) {
  const have = new Set(account.map((d) => d.id));
  const writes = [];
  for (const { id, ...data } of guest) {
    const key = keyAfterUid(id, guestUid);
    if (!key) continue;
    const target = `${accountUid}_${key}`;
    if (have.has(target)) continue;
    have.add(target);
    writes.push([target, { ...data, userId: accountUid }]);
  }
  return writes;
}

async function readOwned(db, collection, uid) {
  const snap = await db.collection(collection).where('userId', '==', uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function readAll(db, path) {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function writeAll(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    writes.slice(i, i + BATCH).forEach(([ref, data, options]) => (options ? batch.set(ref, data, options) : batch.set(ref, data)));
    await batch.commit();
  }
}

/**
 * adopt({ db, auth, accountUid, guestUid, mode, includePossible, bucket, serverTimestamp, purge, welcome })
 * → the preview, or what the commit did.
 *
 * `welcome(showId)` (Stage 4, 5.60.32) runs when the commit moved shows
 * into an account that had none: the welcome email, which a sign-in to an
 * existing account never sent (lib/welcomeEmail.js decides whether it's
 * due). Its outcome is `welcomeEmail` in the answer.
 */
async function adopt({ db, auth, accountUid, guestUid, mode, includePossible = [], bucket = null, serverTimestamp = () => new Date(), purge = purgeUserData, welcome = null }) {
  const [guestShows, accountShows, guestUpcoming, accountUpcoming, guestProfile, accountProfile] = await Promise.all([
    readAll(db, `users/${guestUid}/shows`),
    readAll(db, `users/${accountUid}/shows`),
    readAll(db, `users/${guestUid}/upcomingShows`),
    readAll(db, `users/${accountUid}/upcomingShows`),
    db.doc(`userProfiles/${guestUid}`).get(),
    db.doc(`userProfiles/${accountUid}`).get(),
  ]);
  const [guestWishlists, accountWishlists, guestTours, accountTours, guestBucket, accountBucket, guestVenues, accountVenues] = await Promise.all([
    readOwned(db, 'wishlists', guestUid),
    readOwned(db, 'wishlists', accountUid),
    db.doc(`favoriteTours/${guestUid}`).get(),
    db.doc(`favoriteTours/${accountUid}`).get(),
    readOwned(db, 'bucketList', guestUid),
    readOwned(db, 'bucketList', accountUid),
    readOwned(db, 'bucketListVenues', guestUid),
    readOwned(db, 'bucketListVenues', accountUid),
  ]);
  const plan = planAdoption({ guestShows, accountShows, includePossible });
  const upcoming = planUpcoming(guestUpcoming, accountUpcoming);
  const bands = mergeFollowedBands(
    accountProfile.exists ? accountProfile.data().favoriteArtists : [],
    guestProfile.exists ? guestProfile.data().favoriteArtists : [],
  );
  const wishlists = planWishlists({ guest: guestWishlists, account: accountWishlists, accountUid, guestUid });
  const tours = mergeFavoriteTours(guestTours.exists ? guestTours.data() : {}, accountTours.exists ? accountTours.data() : {});
  const bucketShows = planListItems({ guest: guestBucket, account: accountBucket, accountUid, guestUid });
  const bucketVenues = planListItems({ guest: guestVenues, account: accountVenues, accountUid, guestUid });
  const lists = {
    wishlistSongs: wishlists.added,
    favoriteTours: tours.added,
    bucketListShows: bucketShows.length,
    bucketListVenues: bucketVenues.length,
  };

  if (mode !== 'commit') {
    return { mode: 'preview', move: plan.move.length, duplicates: plan.duplicates, possible: plan.possible, upcoming: upcoming.length, bands: bands.added, ...lists };
  }

  const usedShowIds = new Set(accountShows.map((s) => s.id));
  const showWrites = plan.move.map(({ id, ...data }) => {
    const newId = usedShowIds.has(id) ? mintShowId() : id;
    usedShowIds.add(newId);
    return [db.doc(`users/${accountUid}/shows/${newId}`), data];
  });
  const usedUpcomingIds = new Set(accountUpcoming.map((u) => u.id));
  const upcomingWrites = upcoming.map(({ id, ...data }) => {
    const newId = usedUpcomingIds.has(id) ? db.collection(`users/${accountUid}/upcomingShows`).doc().id : id;
    usedUpcomingIds.add(newId);
    return [db.doc(`users/${accountUid}/upcomingShows/${newId}`), data];
  });
  const now = serverTimestamp();
  const listWrites = [
    ...wishlists.writes.map(([id, data]) => [db.doc(`wishlists/${id}`), { ...data, updatedAt: now }, { merge: true }]),
    ...bucketShows.map(([id, data]) => [db.doc(`bucketList/${id}`), data]),
    ...bucketVenues.map(([id, data]) => [db.doc(`bucketListVenues/${id}`), data]),
  ];
  if (tours.added) {
    listWrites.push([db.doc(`favoriteTours/${accountUid}`), { userId: accountUid, tours: tours.tours, updatedAt: now }, { merge: true }]);
  }
  await writeAll(db, [...showWrites, ...upcomingWrites, ...listWrites]);
  if (bands.added) {
    await db.doc(`userProfiles/${accountUid}`).set({ favoriteArtists: bands.merged }, { merge: true });
  }

  // Only now, with everything copied: the guest account goes, as a deletion
  // would take it. A failure here leaves a guest account with shows that a
  // retry finds as duplicates; nothing is lost.
  const report = await purge({ db, auth, bucket }, guestUid);
  if (report.errors.length) console.error('[adopt-guest-shows] purge finished with errors', JSON.stringify(report.errors));

  let stats = null;
  try {
    const doc = await recomputeUserStats(db, accountUid, { serverTimestamp });
    stats = { ranked: doc.ranked === true, rank: doc.rank, rankedOf: doc.rankedOf };
  } catch (e) {
    console.error('[adopt-guest-shows] stats recompute failed:', e && e.message);
  }

  let welcomeEmail = null;
  if (welcome && accountShows.length === 0 && showWrites.length > 0) {
    try {
      welcomeEmail = (await welcome(showWrites[0][0].id)).status || null;
    } catch (e) {
      console.error('[adopt-guest-shows] welcome email failed:', e && e.message);
      welcomeEmail = 'error';
    }
  }

  return {
    mode: 'commit',
    welcomeEmail,
    moved: showWrites.length,
    duplicates: plan.duplicates.length,
    possibleDropped: plan.possible.length,
    upcomingMoved: upcomingWrites.length,
    bandsAdded: bands.added,
    ...lists,
    guestDeleted: report.authUserDeleted === true,
    stats,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const user = await requireAccount(event, HEADERS);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return reply(400, { error: 'Invalid JSON body.' }); }
  const mode = body.mode === 'commit' ? 'commit' : body.mode === 'preview' ? 'preview' : null;
  if (!mode) return reply(400, { error: "mode must be 'preview' or 'commit'." });
  if (typeof body.guestIdToken !== 'string' || !body.guestIdToken) return reply(400, { error: 'guestIdToken is required.' });
  const includePossible = Array.isArray(body.includePossible) ? body.includePossible.filter((x) => typeof x === 'string').slice(0, 500) : [];

  // The guest's token proves the caller holds the guest account too.
  let guest;
  try {
    guest = await getAdminAuth().verifyIdToken(body.guestIdToken);
  } catch {
    return reply(401, { error: 'The guest session has expired.', code: 'guest_token_invalid' });
  }
  if (!isAnonymous(guest)) return reply(403, { error: 'That is not a guest account.', code: 'not_a_guest' });
  if (guest.uid === user.uid) return reply(400, { error: 'Already the same account.', code: 'same_account' });

  try {
    const db = getDb();
    const quota = await takeDailyQuota(db, `adopt_guest_${user.uid}`, DAILY_LIMIT, { uid: user.uid });
    if (!quota.allowed) return reply(429, { error: 'Try again tomorrow.' }, { 'Retry-After': '3600' });

    let bucket = null;
    if (mode === 'commit') {
      try { bucket = require('firebase-admin/storage').getStorage().bucket(); } catch { /* guests upload nothing */ }
    }
    const { FieldValue } = require('firebase-admin/firestore');
    const result = await adopt({
      db,
      auth: getAdminAuth(),
      accountUid: user.uid,
      guestUid: guest.uid,
      mode,
      includePossible,
      bucket,
      serverTimestamp: () => FieldValue.serverTimestamp(),
      welcome: (showId) => welcomeEmailAfterAdd({
        db, auth: getAdminAuth(), uid: user.uid, showId, readBandIndex: () => loadIndex(openBlobStore(event)),
      }),
    });
    return reply(200, { ok: true, ...result });
  } catch (e) {
    console.error('[adopt-guest-shows] failed:', e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.handler = withCors(exports.handler);
exports.planAdoption = planAdoption;
exports.planUpcoming = planUpcoming;
exports.mergeFollowedBands = mergeFollowedBands;
exports.planWishlists = planWishlists;
exports.mergeFavoriteTours = mergeFavoriteTours;
exports.planListItems = planListItems;
exports.adopt = adopt;
