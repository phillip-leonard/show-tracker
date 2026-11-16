/**
 * blockNotice — tells the developer that one user blocked another (App
 * Store Guideline 1.2: blocking must "notify the developer").
 *
 * Shared since 5.60.27 by:
 *   friends.js  action `block`  the server-side block (Stage 2, C-7): it
 *               writes the block and its side effects, then records this
 *   notify-block.js             the endpoint older app builds call after
 *               writing their own userBlocks document
 *
 * WHAT IT WRITES. A `reports` document with `reason: 'blocked'`, so it
 * lands in the same admin queue, on the same 24-hour clock, as every other
 * report. It has no `contentPath` (a block is about a person, not a
 * document; the queue and moderate-report.js both branch on that). It
 * carries a snapshot of the blocked account's recent posts, read here,
 * never sent by the caller: a client that supplies the evidence supplies
 * whatever gets someone ejected.
 *
 * The id is deterministic (`block_{blocker}_{blocked}`), so block, unblock,
 * block again keeps one row, and only the first block of a pair emails.
 * It never tells the blocked user, and callers treat it as best-effort: a
 * block must never fail because an email bounced.
 */

const https = require('https');

// The moderation inbox (a recipient, not an admin check: isAdmin() is the
// only admin check, CLAUDE.md).
const MODERATION_INBOX = ['phillip.leonard@gmail.com'];

// How much of the blocked account's recent output to put in front of the
// admin. Enough to see a pattern, few enough to read in the email.
const SNAPSHOT_LIMIT = 5;
const MAX_SNAPSHOT_CHARS = 2000;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Same Resend call report-content.js makes, and best-effort for the same reason. */
function emailModerators({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[blockNotice] RESEND_API_KEY not set — no admin notification sent.');
    return Promise.resolve(false);
  }
  const payload = JSON.stringify({ from: 'MySetlists Moderation <phillip@mysetlists.net>', to: MODERATION_INBOX, subject, html });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on('error', (err) => {
      console.error('[blockNotice] Admin notification failed:', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * The blocked account's most recent public text. Each query is
 * independently best-effort: a missing index on one collection must not
 * cost the admin the other two.
 */
async function recentContentFor(db, uid) {
  const sources = [
    { collection: 'showComments', field: 'authorUid', text: 'text', label: 'Comment' },
    { collection: 'meetupComments', field: 'authorUid', text: 'text', label: 'Meetup message' },
    { collection: 'showPhotos', field: 'uploadedBy', text: 'caption', label: 'Photo' },
  ];
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const snap = await db.collection(source.collection).where(source.field, '==', uid).limit(SNAPSHOT_LIMIT).get();
      return snap.docs.map((d) => ({
        label: source.label,
        path: `${source.collection}/${d.id}`,
        text: String(d.data()[source.text] || '').slice(0, 300),
      }));
    } catch (e) {
      console.warn(`[blockNotice] Could not read ${source.collection}:`, e.message);
      return [];
    }
  }));
  return results.flat().slice(0, SNAPSHOT_LIMIT * 2);
}

/**
 * recordBlockNotice(db, { blockerUid, blockedUserId, timestamp, email })
 * → { notified, reportId }. `timestamp()` is the value for createdAt and
 * updatedAt (FieldValue.serverTimestamp in notify-block, a Date in friends).
 * `email` defaults to the Resend call; tests pass a stub.
 */
async function recordBlockNotice(db, { blockerUid, blockedUserId, timestamp = () => new Date(), email = emailModerators }) {
  const [blockedProfile, blockerProfile, recent] = await Promise.all([
    db.collection('userProfiles').doc(blockedUserId).get().catch(() => null),
    db.collection('userProfiles').doc(blockerUid).get().catch(() => null),
    recentContentFor(db, blockedUserId),
  ]);
  const blockedName = (blockedProfile && blockedProfile.exists && blockedProfile.data().displayName) || 'Unknown';
  const blockerName = (blockerProfile && blockerProfile.exists && blockerProfile.data().displayName) || 'Unknown';
  const snapshot = recent.map((item) => `${item.label}: ${item.text || '(no text)'}`).join('\n').slice(0, MAX_SNAPSHOT_CHARS);

  const reportId = `block_${blockerUid}_${blockedUserId}`;
  const ref = db.collection('reports').doc(reportId);
  const existing = await ref.get();
  await ref.set({
    contentType: 'blockNotice',
    contentPath: null,
    contentId: null,
    contentSnapshot: snapshot,
    reporterId: blockerUid,
    reportedUserId: blockedUserId,
    reason: 'blocked',
    details: `${blockerName} blocked ${blockedName}.`,
    status: 'open',
    createdAt: existing.exists ? existing.data().createdAt : timestamp(),
    updatedAt: timestamp(),
  }, { merge: true });

  // Only the first block of this pair: re-blocking isn't new information.
  if (!existing.exists) {
    const totalBlocks = await db.collection('reports')
      .where('reportedUserId', '==', blockedUserId)
      .where('reason', '==', 'blocked')
      .get()
      .then((s) => s.size)
      .catch(() => 1);
    await email({
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
  return { notified: !existing.exists, reportId };
}

module.exports = { recordBlockNotice, recentContentFor, escapeHtml, MODERATION_INBOX };
