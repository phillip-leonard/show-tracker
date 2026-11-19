/**
 * activityLog — the friend activity feed, written and read on the server
 * (5.60.38, Stage 6 call B).
 *
 * Until now the browser wrote `userActivity` itself and read its friends'
 * entries with `where userId in [...]`. The rule let any account read any
 * entry, so "friends only" was just the query the web chose to run, and the
 * native app wrote nothing. Now:
 *
 *   recordActivity(db, uid, action, fields)  one entry, written by
 *     normalize-show (added_show), moderate-content (commented,
 *     shared_media) and friends.js `rated` (rated_show). Nothing is written
 *     for an account with `shareActivity: false`. `fields.id` names the
 *     document, so a retry rewrites the same entry instead of adding one.
 *     Best effort: it never throws.
 *
 *   readFriendActivity(db, uid, { before, limit })  friends.js `activity`:
 *     the newest entries of the caller's mutual friends, blocks either way
 *     and opted-out friends left out, deduplicated (below), newest first.
 *
 * userActivity/{id}
 *   { userId, userName, action, showId, artist, venue, rating?, mediaCategory?,
 *     commentId?, handle, timestamp }
 *
 * `handle` is the actor's handle when their public profile is on at the
 * time, so a row can link to /u/<handle>/shows/<showId>; otherwise null.
 *
 * DEDUPLICATION. iOS 3.13.53 and earlier still write their own entries
 * (with random ids) next to the server's until minSupportedIosVersion
 * passes them (docs/ios-native/GATED-CLEANUPS.md), so one add can arrive
 * twice. Entries by one person, with one action, about one show, within
 * DEDUPE_MS of each other are one entry: the newest is kept. A comment's
 * entry also carries its commentId, so two comments on a show minutes apart
 * from the server are both kept.
 */

const ACTIONS = new Set(['added_show', 'rated_show', 'commented', 'shared_media']);
const MEDIA_CATEGORIES = new Set(['photo', 'poster', 'setlist']);
const DEDUPE_MS = 5 * 60 * 1000;
const PAGE = 100;
// Firestore's `in` takes at most 30 values.
const IN_CHUNK = 30;
// Each chunk's newest entries; a page is the newest PAGE of all of them.
const PER_CHUNK = 100;
const MAX_FRIENDS = 1000;

const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const millis = (ts) => {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const n = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
};

/** Writes one entry; { written, reason? }. Never throws. */
async function recordActivity(db, uid, action, fields = {}, { now = new Date() } = {}) {
  try {
    if (!uid || !ACTIONS.has(action)) return { written: false, reason: 'bad-input' };
    const snap = await db.doc(`userProfiles/${uid}`).get();
    const profile = snap.exists ? snap.data() : {};
    if (profile.shareActivity === false) return { written: false, reason: 'opted-out' };
    const entry = {
      userId: uid,
      userName: str(profile.displayName || profile.firstName, 80) || 'A friend',
      action,
      showId: str(fields.showId, 128),
      artist: str(fields.artist) || '',
      venue: str(fields.venue),
      handle: profile.publicProfile ? str(profile.handle, 40) : null,
      timestamp: now,
    };
    if (action === 'rated_show') entry.rating = typeof fields.rating === 'number' ? fields.rating : null;
    if (action === 'shared_media') entry.mediaCategory = MEDIA_CATEGORIES.has(fields.mediaCategory) ? fields.mediaCategory : 'photo';
    if (action === 'commented' && fields.commentId) entry.commentId = str(fields.commentId, 128);
    const id = str(fields.id, 300) || `${action}_${uid}_${entry.showId || now.getTime()}`;
    await db.doc(`userActivity/${id.replace(/\//g, '_')}`).set(entry);
    return { written: true, id };
  } catch (e) {
    console.error(`[activityLog] ${action} for ${uid} not written:`, e.message);
    return { written: false, reason: 'error' };
  }
}

/** Collapses one person's same action on one show within DEDUPE_MS; input newest first. */
function dedupe(items) {
  const kept = [];
  for (const item of items) {
    const twin = kept.find((k) => k.userId === item.userId && k.action === item.action
      && k.showId && k.showId === item.showId
      && !(k.commentId && item.commentId && k.commentId !== item.commentId)
      && Math.abs(k.timestamp - item.timestamp) <= DEDUPE_MS);
    if (!twin) kept.push(item);
  }
  return kept;
}

/** What the apps get for an entry: stored fields, the time in ms. */
function view(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    userId: d.userId,
    userName: d.userName || 'A friend',
    action: d.action,
    showId: d.showId || null,
    artist: d.artist || '',
    venue: d.venue || null,
    ...(d.action === 'rated_show' ? { rating: d.rating == null ? null : d.rating } : {}),
    ...(d.action === 'shared_media' ? { mediaCategory: d.mediaCategory || 'photo' } : {}),
    ...(d.commentId ? { commentId: d.commentId } : {}),
    handle: d.handle || null,
    timestamp: millis(d.timestamp),
  };
}

/**
 * The caller's mutual friends who share their activity, with blocks either
 * way left out. One read of each list and profile.
 */
async function feedFriends(db, uid) {
  const [mine, myBlocks] = await Promise.all([
    db.collection(`users/${uid}/friends`).get(),
    db.doc(`userBlocks/${uid}`).get(),
  ]);
  const blocked = new Set(myBlocks.exists && Array.isArray(myBlocks.data().blockedUserIds) ? myBlocks.data().blockedUserIds : []);
  const candidates = mine.docs.map((d) => d.id).filter((id) => id && id !== uid && !blocked.has(id)).slice(0, MAX_FRIENDS);
  const checks = await Promise.all(candidates.map(async (friendUid) => {
    const [back, theirBlocks, profile] = await Promise.all([
      db.doc(`users/${friendUid}/friends/${uid}`).get(),
      db.doc(`userBlocks/${friendUid}`).get(),
      db.doc(`userProfiles/${friendUid}`).get(),
    ]);
    if (!back.exists) return null;
    const theirList = theirBlocks.exists && Array.isArray(theirBlocks.data().blockedUserIds) ? theirBlocks.data().blockedUserIds : [];
    if (theirList.includes(uid)) return null;
    if (profile.exists && profile.data().shareActivity === false) return null;
    return friendUid;
  }));
  return checks.filter(Boolean);
}

/** { items, next }: `next` is the `before` for the following page, or null. */
async function readFriendActivity(db, uid, { before = null, limit = PAGE } = {}) {
  const friends = await feedFriends(db, uid);
  if (!friends.length) return { items: [], next: null, friends: 0 };
  const beforeMs = Number(before);
  const cutoff = Number.isFinite(beforeMs) && beforeMs > 0 ? new Date(beforeMs) : null;
  const all = [];
  for (let i = 0; i < friends.length; i += IN_CHUNK) {
    let q = db.collection('userActivity').where('userId', 'in', friends.slice(i, i + IN_CHUNK));
    if (cutoff) q = q.where('timestamp', '<', cutoff);
    const snap = await q.orderBy('timestamp', 'desc').limit(PER_CHUNK).get();
    for (const doc of snap.docs) {
      const item = view(doc);
      if (ACTIONS.has(item.action)) all.push(item);
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  const page = dedupe(all).slice(0, Math.max(1, Math.min(limit, PAGE)));
  const full = page.length === Math.min(limit, PAGE);
  return { items: page, next: full ? page[page.length - 1].timestamp : null, friends: friends.length };
}

module.exports = { recordActivity, readFriendActivity, dedupe, ACTIONS, DEDUPE_MS, PAGE };
