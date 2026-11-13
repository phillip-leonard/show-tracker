/**
 * moderate-report — the three actions an admin can take on a report from
 * the Moderation queue in AdminView: dismiss it, delete the content, or
 * delete the content and ban its author.
 *
 * Admin-only, same Bearer-token check as the other admin-* functions in
 * this directory. It is a function rather than a client write for the
 * same reason report-content.js is: every one of these actions touches a
 * document the caller does not own — someone else's comment, someone
 * else's profile — which only the Admin SDK can do.
 *
 * POST body: { reportId, action: "dismiss" | "delete" | "ban" }
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * WHAT EACH ACTION DOES
 *
 *   dismiss — the report was wrong. If three reports had already pulled
 *             the content out of circulation, it goes back, with its
 *             original document id, so every reply, like and link to it
 *             still resolves. The counter is cleared so the same three
 *             reports cannot re-hide it the moment it returns.
 *
 *   delete  — the content is gone for good: removed from its collection
 *             if it is still there, and from moderationHidden if it was
 *             auto-hidden. Storage bytes for a photo are left alone,
 *             matching deletePhoto() in lib/photos.js — an orphaned file
 *             wastes a little space, where a failed storage call that
 *             aborted the delete would leave the content up.
 *
 *   ban     — EJECTION. Apple's wording is "ejecting the user who
 *             provided the offending content", and what this action used
 *             to do did not meet it: `banned: true` on the profile stopped
 *             them writing, but they could still sign in, still read, and
 *             every word they had already posted stayed up. The confirm
 *             dialog said as much out loud.
 *
 *             It now does four things:
 *               1. `banned: true` on the profile, which firestore.rules
 *                  and moderate-content.js both refuse writes against.
 *               2. Disables the Firebase Auth account, so sign-in fails
 *                  with auth/user-disabled.
 *               3. Revokes refresh tokens, so sessions already open on
 *                  other devices stop working at their next refresh
 *                  rather than lasting until the token expires.
 *               4. Sweeps every comment, meetup message and photo they
 *                  ever posted into `moderationHidden`, which only an
 *                  admin can read — so it is gone for everyone else but
 *                  recoverable if the decision was wrong.
 *
 *             The sweep is deliberately a move, not a delete, and it uses
 *             the same quarantine collection auto-hide uses. Mass-
 *             deleting a user's history on one report is not reversible;
 *             moving it is.
 *
 * Every action closes every OPEN report against that content, not just
 * the one the admin clicked — three reports about one comment are one
 * decision, and leaving the other two open would show the same comment
 * in the queue three times.
 */

const { withCors } = require('./lib/cors');
const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_ACTIONS = ['dismiss', 'delete', 'ban'];

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

async function verifyAdmin(token) {
  initFirebase();
  const { getAuth } = require('firebase-admin/auth');
  const decoded = await getAuth().verifyIdToken(token);
  if (!ADMIN_EMAILS.includes(decoded.email)) throw new Error('Forbidden');
  return decoded;
}

/**
 * Disable the account, kill its live sessions, and quarantine everything
 * it has published.
 *
 * Every step is independently best-effort and reported back, because
 * they fail independently and an admin needs to know WHICH half worked.
 * A user whose content is hidden but who can still sign in is a different
 * problem from one who is locked out with their comments still up.
 */
