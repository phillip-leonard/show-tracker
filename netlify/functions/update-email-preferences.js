/**
 * update-email-preferences — the Profile screen's two email switches.
 *
 * GET  → { emailOptOut, announcementsOptOut }  the effective state, which
 *        includes an address-level suppression from before they had an
 *        account (so the switches never claim "on" while mail is blocked)
 * POST { emailOptOut?: boolean, announcementsOptOut?: boolean }
 *        At least one. Each value that actually changes writes one
 *        unsubscribeEvents entry (method/source 'profile'), re-subscribes
 *        included. Turning a switch back on also lifts a matching
 *        address-level suppression; that is the one place a suppression
 *        is ever removed, and only by the person it belongs to.
 * Auth header: Authorization: Bearer {idToken}
 */

const { withCors } = require('./lib/cors');
const { getDb, verifyUser } = require('./lib/firebaseAdmin');
const { logUnsubscribeEvent, getSuppressionScope, PROFILE_FIELD } = require('./lib/emailPolicy');
const { normalizeEmail, hashEmail } = require('./lib/unsubscribeToken');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

function effectiveState(profile, suppressionScope) {
  const all = profile?.emailOptOut === true || suppressionScope === 'all';
  return {
    emailOptOut: all,
    announcementsOptOut: all || profile?.announcementsOptOut === true || suppressionScope === 'announcements',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Unauthorized' });

  let db;
  try { db = getDb(); } catch (e) { return reply(500, { error: 'Server not configured' }); }
  const ref = db.doc(`userProfiles/${decoded.uid}`);

  try {
    const snap = await ref.get();
    const profile = snap.exists ? snap.data() : {};
    const email = normalizeEmail(profile.email || decoded.email);
    const suppressionScope = email ? await getSuppressionScope(db, email) : null;
    const before = effectiveState(profile, suppressionScope);

    if (event.httpMethod === 'GET') return reply(200, before);

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
    const wanted = {};
    for (const key of ['emailOptOut', 'announcementsOptOut']) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') return reply(400, { error: `${key} must be a boolean` });
      wanted[key] = body[key];
    }
    if (Object.keys(wanted).length === 0) {
      return reply(400, { error: 'Send emailOptOut and/or announcementsOptOut as booleans' });
    }

    const now = new Date();
    const updates = {};
    const events = [];
    for (const [scope, field] of Object.entries(PROFILE_FIELD)) {
      if (!(field in wanted) || wanted[field] === before[field]) continue;
      // While "all emails" is off, the announcements switch is shown off
      // and disabled; a stray write to it changes nothing.
      if (scope === 'announcements' && (wanted.emailOptOut ?? before.emailOptOut) === true) continue;
      if (wanted[field]) {
        Object.assign(updates, { [field]: true, [`${field}At`]: now, [`${field}Method`]: 'profile', [`${field}Source`]: 'profile' });
      } else {
        Object.assign(updates, { [field]: false, [`${field}At`]: null, [`${field}Method`]: null, [`${field}Source`]: null });
      }
      events.push({ scope, action: wanted[field] ? 'unsubscribe' : 'resubscribe' });
    }

    let remainingSuppression = suppressionScope;
    if (events.length) {
      await ref.set(updates, { merge: true });
      // Re-subscribing lifts an address-level suppression of the same
      // scope, which would otherwise keep blocking what they just turned on.
      const resub = new Set(events.filter((e) => e.action === 'resubscribe').map((e) => e.scope));
      if (suppressionScope && email && resub.has(suppressionScope)) {
        await db.doc(`emailSuppressions/${hashEmail(email)}`).delete();
        remainingSuppression = null;
      }
      for (const e of events) {
        await logUnsubscribeEvent(db, { uid: decoded.uid, email, scope: e.scope, action: e.action, method: 'profile', source: 'profile', now });
      }
    }

    const after = effectiveState({ ...profile, ...updates }, remainingSuppression);
    return reply(200, { success: true, ...after });
  } catch (e) {
    console.error('update-email-preferences error:', e);
    return reply(500, { error: 'Could not update email preferences' });
  }
};

exports.effectiveState = effectiveState;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
