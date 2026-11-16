/**
 * engagement-notify — tells someone their comment or photo was liked, or
 * that someone joined their meetup (5.60.29, Stage 3 C-5).
 *
 * The browser used to write these notifications itself, into the other
 * person's inbox. Now the app likes or joins as before (its own uid in
 * likedBy or attendeeUids) and then asks this function, which writes the
 * notification only if that is in the stored document. Who gets it, who
 * it's from and what it says come from the documents and the caller's
 * profile, never from the request.
 *
 * POST { type: 'comment_like', id: <showComments id>, show?: { artist, venue, date } }
 *      { type: 'photo_like',   id: <showPhotos id> }
 *      { type: 'meetup_join',  id: <meetups id> }
 *   → 200 { written: true } or { written: false, reason }
 *     409 { code: 'not_liked' | 'not_joined' } when the document doesn't say so
 *
 * `show` only fills in the band, venue and date for a comment that was
 * stored without them (before 5.60.29). An account only; a guest gets 403
 * `account_required`.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { corsHeaders } = require('./lib/cors');
const { takeDailyQuota } = require('./lib/rateLimit');
const { notifyEngagement, senderName, MESSAGES, mediaNoun } = require('./lib/engagementNotifications');

// Notifications one account can ask for per UTC day.
const PER_DAY = 500;
const TYPES = { comment_like: 'showComments', photo_like: 'showPhotos', meetup_join: 'meetups' };
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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

  try {
    const db = getDb();
    const snap = await db.doc(`${collection}/${body.id}`).get();
    if (!snap.exists) return reply(404, { error: 'Not found' });
    const item = snap.data();
    const uid = user.uid;

    let recipientUid;
    let show;
    let noun;
    if (body.type === 'meetup_join') {
      if (!(Array.isArray(item.attendeeUids) && item.attendeeUids.includes(uid))) return reply(409, { error: 'You haven’t joined this meetup.', code: 'not_joined' });
      recipientUid = item.createdBy;
      show = { concertKey: item.concertKey, artist: item.artist, venue: item.venue, date: item.date };
    } else {
      if (!(Array.isArray(item.likedBy) && item.likedBy.includes(uid))) return reply(409, { error: 'You haven’t liked this.', code: 'not_liked' });
      recipientUid = body.type === 'photo_like' ? item.uploadedBy : item.authorUid;
      const asked = body.show && typeof body.show === 'object' ? body.show : {};
      show = {
        concertKey: item.concertKey,
        artist: item.artist || str(asked.artist),
        venue: item.venue || str(asked.venue),
        date: item.date || str(asked.date, 40),
      };
      if (body.type === 'photo_like') noun = mediaNoun(item);
    }
    if (!recipientUid || recipientUid === uid) return reply(200, { written: false, reason: 'self' });

    if (!(await takeDailyQuota(db, `engagement_notify_${uid}`, PER_DAY, { uid })).allowed) {
      return reply(429, { error: 'Too many notifications today. Try again tomorrow.' });
    }

    const fromName = await senderName(db, uid, user.name || 'Someone');
    const result = await notifyEngagement({ db, auth: getAdminAuth() }, { uid, name: fromName, displayName: fromName, isAdmin: user.isAdmin }, {
      recipientUid,
      type: body.type,
      show,
      message: MESSAGES[body.type](fromName, show.artist || 'a show', noun),
      // One notification per person per like or join, however often they
      // unlike and like again.
      dedupeId: `${body.type}_${body.id}_${uid}`,
    });
    return reply(200, { written: result.written, ...(result.reason ? { reason: result.reason } : {}) });
  } catch (e) {
    console.error('[engagement-notify] failed:', e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.PER_DAY = PER_DAY;
