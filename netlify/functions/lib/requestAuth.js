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

const { verifyUser, isAdmin, isAnonymous, bearerToken } = require('./firebaseAdmin');

function identity(decoded) {
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    emailVerified: decoded.email_verified === true,
    name: decoded.name || null,
    isAdmin: isAdmin(decoded),
    // A guest (anonymous auth, nothing linked yet): firebaseAdmin.isAnonymous.
    isAnonymous: isAnonymous(decoded),
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

/**
 * The 403 a guest gets from anything that needs a real account (5.60.13).
 * `code: 'account_required'` is what the native app turns into "create an
 * account to use this"; `message` is what any client shows verbatim.
 */
const ACCOUNT_REQUIRED_MESSAGE = 'Create an account to use this.';
function accountRequired(headers = {}, message = ACCOUNT_REQUIRED_MESSAGE) {
  return {
    statusCode: 403,
    headers,
    body: JSON.stringify({ error: message, code: 'account_required' }),
  };
}

/**
 * Like requireUser, plus 403 `account_required` for a guest (anonymous
 * auth, nothing linked). For every feature the native app keeps from
 * guests: friends, email, UGC, reports, festivals, public pages, AI scans.
 */
async function requireAccount(event, headers = {}, options = {}) {
  const user = await requireUser(event, headers, options);
  if (user.response) return user;
  if (user.isAnonymous) return { response: accountRequired(headers) };
  return user;
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

module.exports = { requireUser, requireAccount, requireAdmin, optionalUser, hasBearer, accountRequired, ACCOUNT_REQUIRED_MESSAGE };
