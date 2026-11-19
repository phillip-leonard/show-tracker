/**
 * festivals — creating, joining, leaving and editing a festival (5.60.36,
 * Stage 5 Part 2). A festival's canonical document is shared: every
 * signed-in user reads it in their matches and on its page, so the apps no
 * longer write it. What each action does is in lib/festivalActions.js.
 *
 *   POST { action: 'create' | 'join' | 'leave' | 'update', ... }
 *   Authorization: Bearer {idToken}
 *     200 { success: true, festival?, already?, detached? }
 *     400 { error, code: 'bad-input', field? } · 401 · 403 account_required
 *     (guests) or not_creator · 404 not_found · 409 conflict · 429
 *
 * Accounts only: guests can't use festivals (DECISIONS.md "Guests").
 * The rules still let the apps write festivals themselves, because iOS
 * 3.13.51 and earlier do; tightening waits for minSupportedIosVersion
 * (docs/ios-native/GATED-CLEANUPS.md).
 */

const { getDb, verifyUser, isAnonymous, isAdmin } = require('./lib/firebaseAdmin');
const { corsHeaders: baseCors } = require('./lib/cors');
const { ACTIONS, Refusal } = require('./lib/festivalActions');

const corsHeaders = (event) => baseCors(event, { methods: 'POST, OPTIONS' });

exports.handler = async function (event) {
  const headers = corsHeaders(event);
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Sign in required' });
  if (isAnonymous(decoded)) return reply(403, { error: 'Create an account to use Festivals.', code: 'account_required' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) {
    return reply(400, { error: 'Unknown action' });
  }

  try {
    const result = await ACTIONS[body.action]({ db: getDb(), uid: decoded.uid, body, isAdmin: isAdmin(decoded) });
    return reply(200, { success: true, ...result });
  } catch (e) {
    if (e instanceof Refusal) {
      const out = { error: e.message };
      if (e.code) out.code = e.code;
      if (e.field) out.field = e.field;
      return reply(e.status, out);
    }
    console.error(`[festivals] ${body.action} failed:`, e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
