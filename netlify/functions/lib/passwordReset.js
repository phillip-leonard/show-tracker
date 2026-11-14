/**
 * passwordReset — our own password reset (5.60.0), replacing Firebase's
 * sendPasswordResetEmail and its firebaseapp.com sender and long
 * __/auth/action?oobCode=… link.
 *
 *   send-password-reset.js      POST { email }               → mails a link
 *   complete-password-reset.js  POST { token, newPassword }  → sets it
 *
 * THE TOKEN. 16 base62 characters from crypto.randomBytes (~95 bits), in
 * the link as https://mysetlists.net/reset/<token>. Only its SHA-256 is
 * stored, as the id of passwordResetTokens/{hash}, so a read of the
 * collection (a leaked backup, an admin export) yields nothing that can
 * reset a password. firestore.rules denies the collection to every client;
 * only the Admin SDK reads or writes it.
 *
 *   passwordResetTokens/{sha256(token)}
 *     uid, email, createdAt, expiresAt (createdAt + 60 min), used
 *
 * expiresAt carries a Firestore TTL policy (firestore.indexes.json), which
 * deletes a doc some time after it expires. The functions never rely on
 * it: an expired token is refused whether or not it has been deleted yet.
 *
 * Templates follow notificationTemplates.js: wrapEmail(), the same green
 * button, every value escaped. They go out through buildTransactionalEmail
 * (lib/outgoingEmail.js): no unsubscribe footer, no opt-out check.
 */

const crypto = require('crypto');
const { wrapEmail, escapeHtml } = require('./emailLayout');

const APP_URL = 'https://mysetlists.net';
const COLLECTION = 'passwordResetTokens';
const TOKEN_LENGTH = 16;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const INVALID_LINK = 'This reset link is invalid or has expired.';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TOKEN_PATTERN = /^[0-9A-Za-z]{16}$/;

/**
 * A fresh token. Bytes of 248 or more are thrown away so every character
 * is equally likely (248 = 4 × 62); a plain `% 62` would favour the first
 * eight.
 */
function generateToken(randomBytes = crypto.randomBytes) {
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b >= 248) continue;
      out += BASE62[b % 62];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function resetUrl(token) {
  return `${APP_URL}/reset/${token}`;
}

/** A plausible email address, normalized; '' when it isn't one. */
function normalizeResetEmail(raw) {
  if (typeof raw !== 'string') return '';
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

// ── Providers ────────────────────────────────────────────────────────

const PROVIDER_NAMES = { 'google.com': 'Google', 'apple.com': 'Apple' };

function providerIds(user) {
  return (user && Array.isArray(user.providerData) ? user.providerData : [])
    .map((p) => p && p.providerId)
    .filter(Boolean);
}

function hasPasswordProvider(user) {
  return providerIds(user).includes('password');
}

/** ['Google', 'Apple'], in that order, for the providers the user has. */
function signInProviderNames(user) {
  const ids = providerIds(user);
  return Object.keys(PROVIDER_NAMES).filter((id) => ids.includes(id)).map((id) => PROVIDER_NAMES[id]);
}

// ── Emails ───────────────────────────────────────────────────────────

const GREEN = '#34D399';
const e = escapeHtml;

function button(text, url) {
  return `
  <p style="margin:24px 0;text-align:center">
    <a href="${e(url)}" style="background:${GREEN};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">
      ${text}
    </a>
  </p>`;
}

const muted = (html) => `<p class="ms-muted" style="margin:0 0 10px;color:#6b7280;font-size:13px">${html}</p>`;

function passwordResetEmail({ token }) {
  const url = resetUrl(token);
  return {
    subject: 'Reset your MySetlists password',
    html: wrapEmail(`
    <h2 style="color:#111827;margin:0 0 16px;font-size:22px">Reset your password</h2>
    <p style="margin:0 0 12px">We got a request to reset the password for your MySetlists account. Choose a new one with the button below.</p>
    ${button('Reset password', url)}
    ${muted('This link expires in 1 hour and works once.')}
    ${muted('If you didn’t request this, ignore this email. Your password won’t change.')}
    ${muted(`If the button doesn’t work, paste this link into your browser:<br><a href="${e(url)}" class="ms-link" style="color:#059669;word-break:break-all">${e(url)}</a>`)}
    `, { darkMode: true, preheader: 'This link expires in 1 hour.' }),
  };
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * For an account with no password: say how they do sign in. Apple sign-in
 * exists only in the iOS app (components/auth/OAuthButtons.js), so an
 * Apple-only account is pointed there.
 */
function noPasswordEmail({ providers }) {
  const names = providers.length ? providers : [];
  const how = names.length ? `with ${joinNames(names)}` : 'without a password';
  const only = names.length === 1 ? names[0] : null;
  const steps = [];
  if (names.includes('Google')) steps.push('On the website or in the app, choose <strong style="color:#111827">Continue with Google</strong>.');
  if (names.includes('Apple')) steps.push('In the MySetlists iPhone app, choose <strong style="color:#111827">Sign in with Apple</strong>.');
  return {
    subject: only ? `You sign in to MySetlists with ${only}` : 'How you sign in to MySetlists',
    html: wrapEmail(`
    <h2 style="color:#111827;margin:0 0 16px;font-size:22px">No password to reset</h2>
    <p style="margin:0 0 12px">Someone asked to reset the password for this address. You sign in to MySetlists ${e(how)}, so there’s no password to reset.</p>
    ${steps.map((s) => `<p style="margin:0 0 8px">${s}</p>`).join('')}
    ${button('Sign in', `${APP_URL}/?login=1`)}
    ${muted('If you didn’t request this, ignore this email. Nothing about your account has changed.')}
    `, { darkMode: true, preheader: `You sign in ${how}.` }),
  };
}

module.exports = {
  COLLECTION, TOKEN_LENGTH, TOKEN_TTL_MS, INVALID_LINK,
  generateToken, isWellFormedToken, hashToken, resetUrl, normalizeResetEmail,
  hasPasswordProvider, signInProviderNames,
  passwordResetEmail, noPasswordEmail,
};
