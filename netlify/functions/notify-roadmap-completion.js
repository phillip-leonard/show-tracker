/**
 * notify-roadmap-completion — Sends email notifications to all voters/contributors
 * when a roadmap item is marked as completed (shipped).
 *
 * POST body: { roadmapItemId, featureTitle, featureDescription }
 *
 * Queries the roadmapItems document + voters sub-collection to gather all
 * contributor emails, then sends each a notification via Resend.
 * Marks each contributor as notified to prevent duplicates.
 *
 * Auth header: Authorization: Bearer {idToken}   (admin only, since 5.38 —
 * it used to answer anyone). Opt-out, the signed unsubscribe footer and
 * List-Unsubscribe headers come from lib/outgoingEmail.js.
 */

const { withCors } = require('./lib/cors');
const { getDb, getAdminAuth, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
const { emailsForUids } = require('./lib/accountEmails');
const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { FOOTER_MARKER } = require('./lib/emailLayout');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function buildEmailHtml(featureTitle, featureDescription) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="background:linear-gradient(135deg,#064e3b,#134e4a);border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:40px;margin-bottom:12px;">🎉</div>
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">A feature you requested is now live!</h1>
      <p style="color:#6ee7b7;font-size:14px;margin:0;">MySetlists just got better, thanks to you.</p>
    </div>
    <div style="background:#1e293b;border-radius:16px;padding:24px;margin-top:16px;">
      <h2 style="color:#ffffff;font-size:18px;margin:0 0 8px;">${featureTitle}</h2>
      ${featureDescription ? `<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px;">${featureDescription}</p>` : ''}
      <a href="https://mysetlists.net" style="display:inline-block;background:linear-gradient(135deg,#10b981,#14b8a6);color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;">
        Check it out →
      </a>
    </div>
    <p style="color:#475569;font-size:12px;text-align:center;margin-top:24px;">
      You're receiving this because you voted for or submitted this feature on
      <a href="https://mysetlists.net/roadmap" style="color:#6ee7b7;text-decoration:none;">MySetlists Roadmap</a>.
    </p>
    <div style="text-align:center">${FOOTER_MARKER}</div>
  </div>
</body>
</html>`;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const decoded = await verifyUser(event);
  if (!decoded) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!isAdminClaims(decoded)) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { roadmapItemId, featureTitle, featureDescription } = body;
  if (!roadmapItemId || !featureTitle) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required fields: roadmapItemId, featureTitle' }) };
  }

  try {
    const { FieldValue } = require('firebase-admin/firestore');
    const db = getDb();

    // Get the roadmap item
    const itemRef = db.collection('roadmapItems').doc(roadmapItemId);
    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Roadmap item not found' }) };
    }

    const itemData = itemDoc.data();

    // Who to tell: the submitter and every voter, by uid, with addresses
    // from Firebase Auth. Since 5.59.7 nothing about who asked or who was
    // emailed is kept on the item itself: roadmapItems are publicly
    // readable, and until then they carried submitterEmail, contributor
    // emails and notifiedEmails in plain text. That tracking lives in
    // roadmapItems/{id}/private/notifications, which no client can read.
    // scripts/strip-profile-emails.js moved the old fields there.
    const privateRef = itemRef.collection('private').doc('notifications');
    const privateSnap = await privateRef.get();
    const priv = privateSnap.exists ? privateSnap.data() : {};

    const votersSnap = await itemRef.collection('voters').get();
    const uids = [...new Set([itemData.submitterUid, ...votersSnap.docs.map((d) => d.id)].filter(Boolean))];
    const byUid = await emailsForUids(getAdminAuth(), uids);

    const emailsToNotify = new Set([...byUid.values()]);
    // Items from before 5.59.7 that the strip script hasn't reached yet,
    // and addresses it moved into the private doc.
    for (const e of [itemData.submitterEmail, ...(itemData.contributors || []).filter((c) => !c.notified).map((c) => c.email), ...(priv.legacyEmails || [])]) {
      if (e) emailsToNotify.add(String(e).trim().toLowerCase());
    }

    const alreadyNotified = new Set([
      ...(priv.notifiedEmails || []),
      ...(itemData.notifiedEmails || []),
      ...(itemData.contributors || []).filter((c) => c.notified && c.email).map((c) => c.email),
    ].map((e) => String(e).trim().toLowerCase()));

    // Filter out already-notified
    let toSend = [...emailsToNotify].filter(e => e && !alreadyNotified.has(e));

    if (toSend.length === 0) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, emailsSent: 0, message: 'No new emails to send' }),
      };
    }

    // Send emails
    const subject = "A feature you requested is now live! 🎉";
    const html = buildEmailHtml(featureTitle, featureDescription || '');
    let sent = 0;
    const failures = [];

    let skipped = 0;
    const skippedEmails = [];
    for (const email of toSend) {
      const status = await sendNotificationEmail({
        db, email, subject, html, type: 'roadmap_shipped', from: 'MySetlists <noreply@mysetlists.net>',
      });
      if (status === 'sent') sent++;
      else if (status === 'skipped') { skipped++; skippedEmails.push(email); }
      else failures.push(email);
    }

    const allNotified = [...alreadyNotified, ...toSend.filter(e => !failures.includes(e) && !skippedEmails.includes(e))];
    await privateRef.set({ notifiedEmails: allNotified, updatedAt: new Date() }, { merge: true });
    await itemRef.update({
      notificationsSent: true,
      notificationsSentAt: FieldValue.serverTimestamp(),
      // Pre-5.59.7 fields: the addresses now live only in the private doc.
      notifiedEmails: FieldValue.delete(),
      submitterEmail: FieldValue.delete(),
      contributors: FieldValue.delete(),
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        emailsSent: sent,
        failures: failures.length,
        skipped,
        totalRecipients: toSend.length,
      }),
    };
  } catch (err) {
    console.error('notify-roadmap-completion error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
