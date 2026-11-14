/**
 * admin-repair-festival-split — Admin-only tool to pull one user's
 * attendance record out of a canonical festival it should never have been
 * merged into, and point it at the right one instead.
 *
 * WHY THIS EXISTS. admin-migrate-festivals grouped by the shared match
 * rule, and one production record defeated it: a startDate typed as
 * "0011-08-12" instead of "2011-08-12" parsed as year 11 AD, producing a
 * ~2001-year-wide window that overlapped everything in the catalog. Its
 * name ("Outside Lands") was contained by another edition's ("Outside
 * Lands Music & Arts Festival"), so both gates passed and a 2011 festival
 * was merged into a 2008 one.
 *
 * The rule is fixed (lib/festivalMatch.js + the port in
 * admin-migrate-festivals.js now bound both the year and the span), but
 * the migration had already written. The rule fix prevents recurrence; it
 * cannot undo a merge, because migration is idempotent and re-running it
 * will not un-merge anything. Hence this.
 *
 * POST body:
 *   { action: "inspect", uid }
 *     Lists that user's attendance records joined to their canonical
 *     festivals — the doc ids and current groupings needed to pick a
 *     target. Read-only regardless of dryRun.
 *
 *   { action: "split", uid, attendanceId, name, startDate, endDate,
 *     location?, edition?, dryRun? }
 *     Points users/{uid}/festivals/{attendanceId} at a canonical festival
 *     matching the corrected details — reusing an existing canonical when
 *     one already matches exactly, creating one otherwise. dryRun defaults
 *     to TRUE; nothing is written unless it is explicitly false.
 *
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * WHAT IT NEVER DOES
 *   - Never touches a show. Shows link to a festival by the ATTENDANCE
 *     record's id, which this never changes, so every attached show stays
 *     attached throughout.
 *   - Never deletes the user's notes or rating.
 *   - Never deletes or edits the canonical the record is leaving — other
 *     users are still attending it.
 *   - Never guesses the corrected dates. The caller supplies them, and
 *     they are validated against the same bounds the match rule uses, so
 *     the typo that caused this cannot be re-entered here.
 */

const { withCors } = require('./lib/cors');
// The one admin check: custom claim or verified allowlisted address (5.59.12).
const { isAdmin } = require('./lib/firebaseAdmin');
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kept in step with lib/festivalMatch.js — see the note in
// admin-migrate-festivals.js about why the rule is ported rather than
// imported.
const MIN_FESTIVAL_YEAR = 1900;
const MAX_FESTIVAL_YEAR = 2100;
const MAX_FESTIVAL_DAYS = 30;
const MS_PER_DAY = 86400000;
const FESTIVAL_NAME_MAX = 120;

