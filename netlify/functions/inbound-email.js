/**
 * inbound-email — Resend's webhook for mail received at the presale inbox.
 *
 * Resend's email.received event carries metadata only, so the body and the
 * SPF/DKIM/DMARC results are fetched from its Receiving API. What happens next
 * is lib/inboundEmail.js. Parsing runs in parse-presale-email-background.js, so
 * this can answer quickly.
 *
 * Setup: a webhook for email.received pointing here, with its signing secret in
 * RESEND_WEBHOOK_SECRET. Without the secret every request is refused.
 */

const { getDb } = require('./lib/firebaseAdmin');
const { verifyWebhookSignature, ingestEmail } = require('./lib/inboundEmail');
const { startBackgroundJob } = require('./lib/jobTrigger');

async function fetchReceivedEmail(id) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend ${res.status} reading ${id}`);
  return res.json();
}

/** The one link this app ever follows. See singleConfirmLink. */
async function clickConfirmLink(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
  return res.status;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  if (!verifyWebhookSignature({ rawBody, headers: event.headers, secret: process.env.RESEND_WEBHOOK_SECRET })) {
    console.warn('[inbound-email] refused: bad signature');
    return { statusCode: 401, body: '' };
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { statusCode: 400, body: '' }; }
  if (payload.type !== 'email.received') return { statusCode: 200, body: '' };
  const emailId = String(payload.data?.email_id || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(emailId)) return { statusCode: 400, body: '' };

  const db = getDb();
  try {
    const email = await fetchReceivedEmail(emailId);
    const status = await ingestEmail({
      db,
      emailId,
      email,
      startParse: (id) => startBackgroundJob(db, 'parse-presale-email', 'parse-presale-email-background', { emailId: id }),
      clickLink: clickConfirmLink,
    });
    console.log('[inbound-email]', emailId, status);
    return { statusCode: 200, body: '' };
  } catch (err) {
    // A 5xx has Resend retry the delivery.
    console.error('[inbound-email] failed', emailId, err.message);
    return { statusCode: 500, body: '' };
  }
};
