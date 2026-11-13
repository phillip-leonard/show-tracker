/**
 * referralToken — the signed `ref` in a referral link
 * (https://mysetlists.net?ref=<token>). Server only.
 *
 * Format: "<uid>.<sig>", sig = base64url(HMAC-SHA256("referral:" + uid)),
 * first 22 characters (132 bits), keyed with UNSUBSCRIBE_SECRET. The
 * "referral:" prefix keeps these from ever matching an unsubscribe
 * token's signature under the same key.
 *
 * WHY SIGNED. A referral link makes whoever signs up from it a friend of
 * the referrer, and a friend can read the referrer's shows. Until 5.59.7
 * the link was ?ref=<uid>, and uids appear all over the app, so anyone
 * could make themselves anyone's friend (S-04). Only the referrer can get
 * their own signed token (friends.js 'referralLink', and the invite emails
 * send-email builds), so only links they handed out auto-friend.
 *
 * A bare uid (every link shared before 5.59.7) is still accepted by
 * friends.js, but becomes a friend request the referrer has to accept.
 */

const crypto = require('crypto');

const SIG_LENGTH = 22;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function getSecret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error('UNSUBSCRIBE_SECRET is not configured');
  return s;
}

function sigFor(uid) {
  return crypto.createHmac('sha256', getSecret()).update(`referral:${uid}`).digest('base64url').slice(0, SIG_LENGTH);
}

/** The signed ref for a uid. */
function signReferral(uid) {
  if (!UID_RE.test(String(uid || ''))) throw new Error('Invalid uid');
  return `${uid}.${sigFor(uid)}`;
}

/**
 * Reads a `ref` value. Returns
 *   { uid, signed: true }   for a genuine signed token,
 *   { uid, signed: false }  for a bare uid (a pre-5.59.7 link),
 *   null                    for anything else, including a bad signature.
 */
function readReferral(ref) {
  const s = String(ref || '').trim();
  if (!s || s.length > 200) return null;
  const dot = s.indexOf('.');
  if (dot === -1) return UID_RE.test(s) ? { uid: s, signed: false } : null;
  const uid = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  if (!UID_RE.test(uid) || sig.length !== SIG_LENGTH) return null;
  const want = Buffer.from(sigFor(uid));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { uid, signed: true };
}

module.exports = { signReferral, readReferral };
