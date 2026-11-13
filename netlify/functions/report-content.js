/**
 * report-content — files a user's report against a comment, a meetup
 * message, a photo/video, or a profile.
 *
 * The "mechanism for users to report offensive content, with timely
 * response" half of App Store Guideline 1.2. Three things have to happen
 * somewhere the reporter cannot skip, which is why this is a function and
 * not a client write:
 *
 *   1. COUNTING. Auto-hide triggers on three DISTINCT reporters. A client
 *      that counts its own reports can inflate the number; a client that
 *      doesn't count can't trigger the hide at all.
 *   2. HIDING. Pulling content out of circulation means writing to a
 *      document the reporter has no business writing to — someone else's
 *      comment. Only the Admin SDK can do that.
 *   3. NOTIFYING. Guideline 1.2 expects action within 24 hours. Nobody
 *      acts within 24 hours on a queue they are not told about, so the
 *      admin email is what makes the commitment in the Community
 *      Guidelines achievable rather than aspirational.
 *
 * WHY THE REPORT'S FACTS ARE READ SERVER-SIDE. The body names what is
 * being reported; everything else — who wrote it, what it says — is read
 * from the content document here. A client that supplies `reportedUserId`
 * could otherwise get someone else banned for a comment they never wrote.
 *
 * POST body: { contentType, contentId, reason, details? }
 * Auth header: Authorization: Bearer {idToken}   (any signed-in user)
 *
 * Returns { reportCount, hidden }.
 */

const { withCors } = require('./lib/cors');
const https = require('https');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kept in step with REPORTABLE_TYPES in lib/moderation.js. The server has
// its own copy on purpose: it is what stops a caller naming an arbitrary
// collection and having this function delete documents out of it.
//
//   authorField  — whose content this is, for the ban action
//   textFields   — what goes into contentSnapshot, so an admin can judge
//                  the report without the document still existing
//   hideable     — a profile cannot be quarantined (deleting it would
//                  orphan that user's whole account), so a profile report
//                  goes to the queue for a human and never auto-hides
const REPORTABLE_TYPES = {
  showComment:   { collection: 'showComments',   authorField: 'authorUid',  textFields: ['text'],           hideable: true,  label: 'Comment' },
  meetupComment: { collection: 'meetupComments', authorField: 'authorUid',  textFields: ['text'],           hideable: true,  label: 'Meetup message' },
  showMedia:     { collection: 'showPhotos',     authorField: 'uploadedBy', textFields: ['caption', 'url'], hideable: true,  label: 'Photo or video' },
  profile:       { collection: 'userProfiles',   authorField: null,         textFields: ['displayName', 'handle'], hideable: false, label: 'Profile' },
};

const VALID_REASONS = ['spam', 'harassment', 'sexual', 'violence', 'impersonation', 'other'];

// Distinct open reports that pull an item out of circulation on their
// own. Mirrors AUTO_HIDE_THRESHOLD in lib/moderation.js.
const AUTO_HIDE_THRESHOLD = 3;

const MAX_DETAILS = 1000;
const MAX_SNAPSHOT = 2000;

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Same Resend call send-email.js makes. Deliberately best-effort: a
 * report that reached Firestore is filed whether or not the notification
 * lands, and failing the request would tell the reporter their report
 * didn't work when it did.
 */
