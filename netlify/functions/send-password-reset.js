/**
 * send-password-reset — "Forgot password" (5.60.0).
 *
 * POST { email }  →  200 { ok: true }
 *
 * No sign-in (the caller has forgotten their password). What happens next
 * depends on the account, and none of it shows in the response:
 *   - no account (or a disabled one): nothing is sent
 *   - an account without a password (Google / Apple only): an email saying
 *     how they sign in instead
 *   - a password account: a one-hour, one-use link,
 *     https://mysetlists.net/reset/<token>; see lib/passwordReset.js
 *
 * Same 200 { ok: true } for all three, and for a send that failed, so the
 * endpoint can't be used to learn which addresses have accounts. Every
 * answer also takes at least MIN_RESPONSE_MS, so the time a send takes
 * doesn't give it away either. The send has to finish before the function
 * returns (Netlify can freeze a Lambda-style function once it has
 * answered), so the floor sits well above a normal lookup + Firestore
 * write + Resend call (well under a second). A request that runs past it
 * is logged as "slow", which is the signal to raise it.
 *
 * Limits (lib/rateLimit.js, hourly, both checked BEFORE the account
 * lookup so a 429 says nothing about the address): PER_IP_PER_HOUR from
 * one network, PER_EMAIL_PER_HOUR to one address. The address is kept
 * only as a keyed hash in the counter.
 *
 * Sent from noreply@mysetlists.net with no unsubscribe link and no opt-out
 * check: the user asked for it just now (lib/outgoingEmail.js
 * buildTransactionalEmail).
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { corsHeaders } = require('./lib/cors');
const { takeHourlyQuota, clientIp, ipHash } = require('./lib/rateLimit');
const { buildTransactionalEmail, sendOne } = require('./lib/outgoingEmail');
const {
  TOKEN_TTL_MS,
  generateToken, hashToken, normalizeResetEmail,
  hasPasswordProvider, signInProviderNames,
  passwordResetEmail, noPasswordEmail,
} = require('./lib/passwordReset');

const PER_IP_PER_HOUR = 10;
const PER_EMAIL_PER_HOUR = 3;
const MIN_RESPONSE_MS = 3000;

let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What to send to this address: { kind, uid?, user? } — never thrown. */
async function lookUp(auth, email) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    if (e && (e.code === 'auth/user-not-found' || e.errorInfo?.code === 'auth/user-not-found')) return { kind: 'none' };
    throw e;
  }
  if (!user || user.disabled) return { kind: 'none' };
  if (hasPasswordProvider(user)) return { kind: 'password', uid: user.uid };
  return { kind: 'provider', providers: signInProviderNames(user) };
}

/** Store a token's hash and mail the link. Resolves the outcome for the log. */
async function sendResetLink(db, { uid, email, now }) {
  const token = generateToken();
  await db.doc(`passwordResetTokens/${hashToken(token)}`).set({
    uid,
    email,
    createdAt: new Date(now),
    expiresAt: new Date(now + TOKEN_TTL_MS),
    used: false,
  });
  const { subject, html } = passwordResetEmail({ token });
  const r = await sendOne(buildTransactionalEmail({ to: email, subject, html }));
  if (!r.ok) console.error(`[send-password-reset] Resend ${r.status} for a reset link`);
  return r.ok ? 'link sent' : 'send failed';
}

async function sendProviderNote(email, providers) {
  const { subject, html } = noPasswordEmail({ providers });
  const r = await sendOne(buildTransactionalEmail({ to: email, subject, html }));
  if (!r.ok) console.error(`[send-password-reset] Resend ${r.status} for a no-password note`);
  return r.ok ? 'provider note sent' : 'send failed';
}

exports.handler = async function (event) {
  const started = Date.now();
  const headers = { ...corsHeaders(event, { methods: 'POST, OPTIONS' }), 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  // The answer for everything that gets past validation and the limits.
  const done = async () => {
    const elapsed = Date.now() - started;
    if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
    else console.warn(`[send-password-reset] slow: ${elapsed} ms, over the ${MIN_RESPONSE_MS} ms floor`);
    return reply(200, { ok: true });
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request' }); }
  const email = normalizeResetEmail(body && typeof body === 'object' ? body.email : '');
  if (!email) return reply(400, { error: 'Enter a valid email address.' });

  if (!process.env.RESEND_API_KEY) {
    console.error('[send-password-reset] RESEND_API_KEY is not set');
    return reply(503, { error: 'Password reset is unavailable right now. Try again later.' });
  }

  const now = Date.now();
  let db;
  try {
    db = getDb();
    const ip = await takeHourlyQuota(db, `pwreset_ip_${ipHash(clientIp(event))}`, PER_IP_PER_HOUR, { now });
    if (!ip.allowed) return reply(429, { error: 'Too many reset requests. Try again in an hour.' });
    // Keyed with the same secret as the IP hash, so the counter's id can't
    // be matched against a list of addresses.
    const addr = await takeHourlyQuota(db, `pwreset_email_${ipHash(`email:${email}`)}`, PER_EMAIL_PER_HOUR, { now });
    if (!addr.allowed) return reply(429, { error: 'Too many reset requests for this address. Try again in an hour.' });
  } catch (e) {
    console.error('[send-password-reset] rate limit check failed:', e.message);
    return reply(500, { error: 'Couldn’t send a reset link right now. Try again later.' });
  }

  try {
    const target = await lookUp(getAdminAuth(), email);
    let outcome = 'no account';
    if (target.kind === 'password') outcome = await sendResetLink(db, { uid: target.uid, email, now });
    else if (target.kind === 'provider') outcome = await sendProviderNote(email, target.providers);
    // The outcome only, never the address.
    console.log(`[send-password-reset] ${outcome}`);
  } catch (e) {
    console.error('[send-password-reset] failed:', e.message);
  }
  return done();
};

exports.PER_IP_PER_HOUR = PER_IP_PER_HOUR;
exports.PER_EMAIL_PER_HOUR = PER_EMAIL_PER_HOUR;
exports.MIN_RESPONSE_MS = MIN_RESPONSE_MS;
exports.__setSleep = (fn) => { sleep = fn; };
