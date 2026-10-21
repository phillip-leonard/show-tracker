/**
 * Firestore helpers for the "venue bucket list" — venues a user wants to
 * see *any* show at, distinct from lib/bucketList.js (a specific
 * artist+venue+date they want to attend). Keyed the same way lib/venues.js
 * keys a Venue doc (`${name}::${city}`) so it's directly joinable with the
 * venue detail page and the daily match job below.
 *
 * Schema: top-level `bucketListVenues` collection, one doc per entry, doc
 * id `${uid}_${venueKey}` — same "top-level collection + owner-uid field"
 * convention as lib/bucketList.js, reusing its already-deployed rule shape.
 *
 *   bucketListVenues/{uid}_{venueKey}
 *     {
 *       userId: string,
 *       venueKey: string,
 *       venueName: string,
 *       venueCity: string | null,
 *       venueState: string | null,
 *       addedAt: serverTimestamp,
 *     }
 *
 * Matching: netlify/functions/followed-band-notifications-background.js
 * (logic in netlify/functions/lib/followedBandAlerts.js) is a daily job
 * that checks every followed band's upcoming Ticketmaster dates against
 * each follower's bucket-list venues and creates one
 * `venue_bucket_list_match` notification per user per date.
 *
 * Security rule lives in firestore.rules — deploy with `npm run
 * deploy:rules` after any change there.
 */

import { doc, setDoc, deleteDoc, serverTimestamp, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { venueKeyFor } from '@/lib/venues';

function docId(uid, venueKey) {
  return `${uid}_${venueKey}`;
}

export async function addVenueToBucketList(uid, { venueName, venueCity, venueState }) {
  const venueKey = venueKeyFor(venueName, venueCity);
  if (!venueKey) throw new Error('Venue name is required.');
  const ref = doc(db, 'bucketListVenues', docId(uid, venueKey));
  await setDoc(ref, {
    userId: uid,
    venueKey,
    venueName: venueName || '',
    venueCity: venueCity || null,
    venueState: venueState || null,
    addedAt: serverTimestamp(),
  }, { merge: true });
  return venueKey;
}

export async function removeVenueFromBucketList(uid, venueKey) {
  try {
    await deleteDoc(doc(db, 'bucketListVenues', docId(uid, venueKey)));
  } catch (err) {
    if (err.code === 'not-found') return;
    console.error(`[bucketListVenues] Failed to remove ${venueKey}:`, err.code || err.message, err);
    throw err;
  }
}

export function subscribeBucketListVenues(uid, callback) {
  if (!uid) { callback([]); return () => {}; }
  return onSnapshot(
    query(collection(db, 'bucketListVenues'), where('userId', '==', uid)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('[bucketListVenues] Listener failed:', err.code || err.message, err)
  );
}