function notifyAdmin({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[report-content] RESEND_API_KEY not set — no admin notification sent.');
    return Promise.resolve(false);
  }

  const payload = JSON.stringify({
    from: 'MySetlists Moderation <phillip@mysetlists.net>',
    to: ADMIN_EMAILS,
    subject,
    html,
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on('error', (err) => {
      console.error('[report-content] Admin notification failed:', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

function buildSnapshot(data, textFields) {
  return textFields
    .map((field) => data[field])
    .filter(Boolean)
    .join(' — ')
    .slice(0, MAX_SNAPSHOT);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return json(401, { error: 'You need to be signed in to report something.' });

  let reporterId;
  let db;
  let FieldValue;
  try {
    initFirebase();
    const { getAuth } = require('firebase-admin/auth');
    reporterId = (await getAuth().verifyIdToken(token)).uid;
    const firestore = require('firebase-admin/firestore');
    db = firestore.getFirestore();
    FieldValue = firestore.FieldValue;
  } catch (e) {
    console.error('[report-content] Auth failed:', e.message);
    return json(401, { error: 'Your session has expired. Please sign in again.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }

  const { contentType, contentId, reason } = body;
  const details = String(body.details || '').trim().slice(0, MAX_DETAILS);

  const spec = REPORTABLE_TYPES[contentType];
  if (!spec) return json(400, { error: `Unknown content type: ${contentType}` });
  if (!contentId) return json(400, { error: 'contentId is required' });
  if (!VALID_REASONS.includes(reason)) return json(400, { error: 'Pick a reason for the report.' });
  if (reason === 'other' && !details) {
    return json(400, { error: 'Tell us briefly what’s wrong — a report with no reason can’t be actioned.' });
  }

  try {
    // ── Read the facts rather than trusting them ─────────────────────
    const contentRef = db.collection(spec.collection).doc(String(contentId));
    const contentSnap = await contentRef.get();

    if (!contentSnap.exists) {
      // Already deleted, or already auto-hidden by someone else's
      // reports. Either way there is nothing to report and nothing to
      // hide — and telling the reporter it worked is the honest answer,
      // because the outcome they wanted has happened.
      return json(200, { reportCount: 0, hidden: true, alreadyGone: true });
    }

    const contentData = contentSnap.data();
    const reportedUserId = spec.authorField ? contentData[spec.authorField] : String(contentId);
    if (reportedUserId === reporterId) {
      return json(400, { error: 'You can’t report your own content.' });
    }

    const reportId = `${contentId}_${reporterId}`;
    const reportRef = db.collection('reports').doc(reportId);
    const counterRef = db.collection('moderationCounters').doc(String(contentId));

    // One transaction so two people reporting the same comment at the
    // same moment cannot both read a count of 2 and both write 3.
    const { reportCount, isNew } = await db.runTransaction(async (tx) => {
      const [existingReport, counterSnap] = await Promise.all([
        tx.get(reportRef),
        tx.get(counterRef),
      ]);

      // A second report from the same person replaces their first rather
      // than counting twice — the deterministic id is what enforces "one
      // report per user per item", and the count must agree with it.
      const alreadyOpen = existingReport.exists && existingReport.data().status === 'open';
      const current = counterSnap.exists ? (counterSnap.data().openReports || 0) : 0;
      const next = alreadyOpen ? current : current + 1;

      tx.set(reportRef, {
        contentType,
        contentId: String(contentId),
        contentPath: `${spec.collection}/${contentId}`,
        contentSnapshot: buildSnapshot(contentData, spec.textFields),
        reportedUserId: reportedUserId || null,
        reporterId,
        reason,
        details,
        status: 'open',
        createdAt: existingReport.exists ? existingReport.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        resolvedBy: null,
      });

      tx.set(counterRef, {
        contentId: String(contentId),
        contentType,
        openReports: next,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return { reportCount: next, isNew: !alreadyOpen };
    });

    // ── Auto-hide ────────────────────────────────────────────────────
    // Copied into moderationHidden (admin-read-only) and removed from its
    // own collection, rather than flagged in place. See the long note in
    // lib/moderation.js: a `hidden: true` flag breaks the very queries it
    // is meant to filter, because a Firestore query fails outright if any
    // document it returns fails the read rule, and every document already
    // in production predates the field.
    let hidden = false;
    if (spec.hideable && reportCount >= AUTO_HIDE_THRESHOLD) {
      const hiddenRef = db.collection('moderationHidden').doc(`${spec.collection}_${contentId}`);
      const batch = db.batch();
      batch.set(hiddenRef, {
        collectionName: spec.collection,
        docId: String(contentId),
        contentType,
        data: contentData,
        hidden: true,
        hiddenAt: FieldValue.serverTimestamp(),
        hiddenReason: `${reportCount} reports`,
        reportCount,
        authorUid: reportedUserId || null,
      });
      batch.delete(contentRef);
      await batch.commit();
      hidden = true;
    }

    // ── Notify ───────────────────────────────────────────────────────
    if (isNew) {
      const snapshot = buildSnapshot(contentData, spec.textFields);
      await notifyAdmin({
        subject: `[MySetlists] ${spec.label} reported (${reason})${hidden ? ' — auto-hidden' : ''}`,
        html: `
          <p><strong>${escapeHtml(spec.label)}</strong> reported for <strong>${escapeHtml(reason)}</strong>.</p>
          ${details ? `<p><em>${escapeHtml(details)}</em></p>` : ''}
          <p><strong>Content:</strong></p>
          <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444">${escapeHtml(snapshot) || '<em>(no text)</em>'}</blockquote>
          <p><strong>Path:</strong> ${escapeHtml(spec.collection)}/${escapeHtml(contentId)}<br>
             <strong>Author:</strong> ${escapeHtml(reportedUserId || 'unknown')}<br>
             <strong>Open reports:</strong> ${reportCount}${hidden ? ' — <strong>auto-hidden pending review</strong>' : ''}</p>
          <p>Review it in the Moderation tab: <a href="https://mysetlists.net/admin">mysetlists.net/admin</a></p>
          <p style="color:#888;font-size:12px">Guideline 1.2 commits to reviewing this within 24 hours.</p>
        `,
      });
    }

    return json(200, { reportCount, hidden });
  } catch (e) {
    console.error('[report-content] Failed:', e.message, e);
    return json(500, { error: "Couldn't send that report. Please try again." });
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
