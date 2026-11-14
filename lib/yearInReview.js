// lib/yearInReview.js
//
// The owner's review is computed on the device from the shows already on
// hand (lib/yearInReviewStats.js). The copy a visitor sees on a public
// review is stored in Firestore, and since 5.60.4 its numbers are the
// server's: netlify/functions/lib/userStats.js computes them with the same
// lib/yearInReviewStats.js after every show change (recompute-my-stats)
// and every 6 hours (community-stats), on every review document that
// exists. The app creates the document and sets `privacy`; it no longer
// writes `stats` (iOS 3.13.19 and earlier still do, and the server
// replaces what they write).
//
// Schema:
//   yearInReviews/{uid}_{year}
//     {
//       userId, year, generatedDate: serverTimestamp(),
//       privacy: 'private' | 'public',
//       stats: computeYearInReview(), written by the server,
//       statsComputedAt: serverTimestamp(), written by the server,
//     }

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { authedFetch } from '@/lib/api';

export { computeYearInReview, showYear } from '@/lib/yearInReviewStats';

export function yearInReviewDocId(uid, year) {
  return `${uid}_${year}`;
}

export async function getYearInReview(uid, year) {
  const snap = await getDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeYearInReview(uid, year, callback) {
  if (!uid || !year) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => console.error('[yearInReview] Listener failed:', err.code || err.message, err));
}

// The privacy choice, on a document this creates if it isn't there yet
// (until 5.60.4 a visit by the owner created it). Then the server fills in
// the numbers, awaited, so a review just made public isn't empty for the
// first visitor. If that request fails, the 6-hourly rebuild fills them.
export async function setYearInReviewPrivacy(uid, year, privacy) {
  await setDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), {
    userId: uid,
    year: Number(year),
    generatedDate: serverTimestamp(),
    privacy,
  }, { merge: true });
  await authedFetch('/.netlify/functions/recompute-my-stats', { method: 'POST' })
    .catch((err) => console.warn('[yearInReview] recompute failed; the scheduled run will fill in the numbers', err?.message));
}
