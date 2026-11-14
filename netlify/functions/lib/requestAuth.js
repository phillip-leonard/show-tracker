/**
 * requestAuth — who is calling, for functions that need to know.
 *
 *   const auth = await requireUser(event, headers);
 *   if (auth.response) return auth.response;   // 401, ready to send
 *   const { uid, email, isAdmin } = auth;
 *
 * Reads `Authorization: Bearer <Firebase ID token>` and verifies it with
 * the Admin SDK (lib/firebaseAdmin.js, so the same credentials and the
 * same test doubles as every other function). Admin is isAdmin() in
 * lib/firebaseAdmin.js: the `admin` custom claim, or the allowlisted
 * address with a verified email; firestore.rules' isAdmin() is the same
 * rule (5.59.12).
 */

const { verifyUser, isAdmin, bearerToken } = require('./firebaseAdmin');

function identity(decoded) {
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    emailVerified: decoded.email_verified === true,
    name: decoded.name || null,
    isAdmin: isAdmin(decoded),
  };
}

/** { uid, email, isAdmin, … } or null — never a response. */
async function optionalUser(event) {
  const decoded = await verifyUser(event);
  return decoded ? identity(decoded) : null;
}

/**
 * The caller, or { response } holding a 401. `message` is what an old
 * client will show verbatim (they render `data.error`), so keep it human.
 */
async function requireUser(event, headers = {}, { message = 'Please sign in to continue.' } = {}) {
  const user = await optionalUser(event);
  if (user) return user;
  return {
    response: {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: message, code: 'auth_required' }),
    },
  };
}

/** Like requireUser, plus 403 for a signed-in non-admin. */
async function requireAdmin(event, headers = {}) {
  const user = await requireUser(event, headers);
  if (user.response) return user;
  if (!user.isAdmin) {
    return { response: { statusCode: 403, headers, body: JSON.stringify({ error: 'Not allowed.', code: 'forbidden' }) } };
  }
  return user;
}

/** Whether the request carries any bearer token at all (valid or not). */
function hasBearer(event) {
  return !!bearerToken(event);
}

module.exports = { requireUser, requireAdmin, optionalUser, hasBearer };
