/**
 * outgoingEmail — builds a Resend payload that is allowed to leave, and
 * sends it.
 *
 * Every user-facing email goes through buildEmail(), which is what makes
 * "no email without an unsubscribe" true rather than a convention:
 *   - the footer gets the recipient's own signed unsubscribe link
 *   - the message gets List-Unsubscribe + List-Unsubscribe-Post (RFC 8058),
 *     which is what puts the native "Unsubscribe" button in Gmail/Apple
 *     Mail and what Gmail/Yahoo require of bulk senders.
 *
 * Deliberately NOT used by report-content, notify-block and
 * moderation-sla-reminder: those only ever go to the admin, and an
 * unsubscribe on them would let one stray click switch off the moderation
 * alerts Guideline 1.2 depends on.
 */

const https = require('https');
const { unsubscribeUrl } = require('./unsubscribeToken');
const { injectUnsubscribeFooter } = require('./emailLayout');

const FROM_PHILLIP = 'Phillip <phillip@mysetlists.net>';

/**
 * recipient — { email, uid|null }
 * scope     — 'all' | 'announcements'
 * source    — 'notification:<type>' | 'announcement:<id>'
 */
function buildEmail({ recipient, subject, html, scope = 'all', source, from = FROM_PHILLIP, replyTo, mailingAddress = '' }) {
  const url = recipient.uid
    ? unsubscribeUrl({ kind: 'uid', id: recipient.uid, scope, source })
    : unsubscribeUrl({ kind: 'email', id: recipient.email, scope, source });
  const payload = {
    from,
    to: recipient.email,
    subject,
    html: injectUnsubscribeFooter(html, { url, scope, mailingAddress }),
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
  if (replyTo) payload.reply_to = replyTo;
  return payload;
}

let testTransport = null;

/** POST to Resend. Resolves { status, body, retryAfter } and never throws. */
function resendRequest(path, payload, { idempotencyKey } = {}) {
  if (testTransport) return Promise.resolve(testTransport(path, payload, { idempotencyKey }));
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Promise.resolve({ status: 500, body: 'RESEND_API_KEY not configured' });
  const data = JSON.stringify(payload);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.resend.com', path, method: 'POST', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const ra = Number(res.headers['retry-after']);
        resolve({ status: res.statusCode, body, retryAfter: Number.isFinite(ra) ? ra : null });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.setTimeout(15000, () => { req.destroy(new Error('Resend request timed out')); });
    req.write(data);
    req.end();
  });
}

async function sendOne(payload) {
  const r = await resendRequest('/emails', payload);
  if (r.status >= 200 && r.status < 300) {
    // Resend answers { id }. Kept when it's there (the welcome email
    // records it); a body that isn't JSON is still a successful send.
    let id = null;
    try { id = JSON.parse(r.body || '{}').id || null; } catch { /* not JSON */ }
    return { ok: true, id };
  }
  return { ok: false, status: r.status, error: String(r.body || '').slice(0, 500) };
}

/**
 * The server-side notification path (anniversary, venue bucket list,
 * roadmap shipped): opt-out check, signed footer + headers, send.
 * Resolves 'sent' | 'skipped' (opted out) | 'failed'. Never throws.
 */
async function sendNotificationEmail({ db, uid = null, email, subject, html, type, from = FROM_PHILLIP }) {
  try {
    const { canEmail, findProfileByEmail } = require('./emailPolicy');
    const { normalizeEmail } = require('./unsubscribeToken');
    let to = normalizeEmail(email);
    // Profiles stopped carrying `email` in 5.59.7 (S-01): a caller that
    // only knows the uid gets the account's address from Auth.
    if (!to && uid) {
      const { emailForUid } = require('./accountEmails');
      let auth = null;
      try { auth = require('./firebaseAdmin').getAdminAuth(); } catch { /* no credentials (tests) */ }
      to = (await emailForUid(auth, uid)) || '';
    }
    if (!to) return 'skipped';
    // An account holder gets an account-level link, even when the caller
    // only knew the address.
    if (!uid) uid = (await findProfileByEmail(db, to))?.uid || null;
    if (!(await canEmail({ uid, email: to, category: 'notification' }, { db }))) return 'skipped';
    if (!process.env.UNSUBSCRIBE_SECRET) {
      console.warn('[email] UNSUBSCRIBE_SECRET not set — not sending without an unsubscribe link');
      return 'failed';
    }
    const payload = buildEmail({ recipient: { email: to, uid }, subject, html, scope: 'all', source: `notification:${type}`, from });
    const r = await sendOne(payload);
    if (!r.ok) console.warn(`[email] Resend ${r.status} for notification:${type}: ${r.error}`);
    return r.ok ? 'sent' : 'failed';
  } catch (e) {
    console.warn('[email] notification send failed:', e.message);
    return 'failed';
  }
}

function __setTestTransport(fn) { testTransport = fn; }

module.exports = { buildEmail, resendRequest, sendOne, sendNotificationEmail, FROM_PHILLIP, __setTestTransport };
