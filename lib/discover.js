// lib/discover.js
//
// The app's side of "Bands you might like": reading the nightly aggregate
// (bandAffinity/*, written by netlify/functions/band-affinity.js) and the
// user's own "not interested" list. The scoring itself is
// lib/recommendations.js, shared with the job.
//
//   bandAffinity/{bandKey}        shared, signed-in read, counts only
//   users/{uid}/discover/prefs    { dismissed: [bandKey] }, owner-only
//
// Affinity docs change once a night, so they're kept in memory for the
// session: moving between Discover, a band screen and a festival doesn't
// read the same document twice.

import { doc, getDoc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const affinityCache = new Map(); // key -> doc data, or null for "no doc"

/** One band's affinity doc, or null when it has none (too little data). */
export async function loadAffinity(key) {
  if (!key) return null;
  if (affinityCache.has(key)) return affinityCache.get(key);
  const snap = await getDoc(doc(db, 'bandAffinity', key));
  const data = snap.exists() ? snap.data() : null;
  affinityCache.set(key, data);
  return data;
}

/**
 * { key: doc } for every key that has one. A read that fails is treated as
 * "no data" for that band rather than failing the whole list.
 */
export async function loadAffinityDocs(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  const docs = await Promise.all(unique.map((k) => loadAffinity(k).catch(() => null)));
  const out = {};
  unique.forEach((k, i) => { if (docs[i]) out[k] = docs[i]; });
  return out;
}

function prefsRef(uid) {
  return doc(db, 'users', uid, 'discover', 'prefs');
}

export async function loadDismissed(uid) {
  if (!uid) return [];
  const snap = await getDoc(prefsRef(uid));
  const list = snap.exists() ? snap.data().dismissed : [];
  return Array.isArray(list) ? list : [];
}

export async function dismissBand(uid, key) {
  await setDoc(prefsRef(uid), { dismissed: arrayUnion(key) }, { merge: true });
}

export async function undismissBand(uid, key) {
  await setDoc(prefsRef(uid), { dismissed: arrayRemove(key) }, { merge: true });
}
