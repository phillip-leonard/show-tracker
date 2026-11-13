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
const { getDb, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
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

    // Collect emails to notify: submitter + all voters
    const emailsToNotify = new Set();

    // Add submitter email
    if (itemData.submitterEmail) {
      emailsToNotify.add(itemData.submitterEmail);
    }

    // Add contributor emails from the contributors array
    if (Array.isArray(itemData.contributors)) {
      for (const c of itemData.contributors) {
        if (c.email && !c.notified) {
          emailsToNotify.add(c.email);
        }
      }
    }

    // Query the voters sub-collection for additional emails
    const votersSnap = await itemRef.collection('voters').get();
    const voterUids = [];
    for (const voterDoc of votersSnap.docs) {
      voterUids.push(voterDoc.id);
    }

    // Resolve voter UIDs to emails via userProfiles
    if (voterUids.length > 0) {
      // Firestore 'in' queries limited to 30 items; batch if needed
      for (let i = 0; i < voterUids.length; i += 30) {
        const batch = voterUids.slice(i, i + 30);
        const profilesSnap = await db.collection('userProfiles')
          .where('__name__', 'in', batch)
          .get();
        for (const profileDoc of profilesSnap.docs) {
          const email = profileDoc.data().email;
          if (email) emailsToNotify.add(email);
        }
      }
    }

    // Check previously notified emails to avoid duplicates
    const alreadyNotified = new Set();
    if (Array.isArray(itemData.contributors)) {
      for (const c of itemData.contributors) {
        if (c.notified) alreadyNotified.add(c.email);
      }
    }
    if (itemData.notifiedEmails && Array.isArray(itemData.notifiedEmails)) {
      for (const e of itemData.notifiedEmails) alreadyNotified.add(e);
    }

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

    // Update the roadmap item with notification tracking
    const allNotified = [...alreadyNotified, ...toSend.filter(e => !failures.includes(e) && !skippedEmails.includes(e))];
    await itemRef.update({
      notificationsSent: true,
      notificationsSentAt: FieldValue.serverTimestamp(),
      notifiedEmails: allNotified,
    });

    // Mark contributors as notified
    if (Array.isArray(itemData.contributors)) {
      const updatedContributors = itemData.contributors.map(c => ({
        ...c,
        notified: allNotified.includes(c.email) ? true : c.notified,
      }));
      await itemRef.update({ contributors: updatedContributors });
    }

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
