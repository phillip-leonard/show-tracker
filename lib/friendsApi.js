/**
 * Calls to netlify/functions/friends.js. Since 5.59.7 the browser can't
 * write into another user's friends list (S-04), so accepting a request,
 * claiming an email invite and following a referral link go through the
 * server, which checks what justifies the friendship before writing it.
 * Finding a user by email goes there too, so no client ever reads other
 * people's addresses (S-01).
 */

import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

/**
 * POST { action, ...body } with the user's ID token. Resolves to the
 * parsed JSON; throws an Error carrying the server's message on failure.
 */
export async function callFriends(action, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required');
  const token = await user.getIdToken();
  const res = await fetch(apiUrl('/.netlify/functions/friends'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, action }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
