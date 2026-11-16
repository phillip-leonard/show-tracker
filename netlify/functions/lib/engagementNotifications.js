/**
 * engagementNotifications — "X replied to your comment", "X liked your
 * photo" and the rest, written by the server (5.60.29, Stage 3 C-5).
 *
 * Until now the browser wrote these into the other person's inbox
 * (lib/notifications.js createEngagementNotification), and the rules let
 * any account write any notification to anyone. Now:
 *   - moderate-content writes comment_reply and comment_mention when it
 *     creates the comment;
 *   - engagement-notify writes comment_like, photo_like and meetup_join
 *     once it has checked the like or the join is in the stored document.
 * The recipient, sender, name and message are the server's, never the
 * request's.
 *
 *   notifyEngagement({ db, auth }, caller, {
 *     recipientUid, type, show: { concertKey, artist, venue, date },
 *     message, dedupeId?,
 *   })  → { written: boolean, reason?, emailed? }
 *
 * Nothing is written for yourself, across a block, or for someone who
 * turned engagement notifications off. With `dedupeId` the notification
 * has that id, so liking, unliking and liking again notifies once. The
 * immediate email (opt-in, notificationPrefs.emailFrequency) goes through
 * lib/emailAuthorization.js `engagement`, as send-email sent it.
 */

const { authorizeEmail, ENGAGEMENT_TYPES } = require('./emailAuthorization');
const { deliverAuthorized } = require('./notificationDelivery');
const { blockedBetween } = require('./blocks');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The display name a notification carries, from the sender's profile. */
async function senderName(db, uid, fallback = 'Someone') {
  try {
    const snap = await db.doc(`userProfiles/${uid}`).get();
    const p = snap.exists ? snap.data() : {};
    return str(p.displayName || p.firstName, 80) || fallback;
  } catch {
    return fallback;
  }
}

/** The messages, in the web's words (CommentsSection, MediaGalleryView, meetups). */
const MESSAGES = {
  comment_reply: (from, artist) => `${from} replied to your comment on ${artist}`,
  comment_mention: (from, artist) => `${from} mentioned you in a comment on ${artist}`,
  comment_like: (from, artist) => `${from} liked your comment on ${artist}`,
  photo_like: (from, artist, noun = 'photo') => `${from} liked your ${noun} from ${artist}`,
  meetup_join: (from, artist) => `${from} is meeting up with you at ${artist}`,
};

/** What a photo is called in a like: the web's LABEL_BY_CATEGORY, else photo or video. */
function mediaNoun(item) {
  if (item.category === 'poster') return 'poster';
  if (item.category === 'setlist') return 'setlist photo';
  return item.type === 'image' || !item.type ? 'photo' : 'video';
}

async function notifyEngagement({ db, auth }, caller, { recipientUid, type, show = {}, message, dedupeId = null }) {
  if (!ENGAGEMENT_TYPES.includes(type)) throw new Error(`unknown engagement type ${type}`);
  if (!recipientUid || recipientUid === caller.uid) return { written: false, reason: 'self' };
  if (await blockedBetween(db, caller.uid, recipientUid)) return { written: false, reason: 'blocked' };

  const profileSnap = await db.doc(`userProfiles/${recipientUid}`).get();
  if (!profileSnap.exists) return { written: false, reason: 'no_recipient' };
  const prefs = profileSnap.data().notificationPrefs || {};
  if (prefs.engagementNotifications === false) return { written: false, reason: 'opted_out' };

  const doc = {
    uid: recipientUid,
    type,
    message: str(message, 500),
    concertKey: str(show.concertKey, 300) || null,
    artist: str(show.artist) || null,
    venue: str(show.venue) || null,
    date: str(show.date, 40) || null,
    fromUid: caller.uid,
    fromName: caller.displayName || null,
    read: false,
    createdAt: new Date(),
  };
  let ref;
  if (dedupeId) {
    ref = db.collection('notifications').doc(dedupeId);
    try {
      await ref.create(doc);
    } catch (e) {
      if (e && (e.code === 6 || /ALREADY_EXISTS/.test(e.message || ''))) return { written: false, reason: 'already_notified' };
      throw e;
    }
  } else {
    ref = await db.collection('notifications').add(doc);
  }

  let emailed = false;
  if (prefs.emailFrequency === 'immediate') {
    try {
      const now = Date.now();
      const decision = await authorizeEmail({ db, auth, now }, caller, { type: 'engagement', notificationId: ref.id });
      if (decision.ok) emailed = !!(await deliverAuthorized({ db, now }, caller, decision)).sent;
    } catch (e) {
      console.warn('[engagement] email failed (the notification stands):', e.message);
    }
  }
  return { written: true, id: ref.id, emailed };
}

module.exports = { notifyEngagement, senderName, MESSAGES, mediaNoun };
