/**
 * Browser-side email sending. Every app-initiated email (tags, invites,
 * friend-joined, suggestion nudges, replies/likes, venue verification,
 * admin messages) goes through here to /api/send-email.
 *
 * Since 5.59.6 the browser sends no HTML, subject or address — only the
 * email's type and the id of the record it's about. The server checks the
 * signed-in user is allowed to send it, looks the recipient up and builds
 * the email itself (netlify/functions/lib/emailAuthorization.js). Opt-out,
 * the signed unsubscribe link and List-Unsubscribe are the server's job too.
 *
 *   sendNotification({ type: 'tag', tagId })
 *   sendNotification({ type: 'tag_email', pendingTagId })
 *   sendNotification({ type: 'tag_accepted', pendingTagId })
 *   sendNotification({ type: 'friend_joined' })
 *   sendNotification({ type: 'invite', inviteId })
 *   sendNotification({ type: 'suggestion_nudge', suggestionId })
 *   sendNotification({ type: 'engagement', notificationId })
 *   sendNotification({ type: 'venue_verification', applicationId })
 *   sendNotification({ type: 'admin_message', toUid, subject, body })   admins only
 */

import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

/**
 * Resolves to the fetch Response (or undefined if nobody is signed in).
 * The server answers 200 { skipped: true } when nothing was sent on
 * purpose (the recipient opted out, or the email was already sent).
 */
export async function sendNotification(payload) {
  const user = auth.currentUser;
  if (!user || !payload || !payload.type) return undefined;
  const idToken = await user.getIdToken();
  return fetch(apiUrl('/api/send-email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(payload),
  });
}
