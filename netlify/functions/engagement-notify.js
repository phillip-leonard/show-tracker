/**
 * engagement-notify — likes on comments and photos, and the notifications
 * for likes and meetup joins (5.60.29, Stage 3 C-5; likes written here
 * since 5.60.38, Stage 6 call A).
 *
 * Liking used to be the browser writing its own uid into `likedBy` on
 * someone else's comment or photo. Now the app asks this function, which
 * writes `likedBy` itself and, on a like, notifies the owner:
 *
 * POST { type: 'comment_like' | 'photo_like', id, liked: true | false, show? }
 *   → 200 { liked, likeCount, written }   written: a notification went out
 *     403 a banned account · 404 no such comment or photo · 429 daily limit
 *
 * The 5.60.29 shape is still answered for builds that like from the phone
 * (iOS 3.13.53 and earlier, docs/ios-native/GATED-CLEANUPS.md): without
 * `liked`, the like must already be in the stored document, and only the
 * notification is written.
 *
 * POST { type: 'comment_like', id: <showComments id>, show?: { artist, venue, date } }
 *      { type: 'photo_like',   id: <showPhotos id> }
 *      { type: 'meetup_join',  id: <meetups id> }
 *   → 200 { written: true } or { written: false, reason }
 *     409 { code: 'not_liked' | 'not_joined' } when the document doesn't say so
 *
 * Meetup joins are written by netlify/functions/meetups.js since 5.60.38,
 * which notifies the organizer itself; `meetup_join` stays for old builds.
 *
 * `show` only fills in the band, venue and date for a comment that was
 * stored without them (before 5.60.29). Who gets a notification, who it's
 * from and what it says come from the documents and the caller's profile,
 * never from the request. An account only; a guest gets 403
 * `account_required`.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { corsHeaders } = require('./lib/cors');
const { takeDailyQuota } = require('./lib/rateLimit');
const { notifyEngagement, senderName, MESSAGES, mediaNoun } = require('./lib/engagementNotifications');

// Notifications one account can ask for per UTC day.
const PER_DAY = 500;
// Likes and unlikes one account can write per UTC day.
const LIKES_PER_DAY = 1000;
const TYPES = { comment_like: 'showComments', photo_like: 'showPhotos', meetup_join: 'meetups' };
const LIKE_TYPES = new Set(['comment_like', 'photo_like']);
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

class Refusal extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}

/** Who a like or join notifies, and about which show. */
function noticeFor(type, item, asked) {
  if (type === 'meetup_join') {
    return {
      recipientUid: item.createdBy,
      show: { concertKey: item.concertKey, artist: item.artist, venue: item.venue, date: item.date },
    };
  }
  const extra = asked && typeof asked === 'object' ? asked : {};
  return {
    recipientUid: type === 'photo_like' ? item.uploadedBy : item.authorUid,
    show: {
      concertKey: item.concertKey,
      artist: item.artist || str(extra.artist),
      venue: item.venue || str(extra.venue),
      date: item.date || str(extra.date, 40),
    },
    noun: type === 'photo_like' ? mediaNoun(item) : undefined,
  };
}

/** Writes the notification for a stored like or join. */
async function sendNotice(db, user, type, id, item, asked) {
  const { recipientUid, show, noun } = noticeFor(type, item, asked);
  if (!recipientUid || recipientUid === user.uid) return { written: false, reason: 'self' };
  if (!(await takeDailyQuota(db, `engagement_notify_${user.uid}`, PER_DAY, { uid: user.uid })).allowed) {
    throw new Refusal(429, { error: 'Too many notifications today. Try again tomorrow.' });
  }
  const fromName = await senderName(db, user.uid, user.name || 'Someone');
  const result = await notifyEngagement({ db, auth: getAdminAuth() }, { uid: user.uid, name: fromName, displayName: fromName, isAdmin: user.isAdmin }, {
    recipientUid,
    type,
    show,
    message: MESSAGES[type](fromName, show.artist || 'a show', noun),
    // One notification per person per like or join, however often they
    // unlike and like again.
    dedupeId: `${type}_${id}_${user.uid}`,
  });
  return { written: result.written, ...(result.reason ? { reason: result.reason } : {}) };
}

/** A like or unlike, written here (Stage 6 call A). */
async function writeLike(db, user, type, id, liked, asked) {
  const profile = await db.doc(`userProfiles/${user.uid}`).get();
  if (profile.exists && profile.data().banned === true) {
    throw new Refusal(403, { error: 'Your account can no longer do that.', code: 'banned' });
  }
  if (!(await takeDailyQuota(db, `likes_${user.uid}`, LIKES_PER_DAY, { uid: user.uid })).allowed) {
    throw new Refusal(429, { error: 'That’s a lot of likes for one day. Try again tomorrow.' });
  }
  const ref = db.doc(`${TYPES[type]}/${id}`);
  const item = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Refusal(404, { error: 'Not found' });
    const data = snap.data();
    const before = Array.isArray(data.likedBy) ? data.likedBy : [];
    const has = before.includes(user.uid);
    const likedBy = liked ? (has ? before : [...before, user.uid]) : before.filter((u) => u !== user.uid);
    if (has !== liked) tx.update(ref, { likedBy });
    return { ...data, likedBy };
  });
  const notice = liked ? await sendNotice(db, user, type, id, item, asked).catch((e) => {
    if (e instanceof Refusal) return { written: false, reason: 'limit' };
    console.error('[engagement-notify] like notification failed (the like stands):', e.message);
    return { written: false, reason: 'error' };
  }) : { written: false };
  return { liked, likeCount: item.likedBy.length, written: notice.written };
}

exports.handler = async function (event) {
  const headers = corsHeaders(event, { methods: 'POST, OPTIONS' });
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const user = await requireAccount(event, headers);
  if (user.response) return user.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const collection = TYPES[body && body.type];
  if (!collection || !isId(body.id)) return reply(400, { error: 'Which like or meetup?' });
  const writing = typeof body.liked === 'boolean';
  if (writing && !LIKE_TYPES.has(body.type)) return reply(400, { error: 'Only comments and photos can be liked.' });

  try {
    const db = getDb();
    if (writing) return reply(200, await writeLike(db, user, body.type, body.id, body.liked, body.show));

    // The 5.60.29 shape: the like or join is already stored.
    const snap = await db.doc(`${collection}/${body.id}`).get();
    if (!snap.exists) return reply(404, { error: 'Not found' });
    const item = snap.data();
    if (body.type === 'meetup_join') {
      if (!(Array.isArray(item.attendeeUids) && item.attendeeUids.includes(user.uid))) return reply(409, { error: 'You haven’t joined this meetup.', code: 'not_joined' });
    } else if (!(Array.isArray(item.likedBy) && item.likedBy.includes(user.uid))) {
      return reply(409, { error: 'You haven’t liked this.', code: 'not_liked' });
    }
    return reply(200, await sendNotice(db, user, body.type, body.id, item, body.show));
  } catch (e) {
    if (e instanceof Refusal) return reply(e.status, e.body);
    console.error('[engagement-notify] failed:', e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.PER_DAY = PER_DAY;
exports.LIKES_PER_DAY = LIKES_PER_DAY;
exports.sendNotice = sendNotice;
