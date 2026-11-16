/**
 * send-test-push — sends a test push to the caller's own devices, with a
 * link to open (5.60.30, Stage 3 C-7). For checking push delivery and tap
 * routing on a real iPhone: the native app's hidden admin rows call it.
 *
 * Admins only, by the `admin` custom claim alone (hasAdminClaim; C-7 gates
 * on the claim). It sends only to the caller's own `pushTokens`, never to
 * anyone else, and the message is a fixed test, so nothing it sends can
 * be passed off as a real alert.
 *
 * POST { link?: '/notifications/' | '/shows/?show=…' | 'https://mysetlists.net/…' }
 *   → 200 { devices, reached, dead }
 *     403 not an admin, 400 a link that isn't ours, 429 over the daily limit
 *
 * The message has the shape every alert job sends (lib/pushDelivery.js
 * fcmMessage): `data.link` is what a tap opens. A token FCM reports dead is
 * deleted, as the jobs do.
 */

const { getDb, verifyUser, hasAdminClaim } = require('./lib/firebaseAdmin');
const { corsHeaders } = require('./lib/cors');
const { takeDailyQuota } = require('./lib/rateLimit');
const { PUSH_TOKENS, pushToDevices, fcmMessage } = require('./lib/pushDelivery');

const PER_DAY = 100;
const APP_URL = 'https://mysetlists.net';

let testSend = null;
/** Tests: replaces FCM's send(message). */
function __setTestSend(fn) { testSend = fn; }

/** A path on mysetlists.net, as the universal link a push carries; null if it isn't ours. */
function testLink(raw) {
  const value = String(raw || '/notifications/').trim();
  let url;
  try {
    url = new URL(value, APP_URL);
  } catch {
    return null;
  }
  if (url.origin !== APP_URL || value.startsWith('//')) return null;
  return url.toString();
}

exports.handler = async function (event) {
  const headers = corsHeaders(event, { methods: 'POST, OPTIONS' });
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Sign in required', code: 'auth_required' });
  if (!hasAdminClaim(decoded)) return reply(403, { error: 'Not allowed.', code: 'forbidden' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const link = testLink(body.link);
  if (!link) return reply(400, { error: 'The link must be a mysetlists.net page.' });

  try {
    const db = getDb();
    if (!(await takeDailyQuota(db, `test_push_${decoded.uid}`, PER_DAY, { uid: decoded.uid })).allowed) {
      return reply(429, { error: 'That’s enough test pushes for today.' });
    }
    const snap = await db.collection(PUSH_TOKENS).where('userId', '==', decoded.uid).get();
    const devices = snap.docs.map((d) => ({ uid: decoded.uid, token: d.id, legacy: false }));
    const count = devices.length;
    if (!count) return reply(200, { devices: 0, reached: false, dead: 0 });

    const send = testSend || ((message) => require('firebase-admin/messaging').getMessaging().send(message));
    const path = link.slice(APP_URL.length) || '/';
    const { reached, dead } = await pushToDevices({
      db,
      devices,
      sendPush: (token, msg) => send(fcmMessage(token, msg)),
      msg: { title: 'MySetlists test push', body: `Tap to open ${path}`, link, threadId: 'test', notificationId: '' },
      tag: 'test-push',
    });
    return reply(200, { devices: count, reached, dead });
  } catch (e) {
    console.error('[send-test-push] failed:', e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.__setTestSend = __setTestSend;
exports.testLink = testLink;
exports.PER_DAY = PER_DAY;
