/**
 * Firestore helpers for group meetups — MVP same-show coordination: users
 * planning to attend the same concert can create/join a shared meetup, see
 * who else is going, and discuss logistics in a flat comment thread.
 *
 * There's no single shared "show" document to attach a meetup to — a
 * future show only exists as each user's own private bucket-list entry
 * (lib/bucketList.js) or their own logged show once attended. So a meetup
 * is keyed the same way showComments/showSuggestions already solve this:
 * off a shared `concertKey` (same identity as AppContext's
 * normalizeShowKey() — setlist.fm ID when available, else a normalized
 * artist|venue|date string), not off any one user's private doc id. See
 * lib/comments.js for the precedent this mirrors.
 *
 * Schema:
 *   meetups/{meetupId}          — meetupId = meetupIdFor(concertKey), so
 *                                  two different users' bucket-list entries
 *                                  for the same real-world show always
 *                                  converge on one doc, with no read-then-
 *                                  write race to find-or-create it.
 *     {
 *       concertKey: string,
 *       artist, venue, date, city: string,   // denormalized for display
 *       createdBy: string,        // uid of whoever created the meetup
 *       createdByName: string,
 *       attendeeUids: string[],   // includes the creator
 *       attendeeNames: { [uid]: string }, // display names, for the attendee list
 *       description: string,      // organizer-pinned logistics (where/when to meet)
 *       createdAt: serverTimestamp(),
 *       updatedAt: serverTimestamp() | undefined,
 *     }
 *
 *   meetupComments/{autoId}      — flat discussion thread, no replies/likes
 *     {
 *       meetupId: string,
 *       authorUid: string,
 *       authorName: string,
 *       text: string,
 *       createdAt: serverTimestamp(),
 *     }
 *
 * Joining and leaving go through netlify/functions/meetups.js since
 * 5.60.38; the details and the discussion through moderate-content.
 * Security rules live in firestore.rules — deploy with `npm run
 * deploy:rules` after any change there.
 */

import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { apiUrl, authedFetch } from '@/lib/api';
import { bucketListItemKey } from '@/lib/bucketList';

// Deterministic, Firestore-doc-id-safe key derived from a concertKey (which
// may contain characters a doc id can't, e.g. "AC/DC" in an artist name).
// lib/concertKeys.js, shared with the server and the native app.
export { meetupIdFor } from '@/lib/concertKeys';
import { meetupIdFor } from '@/lib/concertKeys';

async function meetupAction(body) {
  const res = await authedFetch('/.netlify/functions/meetups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't update the meetup.");
  return data;
}

export function subscribeMeetup(concertKey, callback) {
  const id = meetupIdFor(concertKey);
  if (!id) {
    callback(null);
    return () => {};
  }
  return onSnapshot(doc(db, 'meetups', id), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => {
    console.error('[meetups] Listener failed:', err.code || err.message, err);
  });
}

// Creates the meetup for a bucket list item's show if there isn't one, or
// joins it (netlify/functions/meetups.js, 5.60.38, Stage 6 call A). The
// server takes the show from your own bucket list item and every name from
// a profile: the browser used to write the shared document itself, with
// `user.displayName || user.email` as the name. It notifies the organizer.
export async function createOrJoinMeetup(item) {
  // `key` is the item's own document key (listBucketList); else it's built
  // the way addToBucketList named the document.
  const { meetup } = await meetupAction({ action: 'join', bucketListItemKey: item.key || bucketListItemKey(item) });
  return meetup.id;
}

// Joins a meetup that already exists (its page, a notification).
export async function joinMeetup(meetupId) {
  const { meetup } = await meetupAction({ action: 'join', meetupId });
  return meetup.id;
}

export async function leaveMeetup(meetupId) {
  if (!meetupId) return;
  await meetupAction({ action: 'leave', meetupId });
}

/**
 * Set the organizer's pinned description.
 *
 * Goes through moderate-content.js, like the message path above. The
 * meetups rule already restricted this field to the organizer, but a rule
 * decides WHO may write, never WHAT — the organizer could publish a slur
 * to every attendee and the client-side filter was the only thing in the
 * way, which a client can skip. `description` is now pinned shut in
 * firestore.rules and this is the only writer.
 */
export async function updateMeetupDescription(concertKey, description) {
  const id = meetupIdFor(concertKey);
  if (!id) return;

  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to save the details.');

  const res = await fetch(apiUrl('/api/moderate-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'meetupDescription', meetupId: id, description: description || '' }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Couldn't save the details.");
  return payload;
}

export function subscribeMeetupComments(meetupId, callback) {
  if (!meetupId) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'meetupComments'),
    where('meetupId', '==', meetupId),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[meetups] Comments listener failed:', err.code || err.message, err);
  });
}

/**
 * Post to a meetup's discussion thread.
 *
 * Goes through netlify/functions/moderate-content.js rather than writing
 * `meetupComments` directly — same reason as postComment() in
 * lib/comments.js: Guideline 1.2 wants objectionable material filtered
 * before publication, and a browser-only filter can be skipped by anyone
 * holding the Firebase SDK. The create rule on `meetupComments` is closed
 * to clients to match. Throws with a readable message on rejection so the
 * composer can show it inline.
 */
export async function postMeetupComment(meetupId, authorUid, authorName, text) {
  const trimmed = (text || '').trim();
  if (!trimmed || !meetupId) return;

  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in again to post.');

  const res = await fetch(apiUrl('/api/moderate-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'meetupComment', meetupId, text: trimmed, authorName }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Couldn't post that. Please try again.");
  return payload.id;
}

export async function deleteMeetupComment(commentId) {
  await deleteDoc(doc(db, 'meetupComments', commentId));
}
