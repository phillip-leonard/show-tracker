/**
 * send-email — the app's one browser-initiated email path (tags, invites,
 * friend-joined, suggestion nudges, replies/likes, venue verification,
 * admin messages).
 *
 * POST body:   { type, …ids }   e.g. { type: 'tag', tagId }
 *              See lib/emailAuthorization.js for every type and its ids.
 *              The legacy { to, subject, html, type } shape from the iOS
 *              app ≤ 3.13.5 is still accepted, but only to find the record
 *              behind it: its subject and html are ignored.
 * Auth header: Authorization: Bearer {idToken}   (any signed-in user)
 *
 * HOW IT GOT HERE.
 *   - Until 5.38 it took any to/subject/html from anyone, from any
 *     origin: an open relay. 5.38 added the ID token, the CORS allowlist,
 *     a per-sender hourly limit and server-side opt-out.
 *   - Until 5.59.6 a signed-in user could still send arbitrary HTML to an
 *     arbitrary address (S-06). Now the browser never supplies HTML, a
 *     subject or a free-form recipient: the server checks the caller sent
 *     the tag / invite / notification the email is about, looks the
 *     recipient up itself and builds the email from its own templates
 *     (lib/notificationTemplates.js).
 *
 * Limits: RATE_LIMIT_PER_HOUR across all types, plus a daily limit per
 * type (DAILY_LIMITS in lib/emailAuthorization.js); admins exempt. Each
 * email claims a one-time marker in emailSends/{key}, so the same record
 * is never emailed twice and an invite can't be re-sent within 24 hours.
 *
 * Opt-out (canEmail), the recipient's signed unsubscribe footer and the
 * List-Unsubscribe headers are unchanged.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { requireAccount } = require('./lib/requestAuth');
const { corsHeaders, ALLOWED_ORIGINS } = require('./lib/cors');
const { authorizeEmail } = require('./lib/emailAuthorization');
// The limits, opt-out, one-time marker and send live in
// lib/notificationDelivery.js (5.60.28), shared with friends.js's invites.
const { deliverAuthorized, takeRateLimit, claimSend, emailConfigured, RATE_LIMIT_PER_HOUR } = require('./lib/notificationDelivery');

exports.handler = async function (event) {
  const headers = corsHeaders(event, { methods: 'POST, OPTIONS' });
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  const skipped = (reason) => reply(200, { success: true, skipped: true, reason });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const caller = await requireAccount(event, headers, { message: 'Sign in required' });
  if (caller.response) return caller.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request' });

  if (!emailConfigured()) {
    console.error('[send-email] RESEND_API_KEY or UNSUBSCRIBE_SECRET is not set');
    return reply(503, { error: 'Email is unavailable right now' });
  }

  const db = getDb();
  const auth = getAdminAuth();
  const now = Date.now();

  let decision;
  try {
    decision = await authorizeEmail({ db, auth, now }, caller, body);
  } catch (e) {
    console.error('[send-email] authorization failed:', e.message);
    return reply(500, { error: 'Could not send right now' });
  }
  if (!decision.ok) {
    // Type and reason only, never an address.
    console.log(`[send-email] not sent: ${body.type || 'unknown'} ${decision.reason}${decision.legacy ? ' (legacy)' : ''}`);
    // A legacy client gets a quiet 200, as it always has for a skipped
    // email; so does a recipient who hasn't opted in.
    if (decision.legacy || decision.status === 200) return skipped(decision.reason);
    return reply(decision.status || 403, { error: decision.status === 400 ? 'Invalid request' : 'Not allowed' });
  }

  let outcome;
  try {
    outcome = await deliverAuthorized({ db, now }, caller, decision);
  } catch (e) {
    console.error('[send-email] delivery failed:', e.message);
    return reply(500, { error: 'Could not send right now' });
  }
  if (outcome.sent) return reply(200, { success: true });
  if (outcome.skipped) return skipped(outcome.skipped);
  return reply(outcome.error, { error: outcome.message });
};

exports.takeRateLimit = takeRateLimit;
exports.claimSend = claimSend;
exports.RATE_LIMIT_PER_HOUR = RATE_LIMIT_PER_HOUR;
exports.ALLOWED_ORIGINS = ALLOWED_ORIGINS;