function normalizeFestivalName(name) {
  let out = String(name || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/^(the|a|an)\s+/, '');
  return out.replace(/\s+(19|20)\d{2}$/, '').trim();
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const year = Number(String(value).slice(0, 4));
  if (year < MIN_FESTIVAL_YEAR || year > MAX_FESTIVAL_YEAR) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

// The corrected details have to survive the same scrutiny the match rule
// applies, otherwise a repair could reintroduce the exact class of bad
// data that made the repair necessary.
function validateDetails({ name, startDate, endDate }) {
  const problems = [];
  const trimmed = String(name || '').trim();
  if (!trimmed) problems.push('name is required');
  if (trimmed.length > FESTIVAL_NAME_MAX) problems.push(`name exceeds ${FESTIVAL_NAME_MAX} characters`);

  const start = parseDay(startDate);
  const end = parseDay(endDate || startDate);
  if (start === null) {
    problems.push(`startDate "${startDate}" is not a plausible yyyy-MM-dd date (year must be ${MIN_FESTIVAL_YEAR}-${MAX_FESTIVAL_YEAR})`);
  }
  if (end === null) {
    problems.push(`endDate "${endDate}" is not a plausible yyyy-MM-dd date (year must be ${MIN_FESTIVAL_YEAR}-${MAX_FESTIVAL_YEAR})`);
  }
  if (start !== null && end !== null) {
    if (end < start) problems.push('endDate is before startDate');
    else if (end - start > MAX_FESTIVAL_DAYS * MS_PER_DAY) {
      problems.push(`the window spans more than ${MAX_FESTIVAL_DAYS} days — check for a mistyped year`);
    }
  }
  return problems;
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
  if (!isAdmin(decoded)) throw new Error('Forbidden');
  return decoded;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  try {
    await verifyAdmin(token);
  } catch (e) {
    const status = e.message === 'Forbidden' ? 403 : 401;
    return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }

  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const db = getFirestore();

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Body must be JSON' }) };
  }

  const { action, uid } = body;
  if (!uid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'uid is required' }) };
  }

  try {
    // ── inspect ──────────────────────────────────────────────────────
    if (action === 'inspect') {
      const snap = await db.collection('users').doc(uid).collection('festivals').get();
      const records = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        let canonical = null;
        if (data.festivalId) {
          const cSnap = await db.collection('festivals').doc(data.festivalId).get();
          canonical = cSnap.exists ? { id: cSnap.id, ...cSnap.data() } : null;
        }
        records.push({
          attendanceId: doc.id,
          festivalId: data.festivalId || null,
          migrated: !!data.festivalId,
          hasNotes: !!data.notes,
          rating: data.rating ?? null,
          // Present only on a record the migration has not reached.
          ownName: data.name || null,
          ownStartDate: data.startDate || null,
          ownEndDate: data.endDate || null,
          canonical: canonical && {
            id: canonical.id,
            name: canonical.name,
            startDate: canonical.startDate,
            endDate: canonical.endDate,
            location: canonical.location || '',
            createdBy: canonical.createdBy,
            isCreator: canonical.createdBy === uid,
          },
        });
      }
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, uid, records }) };
    }

    // ── split ────────────────────────────────────────────────────────
    if (action !== 'split') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'action must be "inspect" or "split"' }),
      };
    }

    const { attendanceId, name, startDate, endDate, location = '', edition = '' } = body;
    const dryRun = body.dryRun !== false; // default to dry run

    if (!attendanceId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'attendanceId is required for a split' }) };
    }

    const problems = validateDetails({ name, startDate, endDate });
    if (problems.length) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid festival details', problems }) };
    }

    const attendanceRef = db.collection('users').doc(uid).collection('festivals').doc(attendanceId);
    const attendanceSnap = await attendanceRef.get();
    if (!attendanceSnap.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: `No attendance record ${uid}/${attendanceId}` }) };
    }
    const attendance = attendanceSnap.data();
    const leavingId = attendance.festivalId || null;

    // Reuse an existing canonical that already matches these details
    // exactly, so repairing two users onto the same festival lands them
    // together rather than creating a second copy.
    const normalized = normalizeFestivalName(name);
    const existing = await db.collection('festivals')
      .where('nameNormalized', '==', normalized)
      .where('startDate', '==', startDate)
      .get();
    const reused = existing.docs.find(d => (d.data().endDate || '') === (endDate || startDate));

    const targetId = reused ? reused.id : db.collection('festivals').doc().id;
    const canonicalDoc = {
      name: String(name).trim(),
      nameNormalized: normalized,
      startDate,
      endDate: endDate || startDate,
      location: String(location || '').trim(),
      edition: String(edition || '').trim(),
      createdBy: uid,
    };

    // How many other people are still on the festival being left — proof
    // that this repair does not strand anyone.
    let othersRemaining = null;
    if (leavingId) {
      const all = await db.collectionGroup('festivals').where('festivalId', '==', leavingId).get();
      othersRemaining = all.docs.filter(d => d.ref.parent.parent.id !== uid).length;
    }

    const plan = {
      uid,
      attendanceId,
      leavingFestivalId: leavingId,
      targetFestivalId: targetId,
      targetAction: reused ? 'reuse existing canonical' : 'create canonical',
      canonical: canonicalDoc,
      othersRemainingOnLeftFestival: othersRemaining,
      notesPreserved: !!attendance.notes,
      ratingPreserved: attendance.rating ?? null,
      showsTouched: 0,
    };

    if (dryRun) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, dryRun: true, plan }) };
    }

    if (!reused) {
      await db.collection('festivals').doc(targetId).set({
        ...canonicalDoc,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }
    // Only the pointer moves. notes, rating and every attached show are
    // keyed off this same attendance doc and are left exactly as they are.
    await attendanceRef.set({ festivalId: targetId, updatedAt: Timestamp.now() }, { merge: true });

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, dryRun: false, plan }) };
  } catch (error) {
    console.error('Festival split repair error:', error);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
