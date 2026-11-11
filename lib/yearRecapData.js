// lib/yearRecapData.js
//
// The one Firestore read the recap needs beyond the shows already in
// AppContext: the show tags this user sent that were accepted, for the
// show buddy (lib/yearRecap.js computeShowBuddy explains why
// show.taggedFriendUids alone isn't enough). Two equality filters, so no
// composite index is needed.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** [{ toUid, showData }] for every accepted tag `uid` sent; [] on failure. */
export async function loadAcceptedTagsSent(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'showTags'),
      where('fromUid', '==', uid),
      where('status', '==', 'accepted'),
    ));
    return snap.docs.map((d) => {
      const t = d.data();
      return { toUid: t.toUid, showData: t.showData || null };
    });
  } catch (err) {
    console.error('[yearRecap] Failed to load accepted tags:', err?.code || err?.message);
    return [];
  }
}
