// lib/appConfig.js — reading config/app from the app (5.59.14).
//
// The pure rules live in lib/appVersion.js (tested without Firebase); this
// is the Firestore half they are given.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { APP_CONFIG_DOC, isPushOfferEnabled } from '@/lib/appVersion';

export async function readAppConfig() {
  const snap = await getDoc(doc(db, ...APP_CONFIG_DOC));
  return snap.exists() ? snap.data() : null;
}

/** config/app.iosPushOfferEnabled, cached for ten minutes; false on any error. */
export function pushOfferEnabled(opts) {
  return isPushOfferEnabled(readAppConfig, opts);
}
