/**
 * send-welcome-email — the welcome email after a new account's first show
 * (5.55.0). The rules are netlify/functions/lib/welcomeEmail.js; this is
 * the door.
 *
 * POST {}                     the signed-in user's own welcome email, if
 *                             they're due one. Body may carry { showId },
 *                             the show just saved, for the personal line.
 * POST { test: true }         admin only: the welcome email with sample
 *                             data, to the admin's own address. Writes
 *                             nothing. { variant: 'band_page' } (the
 *                             default) is a Goose show, with the band line
 *                             if Goose's page is published, through the
 *                             same lookup a real send uses;
 *                             { variant: 'no_band_page' } is a band with
 *                             no page.
 * Auth header: Authorization: Bearer {idToken}
 *
 * The uid always comes from the token. There is no way to name another
 * user, so there is no way to send someone else's welcome email.
 *
 * Called fire-and-forget by the app (lib/welcomeEmailTrigger.js) after a
 * save that took the account from 0 shows to some. Answers 200 with the
 * outcome for everything except a bad request or missing config, so a
 * skipped send never shows up as an error in the app.
 */

const { getDb, getAdminAuth, verifyUser, isAdminClaims, ADMIN_EMAILS } = require('./lib/firebaseAdmin');
const { processWelcomeEmail, bandPageFor } = require('./lib/welcomeEmail');
const { welcomeEmail, SAMPLES } = require('./lib/welcomeEmailTemplate');
const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');
const { buildEmail, sendOne } = require('./lib/outgoingEmail');
const { normalizeEmail } = require('./lib/unsubscribeToken');

const ALLOWED_ORIGINS = [
  'https://mysetlists.net',
  'https://www.mysetlists.net',
  'capacitor://localhost', // the iOS app
];

function corsHeaders(event) {
  const origin = (event.headers || {}).origin || (event.headers || {}).Origin || '';
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

// Replies reach Phillip: the address announcements use, or the admin's
// own (which is what an announcement falls back to as well).
function replyToAddress() {
  return process.env.ANNOUNCEMENT_REPLY_TO || ADMIN_EMAILS[0];
}

// The band page lookup's index read (lib/welcomeEmail.js bandPageFor).
// Opening the store is inside the reader, so a Blobs failure is the
// lookup's failure, which drops the band line and nothing else.
let bandIndexReader = (event) => () => loadIndex(openBlobStore(event));

exports.handler = async function (event) {
  const headers = corsHeaders(event);
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Sign in required' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }

  // Checked before anything is claimed, so a missing secret doesn't use
  // up anyone's attempts.
  if (!process.env.RESEND_API_KEY) return reply(500, { error: 'RESEND_API_KEY not configured' });
  if (!process.env.UNSUBSCRIBE_SECRET) return reply(500, { error: 'UNSUBSCRIBE_SECRET not configured' });

  if (body.test === true) {
    if (!isAdminClaims(decoded)) return reply(403, { error: 'Admin only' });
    const to = normalizeEmail(decoded.email);
    const variant = body.variant === 'no_band_page' ? 'no_band_page' : 'band_page';
    const sample = SAMPLES[variant];
    const bandPage = await bandPageFor(sample.artist, bandIndexReader(event));
    const { subject, html } = welcomeEmail({ ...sample, bandPage });
    const payload = buildEmail({
      recipient: { email: to, uid: decoded.uid },
      subject: `[Test] ${subject}`,
      html,
      scope: 'all',
      source: 'notification:welcome',
      replyTo: replyToAddress(),
    });
    const r = await sendOne(payload);
    return r.ok
      ? reply(200, { status: 'sent', to, variant, bandPage, resendId: r.id || null })
      : reply(502, { error: 'Send failed', detail: r.error });
  }

  try {
    const result = await processWelcomeEmail({
      db: getDb(),
      auth: getAdminAuth(),
      uid: decoded.uid,
      showId: typeof body.showId === 'string' ? body.showId : null,
      replyTo: replyToAddress(),
      readBandIndex: bandIndexReader(event),
    });
    return reply(200, result);
  } catch (e) {
    console.error('[send-welcome-email] failed:', e.message);
    return reply(500, { error: 'Could not process the welcome email' });
  }
};

exports.__setTestBandIndexReader = (fn) => { bandIndexReader = fn || ((event) => () => loadIndex(openBlobStore(event))); };
