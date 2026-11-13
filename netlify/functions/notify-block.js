/**
 * notify-block — tells the developer that one user blocked another.
 *
 * App Store Guideline 1.2 asks that blocking "notify the developer", not
 * only that it hide content. Blocking was silent: it wrote the blocker's
 * own `userBlocks` document and nothing else, so nobody at MySetlists
 * ever learned that someone had found another user bad enough to shut
 * out. A block is the strongest signal a user can send without filing a
 * report, and several blocks against one account is a pattern no single
 * report shows.
 *
 * WHAT IT WRITES. A `reports` document with `reason: 'blocked'`, so it
 * lands in the same admin queue, on the same 24-hour clock, as every
 * other thing needing a human. A separate `blocks` collection would have
 * needed its own query, its own sort, its own SLA badge and its own
 * corner of the admin screen to be looked at — and a moderation signal
 * nobody looks at is not a signal.
 *
 * WHAT MAKES IT DIFFERENT FROM A REPORT. It has no `contentPath`: a block
 * is about a person, not a document. The queue and moderate-report.js
 * both branch on that, and neither offers "delete content" for one.
 * Instead it carries a snapshot of that account's recent posts, gathered
 * here, so an admin can judge the account without hunting for it.
 *
 * WHAT IT NEVER DOES. It never tells the blocked user. It never fails the
 * block: the user's own `userBlocks` write has already happened on the
 * client by the time this is called, and an account that could not be
 * blocked because an email bounced would be a far worse outcome than a
 * notification nobody received.
 *
 * POST body: { blockedUserId }
 * Auth header: Authorization: Bearer {idToken}   (any signed-in user)
 */

const { withCors } = require('./lib/cors');
const https = require('https');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// How much of the blocked account's recent output to put in front of the
// admin. Enough to see a pattern, few enough to read in the email.
const SNAPSHOT_LIMIT = 5;
const MAX_SNAPSHOT_CHARS = 2000;

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

/** Same Resend call report-content.js makes, and best-effort for the same reason. */
function notifyAdmin({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify-block] RESEND_API_KEY not set — no admin notification sent.');
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
      console.error('[notify-block] Admin notification failed:', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * The blocked account's most recent public text, newest first.
 *
 * Read here rather than sent by the client for the same reason
 * report-content.js reads its content document: a caller that supplies
 * the evidence supplies whatever gets someone banned.
 *
 * Each query is independently best-effort — a missing composite index on
 * one collection must not cost the admin the other two.
 */
async function recentContentFor(db, uid) {
  const sources = [
    { collection: 'showComments', field: 'authorUid', text: 'text', label: 'Comment' },
    { collection: 'meetupComments', field: 'authorUid', text: 'text', label: 'Meetup message' },
    { collection: 'showPhotos', field: 'uploadedBy', text: 'caption', label: 'Photo' },
  ];

  const results = await Promise.all(sources.map(async (source) => {
    try {
      const snap = await db.collection(source.collection)
        .where(source.field, '==', uid)
        .limit(SNAPSHOT_LIMIT)
        .get();
      return snap.docs.map((d) => ({
        label: source.label,
        path: `${source.collection}/${d.id}`,
        text: String(d.data()[source.text] || '').slice(0, 300),
      }));
    } catch (e) {
      console.warn(`[notify-block] Could not read ${source.collection}:`, e.message);
      return [];
    }
  }));

  return results.flat().slice(0, SNAPSHOT_LIMIT * 2);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  let blockerUid;
  let db;
  try {
    initFirebase();
    const { getAuth } = require('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    blockerUid = decoded.uid;
    const { getFirestore } = require('firebase-admin/firestore');
    db = getFirestore();
  } catch (e) {
    console.error('[notify-block] Auth failed:', e.message);
    return json(401, { error: 'Your session has expired.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }

  const blockedUserId = String(body.blockedUserId || '').trim();
  if (!blockedUserId) return json(400, { error: 'blockedUserId is required' });
  if (blockedUserId === blockerUid) return json(400, { error: 'You cannot block yourself.' });

  try {
    const { FieldValue } = require('firebase-admin/firestore');

    const [blockedProfile, blockerProfile, recent] = await Promise.all([
      db.collection('userProfiles').doc(blockedUserId).get().catch(() => null),
      db.collection('userProfiles').doc(blockerUid).get().catch(() => null),
      recentContentFor(db, blockedUserId),
    ]);

    const blockedName = (blockedProfile?.exists && blockedProfile.data().displayName) || 'Unknown';
    const blockerName = (blockerProfile?.exists && blockerProfile.data().displayName) || 'Unknown';

    const snapshot = recent
      .map((item) => `${item.label}: ${item.text || '(no text)'}`)
      .join('\n')
      .slice(0, MAX_SNAPSHOT_CHARS);

    // Deterministic id, so one person blocking another repeatedly (block,
    // unblock, block again) keeps one open row instead of filling the
    // queue with the same pair. Distinct blockers still each get a row,
    // which is what makes several of them visible as a pattern.
    const reportId = `block_${blockerUid}_${blockedUserId}`;
    const ref = db.collection('reports').doc(reportId);
    const existing = await ref.get();

    await ref.set({
      contentType: 'blockNotice',
      // No contentPath: a block is about a person, not a document. The
      // admin queue and moderate-report.js both branch on its absence.
      contentPath: null,
      contentId: null,
      contentSnapshot: snapshot,
      reporterId: blockerUid,
      reportedUserId: blockedUserId,
      reason: 'blocked',
      details: `${blockerName} blocked ${blockedName}.`,
      status: 'open',
      createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Only on the first block of this pair. Re-blocking the same person
    // is not new information and should not re-notify.
    if (!existing.exists) {
      const totalBlocks = await db.collection('reports')
        .where('reportedUserId', '==', blockedUserId)
        .where('reason', '==', 'blocked')
        .get()
        .then((s) => s.size)
        .catch(() => 1);

      await notifyAdmin({
        subject: `[MySetlists] ${blockedName} was blocked by a user${totalBlocks > 1 ? ` (${totalBlocks} total)` : ''}`,
        html: `
          <p><strong>${escapeHtml(blockerName)}</strong> blocked <strong>${escapeHtml(blockedName)}</strong>.</p>
          <p>This account has now been blocked by <strong>${totalBlocks}</strong> user${totalBlocks === 1 ? '' : 's'}.</p>
          <p><strong>Their recent posts:</strong></p>
          <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444;white-space:pre-wrap">${escapeHtml(snapshot) || '<em>(nothing found)</em>'}</blockquote>
          <p><strong>Blocked account:</strong> ${escapeHtml(blockedUserId)}<br>
             <strong>Blocked by:</strong> ${escapeHtml(blockerUid)}</p>
          <p>Review it in the Moderation tab: <a href="https://mysetlists.net/admin">mysetlists.net/admin</a></p>
          <p style="color:#888;font-size:12px">Guideline 1.2 commits to reviewing this within 24 hours.</p>
        `,
      });
    }

    return json(200, { notified: !existing.exists, reportId });
  } catch (e) {
    console.error('[notify-block] Failed:', e.message, e);
    return json(500, { error: 'Could not record that block.' });
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
