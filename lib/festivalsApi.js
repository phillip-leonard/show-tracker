/**
 * Calls to netlify/functions/festivals.js (5.60.36, Stage 5 Part 2).
 * A festival's canonical document is shared, so creating, joining,
 * leaving and editing one go through the server; see
 * netlify/functions/lib/festivalActions.js.
 */

import { auth, db } from '@/lib/firebase';
import { collection, doc } from 'firebase/firestore';
import { apiUrl } from '@/lib/api';

/** A new attendance id, minted here so a retried create can't make two. */
export function mintAttendanceId(uid) {
  return doc(collection(db, 'users', uid, 'festivals')).id;
}

/**
 * POST { action, ...body } with the user's ID token. Resolves to the
 * parsed JSON; throws an Error carrying the server's message (and its
 * `status`, `code` and `field`) on failure.
 */
export async function callFestivals(action, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required');
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(apiUrl('/.netlify/functions/festivals'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, action }),
    });
  } catch {
    const err = new Error('You’re offline. Try again when you’re connected.');
    err.offline = true;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (data.code) err.code = data.code;
    if (data.field) err.field = data.field;
    throw err;
  }
  return data;
}
