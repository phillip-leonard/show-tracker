/**
 * In-app notifications: the Notification Center's list, and the
 * engagement notifications (someone replied to, mentioned, or liked your
 * comment, liked your photo, or joined your meetup).
 *
 * Since 5.60.29 (Stage 3 C-5) the server writes every engagement
 * notification. Until then the browser wrote them into the other person's
 * inbox, and the rules let any account write any notification to anyone.
 *   - Replies and mentions: moderate-content, when it creates the comment.
 *   - Likes and meetup joins: the app likes or joins as before, then calls
 *     notifyEngagement() below; engagement-notify writes the notification
 *     only if the like or join is in the stored document.
 * Who it's for, who it's from, the message and the opt-in email are all
 * decided there (netlify/functions/lib/engagementNotifications.js).
 *
 * Schema: notifications/{id} { uid, type, message, concertKey, artist,
 * venue, date, fromUid, fromName, read, createdAt }.
 *
 * Linking back to a show: a notification doesn't carry a showId, because
 * concertKey isn't scoped to any one user's private show doc (the same
 * constraint documented in lib/activityFeed.js). The Notification Center
 * resolves a click by finding a show in the recipient's own `shows` whose
 * normalizeShowKey() matches.
 */

import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { authedFetch } from '@/lib/api';

/**
 * After a like or a meetup join: asks the server to notify the owner.
 * `type` is 'comment_like', 'photo_like' or 'meetup_join'; `id` the
 * comment, photo or meetup. `show` ({ artist, venue, date }) names the show
 * for a comment stored before 5.60.29. Best effort: a notification that
 * can't be sent never surfaces as an error on the like or join.
 */
export async function notifyEngagement(type, id, show = null) {
  if (!type || !id) return;
  try {
    const res = await authedFetch('/.netlify/functions/engagement-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        id,
        ...(show ? { show: { artist: show.artist || '', venue: show.venue || '', date: show.date || '' } } : {}),
      }),
    });
    if (!res.ok) console.warn(`[notifications] ${type} not sent (${res.status})`);
  } catch (err) {
    console.error(`[notifications] Failed to send "${type}":`, err.message);
  }
}

// Full history (read + unread) for the Notification Center — separate
// from AppContext's unread-only listener, which only exists to drive the
// sidebar badge.
export function subscribeAllNotifications(uid, callback) {
  if (!uid) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'notifications'),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[notifications] Listener failed:', err.code || err.message, err);
  });
}
