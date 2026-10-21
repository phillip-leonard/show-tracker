/**
 * unfollowToken — signed, non-expiring "unfollow this band" tokens for the
 * link in every followed-band email. Server only.
 *
 * Same construction as lib/unsubscribeToken.js (base64url JSON payload +
 * HMAC-SHA256 with UNSUBSCRIBE_SECRET), with two differences:
 *   - the payload names a uid and a band (artist key), nothing else
 *   - the HMAC input is prefixed "unfollow.", so an unfollow token can
 *     never verify as an unsubscribe token or the other way round
 *
 * No expiry, for the same reason an unsubscribe link has none: last
 * month's email still has to work.
 */

const crypto = require('crypto');
const { SITE_URL } = require('./unsubscribeToken');

const DOMAIN = 'unfollow.';

function getSecret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error('UNSUBSCRIBE_SECRET is not configured');
  return s;
}

function hmac(body, secret) {
  return crypto.createHmac('sha256', secret).update(DOMAIN + body).digest('base64url');
}

/** uid + artistKey (lib/followedBandAlerts.js's artistKey) → token. */
function signUnfollow({ uid, artistKey }) {
  if (!uid || !artistKey) throw new Error('uid and artistKey are required');
  const body = Buffer.from(JSON.stringify({ v: 1, u: String(uid), a: String(artistKey) })).toString('base64url');
  return `${body}.${hmac(body, getSecret())}`;
}

/** Returns { uid, artistKey } for a genuine token, otherwise null. */
function verifyUnfollow(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  let secret;
  try { secret = getSecret(); } catch { return null; }
  const expected = Buffer.from(hmac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.v !== 1 || !p.u || !p.a) return null;
    return { uid: p.u, artistKey: p.a };
  } catch {
    return null;
  }
}

function unfollowUrl(fields) {
  return `${SITE_URL}/api/unfollow?token=${encodeURIComponent(signUnfollow(fields))}`;
}

module.exports = { signUnfollow, verifyUnfollow, unfollowUrl };
