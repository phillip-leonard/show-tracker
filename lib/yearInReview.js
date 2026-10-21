// lib/yearInReview.js
//
// The recap itself is computed purely from shows already on hand, in
// lib/yearInReviewStats.js (no Firebase, so it is unit tested). Firestore is
// only used here, to cache the generated result and to store the user's
// privacy choice for the shareable page (see saveYearInReview /
// subscribeYearInReview below).
//
// Schema:
//   yearInReviews/{uid}_{year}
//     {
//       userId, year, generatedDate: serverTimestamp(),
//       privacy: 'private' | 'public',
//       stats: { ...whatever computeYearInReview() returned },
//     }

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export { computeYearInReview, showYear } from '@/lib/yearInReviewStats';

export function yearInReviewDocId(uid, year) {
  return `${uid}_${year}`;
}

export async function saveYearInReview(uid, year, stats, privacy = 'private') {
  await setDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), {
    userId: uid,
    year,
    generatedDate: serverTimestamp(),
    privacy,
    stats,
  }, { merge: true });
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

export async function setYearInReviewPrivacy(uid, year, privacy) {
  await setDoc(doc(db, 'yearInReviews', yearInReviewDocId(uid, year)), { privacy }, { merge: true });
}
