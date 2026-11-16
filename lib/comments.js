/**
 * Firestore helpers for concert comments — discussion on a specific
 * concert (artist + venue + date), not tied to any one user's private
 * show record. A prior friend-to-friend "Shared Memories" comment feature
 * (visible only to you + one tagged friend) was built, then deliberately
 * removed in v4.1.1 — this is a different, broader shape: any signed-in
 * user who has logged a matching show can see and post in the thread, not
 * just a tagged pair.
 *
 * "Matching show" uses the same identity as AppContext's
 * normalizeShowKey() (setlist.fm ID when available, else a normalized
 * artist|venue|date string) — the same key that already powers Shows
 * Together and show-suggestion matching, so "is this the same concert"
 * means the same thing everywhere in the app.
 *
 * Schema: top-level `showComments` collection, one doc per comment
 * (top-level or reply — replies are one level deep only, via `parentId`).
 *
 *   showComments/{autoId}
 *     {
 *       concertKey: string,        // normalizeShowKey(show)
 *       parentId: string | null,   // set only on a reply
 *       authorUid: string,
 *       authorName: string,
 *       text: string,
 *       likedBy: string[],         // uids who liked this comment
 *       createdAt: serverTimestamp(),
 *     }
 *
 * Moderation: any authenticated user can delete their own comment;
 * ADMIN_EMAILS (lib/constants.js) can delete any comment. Firestore rules
 * can't import app code, so the admin email is duplicated in
 * firestore.rules — keep the two in sync if that list ever changes.
 *
 * WHY POSTING NO LONGER WRITES FIRESTORE DIRECTLY (v5.32.0). App Store
 * Guideline 1.2 requires objectionable material to be filtered before it
 * is published, and a filter that only runs in the browser is a
 * suggestion — the `showComments` create rule used to let any signed-in
 * user add a document, so anyone with the Firebase SDK could post
 * straight past it. Creation now goes through
 * netlify/functions/moderate-content.js, which runs the same filter
 * (lib/contentFilter.js, mirrored server-side) and is the only path the
 * rules still allow. Reads, likes and deletes are unchanged and still go
 * direct — none of them introduce new text.
 */

import {
  arrayUnion, arrayRemove, collection, deleteDoc, doc,
  onSnapshot, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

export function subscribeComments(concertKey, callback) {
  if (!concertKey) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'showComments'),
    where('concertKey', '==', concertKey),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[comments] Listener failed:', err.code || err.message, err);
    // Without this, a permission-denied/missing-index/offline error leaves
    // the caller's `loading` state stuck true forever, since it only ever
    // flips false inside the success branch of this callback.
    callback([], err);
  });
}

/**
 * Post a comment or a reply.
 *
 * Throws with a human-readable message when the server rejects the text —
 * CommentsSection surfaces it inline under the box, the same way the
 * client-side check does, so a rejection reads the same whichever half
 * caught it. `authorUid` is still taken for the caller's convenience but
 * the server uses the verified token's uid, never this value.
 */
// `show` ({ artist, venue, date }) is stored on the comment so the reply,
// mention and like notifications can name the show (5.60.29).
export async function postComment(concertKey, authorUid, authorName, text, parentId = null, show = null) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to post.');

  const res = await fetch(apiUrl('/api/moderate-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      target: 'showComment',
      concertKey,
      parentId,
      text: trimmed,
      authorName,
      ...(show ? { show: { artist: show.artist || '', venue: show.venue || '', date: show.date || '' } } : {}),
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Couldn't post that. Please try again.");
  return payload.id;
}

export async function toggleCommentLike(commentId, uid, alreadyLiked) {
  await updateDoc(doc(db, 'showComments', commentId), {
    likedBy: alreadyLiked ? arrayRemove(uid) : arrayUnion(uid),
  });
}

export async function deleteComment(commentId) {
  await deleteDoc(doc(db, 'showComments', commentId));
}