async function ejectUser(db, uid, byEmail) {
  const { getAuth } = require('firebase-admin/auth');
  const { FieldValue } = require('firebase-admin/firestore');
  const result = { authDisabled: false, tokensRevoked: false, contentHidden: 0, errors: [] };

  try {
    await getAuth().updateUser(uid, { disabled: true });
    result.authDisabled = true;
  } catch (e) {
    // auth/user-not-found is not a failure: the account is already gone,
    // which is a stronger version of what was being asked for.
    if (e.code === 'auth/user-not-found') result.authDisabled = true;
    else result.errors.push(`disable: ${e.message}`);
  }

  try {
    // Without this, a session already open on another device keeps
    // working until its ID token expires — up to an hour of posting
    // after being ejected.
    await getAuth().revokeRefreshTokens(uid);
    result.tokensRevoked = true;
  } catch (e) {
    if (e.code !== 'auth/user-not-found') result.errors.push(`revoke: ${e.message}`);
    else result.tokensRevoked = true;
  }

  // Everything this account has published, into the same admin-only
  // quarantine auto-hide uses. Moved rather than deleted so the decision
  // is reversible.
  const sources = [
    { collection: 'showComments', field: 'authorUid' },
    { collection: 'meetupComments', field: 'authorUid' },
    { collection: 'showPhotos', field: 'uploadedBy' },
  ];

  for (const source of sources) {
    try {
      const snap = await db.collection(source.collection)
        .where(source.field, '==', uid)
        .get();

      // Firestore caps a batch at 500 writes and each document costs two
      // (the copy in, the delete out), so 200 documents per batch leaves
      // room to spare.
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 200) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 200)) {
          batch.set(db.collection('moderationHidden').doc(`${source.collection}_${d.id}`), {
            collectionName: source.collection,
            docId: d.id,
            contentType: source.collection,
            data: d.data(),
            hidden: true,
            hiddenAt: FieldValue.serverTimestamp(),
            hiddenReason: `author ejected by ${byEmail}`,
            authorUid: uid,
          });
          batch.delete(d.ref);
        }
        await batch.commit();
        result.contentHidden += Math.min(200, docs.length - i);
      }
    } catch (e) {
      result.errors.push(`${source.collection}: ${e.message}`);
    }
  }

  return result;
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

  let admin;
  try {
    admin = await verifyAdmin(token);
  } catch (e) {
    return json(e.message === 'Forbidden' ? 403 : 401, { error: e.message });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }

  const { reportId, action } = body;
  if (!reportId) return json(400, { error: 'reportId is required' });
  if (!VALID_ACTIONS.includes(action)) {
    return json(400, { error: `action must be one of ${VALID_ACTIONS.join(', ')}` });
  }

  const firestore = require('firebase-admin/firestore');
  const db = firestore.getFirestore();
  const { FieldValue } = firestore;

  try {
    const reportRef = db.collection('reports').doc(String(reportId));
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) return json(404, { error: 'That report no longer exists.' });

    const report = reportSnap.data();
    const { contentId, contentPath } = report;
    const [collectionName] = String(contentPath || '').split('/');

    // A block notice (netlify/functions/notify-block.js) is a report about
    // a PERSON, not a document — it carries no contentPath at all. It
    // still belongs in this queue and still needs resolving, so the
    // content half of every action below is simply skipped for one.
    // Requiring a contentPath here, as this used to, would have made
    // every block notice permanently unresolvable.
    const isPersonReport = !collectionName || !contentId;
    if (isPersonReport && action === 'delete') {
      return json(400, { error: 'There is no single item to delete on a block notice.' });
    }

    const contentRef = isPersonReport ? null : db.collection(collectionName).doc(String(contentId));
    const hiddenRef = isPersonReport ? null : db.collection('moderationHidden').doc(`${collectionName}_${contentId}`);
    const counterRef = isPersonReport ? null : db.collection('moderationCounters').doc(String(contentId));

    const batch = db.batch();
    let restored = false;

    if (action === 'dismiss') {
      if (hiddenRef) {
        const hiddenSnap = await hiddenRef.get();
        if (hiddenSnap.exists) {
          // Back to its own collection under its original id, so replies
          // (which reference parentId) and any link to it still resolve.
          batch.set(contentRef, hiddenSnap.data().data || {});
          batch.delete(hiddenRef);
          restored = true;
        }
      }
      // Cleared, not decremented: leaving the count at three would let
      // the same three reports re-hide the content the instant it
      // returns, and an admin has now looked at all three.
      if (counterRef) batch.delete(counterRef);
    } else {
      if (contentRef) batch.delete(contentRef);
      if (hiddenRef) batch.delete(hiddenRef);
      if (counterRef) batch.delete(counterRef);

      if (action === 'ban' && report.reportedUserId) {
        batch.set(
          db.collection('userProfiles').doc(String(report.reportedUserId)),
          { banned: true, bannedAt: FieldValue.serverTimestamp(), bannedBy: admin.email },
          { merge: true },
        );
      }
    }

    // Close every open report against this content, not just this one.
    // A person report has no contentId to group by, so it closes alone —
    // and must, because two people blocking the same account are two
    // independent signals, not duplicate reports of one item.
    const siblings = isPersonReport
      ? { docs: [], size: 0 }
      : await db.collection('reports')
          .where('contentId', '==', String(contentId))
          .where('status', '==', 'open')
          .get();

    const status = action === 'dismiss' ? 'dismissed' : 'actioned';
    siblings.docs.forEach((sibling) => {
      batch.update(sibling.ref, {
        status,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: admin.email,
        resolvedAction: action,
      });
    });
    // The report that was clicked may already be closed (a re-click, or
    // resolved by a sibling action), in which case the query above misses
    // it — close it explicitly so the queue cannot get stuck on it.
    batch.update(reportRef, {
      status,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: admin.email,
      resolvedAction: action,
    });

    // Same audit trail the roadmap and venue-verification admin flows
    // write, so a moderation decision is as traceable as those are.
    batch.set(db.collection('adminAuditLog').doc(), {
      type: 'moderation',
      action,
      reportId: String(reportId),
      contentPath,
      reportedUserId: report.reportedUserId || null,
      by: admin.email,
      at: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // ── Ejection ──────────────────────────────────────────────────────
    // After the batch, not inside it: disabling an Auth account and
    // sweeping a content history are neither Firestore writes nor
    // atomic with one. The profile flag committed above is the part the
    // rules read, so a failure here leaves the user unable to write even
    // if they can still sign in — the safe half fails first.
    let ejected = null;
    if (action === 'ban' && report.reportedUserId) {
      ejected = await ejectUser(db, String(report.reportedUserId), admin.email);
    }

    return json(200, {
      action,
      restored,
      closedReports: siblings.size || 1,
      banned: action === 'ban' ? report.reportedUserId : null,
      ejected,
    });
  } catch (e) {
    console.error('[moderate-report] Failed:', e.message, e);
    return json(500, { error: 'That action failed. Please try again.' });
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
