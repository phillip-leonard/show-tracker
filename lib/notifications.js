/**
 * Firestore helpers for in-app notifications — extends the existing
 * `notifications` collection (already used for the one-off
 * "your feedback was published to the roadmap" notice in AdminView.jsx;
 * see context/AppContext.jsx's `unreadNotifications` listener and
 * `markNotificationsRead()`, both pre-existing and reused as-is here) with
 * new types for concert engagement: someone replied to your comment,
 * liked your comment, or liked your photo/video.
 *
 * No Firestore rule change needed — the existing rule already allows any
 * authenticated user to create a notification for anyone (recipient-only
 * read/update), which is exactly "the app decides who deserves a
 * notification, not a per-doc ACL," same precedent as showComments/
 * showPhotos/userActivity.
 *
 * Schema (new fields alongside the pre-existing uid/type/message/read/
 * createdAt/itemId/itemTitle used by roadmap_published):
 *   notifications/{autoId}
 *     {
 *       uid: string,           // recipient
 *       type: 'comment_reply' | 'comment_like' | 'photo_like' | 'roadmap_published',
 *       message: string,       // prebuilt human-readable text
 *       concertKey: string | null,
 *       artist: string | null,
 *       venue: string | null,
 *       date: string | null,
 *       fromUid: string | null,
 *       fromName: string | null,
 *       read: boolean,
 *       createdAt: serverTimestamp(),
 *     }
 *
 * Linking back to a show: a notification doesn't carry a showId, because
 * concertKey isn't scoped to any one user's private show doc (the same
 * constraint documented in lib/activityFeed.js). Instead, the Notification
 * Center resolves a click by finding a show in the *recipient's own*
 * `shows` array whose normalizeShowKey() matches — which always exists,
 * since the recipient could only have gotten a notification here by
 * having logged a matching show (they had to have a comment/photo on it).
 */

import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sendNotification } from '@/lib/email';

export async function createEngagementNotification(recipientUid, type, { concertKey, artist, venue, date, fromUid, fromName, message }) {
  if (!recipientUid || recipientUid === fromUid) return; // never notify yourself
  try {
    const profileSnap = await getDoc(doc(db, 'userProfiles', recipientUid));
    const profile = profileSnap.exists() ? profileSnap.data() : null;
    const prefs = profile?.notificationPrefs;
    if (prefs && prefs.engagementNotifications === false) return;

    const notificationRef = await addDoc(collection(db, 'notifications'), {
      uid: recipientUid,
      type,
      message,
      concertKey: concertKey || null,
      artist: artist || null,
      venue: venue || null,
      date: date || null,
      fromUid: fromUid || null,
      fromName: fromName || null,
      read: false,
      createdAt: serverTimestamp(),
    });

    // Immediate email — opt-in via a Profile preference (default off, so
    // nobody gets emailed just because they never visited that setting).
    // Daily/weekly digest options from the original ask need a scheduled
    // job that doesn't exist in this app yet; only "immediate" is built.
    // The server re-checks the preference and looks the address up itself.
    if (prefs?.emailFrequency === 'immediate') {
      sendNotification({ type: 'engagement', notificationId: notificationRef.id }).catch(() => {});
    }
  } catch (err) {
    // Best-effort — a failed notification should never surface as an
    // error on the like/reply action that triggered it.
    console.error(`[notifications] Failed to create "${type}" for ${recipientUid}:`, err.code || err.message, err);
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
