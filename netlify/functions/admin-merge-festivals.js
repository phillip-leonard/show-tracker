/**
 * admin-merge-festivals — Admin-only tool to find duplicate canonical
 * festivals in the shared catalog and merge them into one.
 *
 * WHY THIS EXISTS. Dedup at create time (context/AppContext.jsx's
 * findFestivalMatchesFor, surfaced inline by the create form) is advisory
 * by design: it shows matches and never blocks creation, because a wrong
 * auto-join is worse than a duplicate. So duplicates accumulate — two
 * people typing "Outside Lands" and "Outside Lands Music & Arts Festival"
 * a day apart, or someone creating one before the catalog had loaded.
 * Nothing could clean those up: the client cannot delete a canonical
 * (`allow delete: if false` in firestore.rules) and there was no admin
 * path either, so an un-merge needed a one-off function every time.
 *
 * POST body:
 *   { action: "scan", limit? }
 *     Read-only. Clusters the whole canonical catalog by the shared match
 *     rule and returns every cluster with 2+ members, each member carrying
 *     its attendee count, plus a suggested survivor and any users who are
 *     already on more than one member. Writes nothing, ever.
 *
 *   { action: "merge", survivorId, duplicateIds[], confirmUnmatched?,
 *     allowSharedAttendees?, dryRun? }
 *     Repoints every attendance record on each duplicate at survivorId,
 *     then deletes the duplicate canonical documents. dryRun defaults to
 *     TRUE; nothing is written unless it is explicitly false.
 *
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * WHAT IT NEVER DOES
 *   - Never touches a show. Shows link to a festival by the ATTENDANCE
 *     record's id, and this only ever rewrites that record's `festivalId`
 *     pointer, never its id — so every attached show stays attached and no
 *     show document is read or written here at all.
 *   - Never deletes or edits an attendance record, a note or a rating.
 *   - Never edits the survivor. Its name, dates and location are whatever
 *     its creator set; disagreements with the duplicates are reported, not
 *     merged in. Fixing the survivor's own fields is a separate, ordinary
 *     edit.
 *   - Never deletes a canonical while anything still points at it. The
 *     repoint happens first and the delete only runs after it succeeds, so
 *     an interrupted merge leaves records pointing at a festival that still
 *     exists rather than a dangling id.
 *   - Never merges two different editions. See THE YEAR GUARD below.
 *
 * THE EDITION GUARD. The one thing this tool must never do is collapse
 * Bonnaroo 2025 into Bonnaroo 2026 — the exact failure the shared match
 * rule's date gate exists to prevent, now reachable by hand. So:
 *
 *   - Pairs the rule matches: allowed.
 *   - Pairs the rule does not match, starting more than
 *     MAX_MANUAL_MERGE_GAP_DAYS apart, or with a start date too malformed
 *     to measure: REFUSED, with no override. There is no flag for this.
 *   - Pairs the rule does not match but which start close together (dates
 *     typed a fortnight apart, or names too dissimilar to score): allowed
 *     only with confirmUnmatched: true, so it is a deliberate act.
 *
 * The gap is measured in days rather than by comparing calendar years,
 * which would be the obvious way and is wrong: a festival running 30 Dec to
 * 2 Jan starts in a different year from a duplicate someone recorded as
 * starting 1 Jan, and a year comparison would call those two editions and
 * refuse a merge that is plainly correct. Two days apart is two days apart
 * whichever side of New Year it falls; a real edition boundary is ~365.
 *
 * SHARED ATTENDEES. If someone has their own attendance record on the
 * survivor AND on a duplicate, repointing both leaves them with two
 * records on one festival — two identical cards on their Festivals page.
 * Merging those records is not safe to do automatically: each one carries
 * its own notes, its own rating and its own attached shows, and shows hang
 * off the record id, so discarding either loses data. The merge therefore
 * REFUSES by default and names the users affected. allowSharedAttendees:
 * true proceeds anyway, accepting the duplicate cards as the lesser evil
 * (they can then be resolved by hand, per user, without losing anything).
 *
 * IDEMPOTENT. A second identical merge finds the duplicates already gone
 * and reports zero repointed, zero deleted.
 */

const {
  festivalsMatch,
  startGapDays,
  normalizeFestivalName,
  normalizeLocation,
} = require('./lib/festivalMatchRule');

const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// How many canonical festivals a scan will pull down. The catalog is small
// today; this stops the function from trying to cluster an unbounded
// collection if it ever isn't, and the response says when it truncated
// rather than quietly reporting a partial answer as complete.
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 2000;

// Firestore caps a batch at 500 writes.
const WRITE_BATCH_SIZE = 400;

// A merge touching more canonicals than this in one call is more likely a
// mistake than an intent.
const MAX_DUPLICATES_PER_MERGE = 20;

// How far apart two festivals may start and still be merged by hand when
// the match rule itself says they are not a pair. Comfortably wider than a
// badly typed date within one edition, and comfortably narrower than the
// ~365 days between two editions of an annual festival. See THE EDITION
// GUARD in the header.
const MAX_MANUAL_MERGE_GAP_DAYS = 60;

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

function createdAtMs(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * Every attendance record pointing at a canonical festival id, as
 * { uid, attendanceId, hasNotes, rating }.
 *
 * NOTE ON THE COLLECTION GROUP. The per-user subcollection and the
 * canonical collection are both called `festivals`, so a collectionGroup
 * query spans both. Canonical documents carry no `festivalId` field, so the
 * where clause already excludes them — but the parent check is explicit
 * here rather than assumed, because a canonical doc reaching the mapping
 * below would blow up on `parent.parent` being null for a top-level
 * document.
 */
async function attendanceFor(db, festivalId) {
  const snap = await db.collectionGroup('festivals').where('festivalId', '==', festivalId).get();
  return snap.docs
    .filter(d => d.ref.parent.parent !== null)
    .map(d => {
      const data = d.data();
      return {
        uid: d.ref.parent.parent.id,
        attendanceId: d.id,
        hasNotes: !!data.notes,
        rating: data.rating ?? null,
      };
    });
}

/**
 * Clusters canonical festivals by the shared match rule. Greedy and
 * order-dependent by nature, so the input is sorted oldest-first: the
 * earliest festival anchors its cluster, which makes the clustering stable
 * across runs and makes the oldest document the natural survivor.
 *
 * Pure — no Firestore access — so it can be exercised against fixtures.
 */
function clusterFestivals(festivals) {
  const sorted = festivals
    .slice()
    .sort((a, b) =>
      createdAtMs(a.createdAt) - createdAtMs(b.createdAt) ||
      String(a.id).localeCompare(String(b.id))
    );

  const clusters = [];
  sorted.forEach(festival => {
    // Matched against the cluster's anchor rather than any member, so
    // membership can't chain: A matching B and B matching C does not put A
    // and C together when A and C are a week and a name apart.
    const cluster = clusters.find(c => festivalsMatch(festival, c.anchor));
    if (cluster) cluster.members.push(festival);
    else clusters.push({ anchor: festival, members: [festival] });
  });

  return clusters.filter(c => c.members.length > 1);
}

/**
 * What differs between the survivor and a duplicate, in the same shape the
 * migration reports conflicts. Reported so an admin can fix the survivor's
 * own fields afterwards if the duplicate held the better values — this tool
 * never picks between them.
 */
function differencesFrom(survivor, duplicate) {
  const differences = [];
  if ((duplicate.name || '').trim() !== (survivor.name || '').trim()) {
    differences.push(`name "${duplicate.name}" vs "${survivor.name}"`);
  }
  if ((duplicate.startDate || '') !== (survivor.startDate || '')) {
    differences.push(`startDate ${duplicate.startDate} vs ${survivor.startDate}`);
  }
  if ((duplicate.endDate || '') !== (survivor.endDate || '')) {
    differences.push(`endDate ${duplicate.endDate} vs ${survivor.endDate}`);
  }
  if (normalizeLocation(duplicate.location) !== normalizeLocation(survivor.location)) {
    differences.push(`location "${duplicate.location || ''}" vs "${survivor.location || ''}"`);
  }
  return differences;
}

// `year` is left out on purpose. A festival added with only a year
// (5.58.0) matches every edition of its name in that year, both Coachella
// weekends included, so letting it into clusterFestivals could fold it into
// whichever weekend happened to anchor a cluster. Without `year` it has no
// date at all, matches nothing here, and is never merged automatically.
function toFestival(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name || '',
    nameNormalized: data.nameNormalized || normalizeFestivalName(data.name),
    startDate: data.startDate || '',
    endDate: data.endDate || data.startDate || '',
    location: data.location || '',
    edition: data.edition || '',
    createdBy: data.createdBy || '',
    createdAt: data.createdAt || null,
  };
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

  const { action } = body;

  try {
    // ── scan ─────────────────────────────────────────────────────────
    if (action === 'scan') {
      const limit = Math.min(Number(body.limit) || DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);
      const snap = await db.collection('festivals').limit(limit + 1).get();
      const truncated = snap.docs.length > limit;
      const festivals = snap.docs.slice(0, limit).map(toFestival);

      const clusters = clusterFestivals(festivals);

      // Attendance is only counted for festivals in a duplicate cluster —
      // one collectionGroup query per member, rather than one per festival
      // in the whole catalog.
      const detailed = [];
      for (const cluster of clusters) {
        const members = [];
        for (const festival of cluster.members) {
          const attendance = await attendanceFor(db, festival.id);
          members.push({
            ...festival,
            createdAt: undefined,
            attendeeCount: attendance.length,
            uids: attendance.map(a => a.uid),
          });
        }

        // Most attended wins, then the oldest — the anchor is already the
        // oldest, so a tie lands there. Only a suggestion; the caller sends
        // back whichever survivorId it wants.
        const suggested = members
          .slice()
          .sort((a, b) => b.attendeeCount - a.attendeeCount)[0];

        // Anyone already on two members of this cluster: merging will give
        // them duplicate cards unless it is handled per user.
        const seen = new Map();
        members.forEach(m => m.uids.forEach(uid => seen.set(uid, (seen.get(uid) || 0) + 1)));
        const usersOnMultiple = [...seen.entries()].filter(([, n]) => n > 1).map(([uid]) => uid);

        detailed.push({
          suggestedSurvivorId: suggested.id,
          totalAttendees: members.reduce((n, m) => n + m.attendeeCount, 0),
          usersOnMultiple,
          members: members.map(m => ({
            id: m.id,
            name: m.name,
            startDate: m.startDate,
            endDate: m.endDate,
            location: m.location,
            edition: m.edition,
            createdBy: m.createdBy,
            attendeeCount: m.attendeeCount,
          })),
        });
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          festivalsScanned: festivals.length,
          truncated,
          duplicateClusters: detailed.length,
          clusters: detailed,
        }),
      };
    }

    // ── merge ────────────────────────────────────────────────────────
    if (action !== 'merge') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'action must be "scan" or "merge"' }),
      };
    }

    const { survivorId } = body;
    const duplicateIds = Array.isArray(body.duplicateIds) ? [...new Set(body.duplicateIds)] : [];
    const dryRun = body.dryRun !== false; // default to dry run
    const confirmUnmatched = body.confirmUnmatched === true;
    const allowSharedAttendees = body.allowSharedAttendees === true;

    if (!survivorId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'survivorId is required' }) };
    }
    if (duplicateIds.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'duplicateIds must contain at least one id' }) };
    }
    if (duplicateIds.includes(survivorId)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'survivorId cannot also be in duplicateIds' }) };
    }
    if (duplicateIds.length > MAX_DUPLICATES_PER_MERGE) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `A merge may fold at most ${MAX_DUPLICATES_PER_MERGE} festivals at once` }),
      };
    }

    const survivorSnap = await db.collection('festivals').doc(survivorId).get();
    if (!survivorSnap.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: `No festival ${survivorId}` }) };
    }
    const survivor = toFestival(survivorSnap);

    const duplicates = [];
    const missing = [];
    for (const id of duplicateIds) {
      const snap = await db.collection('festivals').doc(id).get();
      if (snap.exists) duplicates.push(toFestival(snap));
      else missing.push(id);
    }

    // Already merged, or never existed. Either way there is nothing to do
    // for those ids, and saying so is more useful than failing the call.
    if (duplicates.length === 0) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          dryRun,
          alreadyMerged: missing,
          recordsRepointed: 0,
          festivalsDeleted: 0,
          note: 'None of the given duplicates exist — nothing to merge.',
        }),
      };
    }

    // ── the edition guard ────────────────────────────────────────────
    const unmatched = [];
    for (const duplicate of duplicates) {
      if (festivalsMatch(survivor, duplicate)) continue;
      const gapDays = startGapDays(survivor, duplicate);
      unmatched.push({
        id: duplicate.id,
        name: duplicate.name,
        startDate: duplicate.startDate,
        endDate: duplicate.endDate,
        gapDays,
        // An unreadable start date is refused rather than waved through:
        // there is no way to tell an edition apart from a typo without a
        // date, and the survivor's or duplicate's date should be corrected
        // by an ordinary edit before merging.
        crossEdition: gapDays === null || gapDays > MAX_MANUAL_MERGE_GAP_DAYS,
      });
    }

    const crossEdition = unmatched.filter(u => u.crossEdition);
    if (crossEdition.length > 0) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Refusing to merge across editions',
          detail:
            'These do not match the festival rule, and each starts either more than ' +
            `${MAX_MANUAL_MERGE_GAP_DAYS} days from the survivor (${survivor.name}, ` +
            `${survivor.startDate}) or on a date too malformed to measure. Two years of the same ` +
            'festival are two different festivals. There is no override for this — correct the ' +
            'dates first if one of them is simply wrong.',
          survivor: { id: survivor.id, name: survivor.name, startDate: survivor.startDate },
          crossEdition,
        }),
      };
    }

    if (unmatched.length > 0 && !confirmUnmatched) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Some duplicates do not match the festival rule',
          detail:
            `They start within ${MAX_MANUAL_MERGE_GAP_DAYS} days of the survivor, so this is not ` +
            'an edition collapse — their dates or names are simply too far apart for the rule to ' +
            'pair them. Re-send with confirmUnmatched: true if they really are the same festival.',
          survivor: { id: survivor.id, name: survivor.name, startDate: survivor.startDate },
          unmatched,
        }),
      };
    }

    // ── shared attendees ─────────────────────────────────────────────
    const survivorAttendance = await attendanceFor(db, survivor.id);
    const survivorUids = new Set(survivorAttendance.map(a => a.uid));

    const perDuplicate = [];
    const uidRecordCount = new Map();
    survivorUids.forEach(uid => uidRecordCount.set(uid, 1));

    for (const duplicate of duplicates) {
      const attendance = await attendanceFor(db, duplicate.id);
      attendance.forEach(a => uidRecordCount.set(a.uid, (uidRecordCount.get(a.uid) || 0) + 1));
      perDuplicate.push({
        id: duplicate.id,
        name: duplicate.name,
        startDate: duplicate.startDate,
        endDate: duplicate.endDate,
        attendance,
        differences: differencesFrom(survivor, duplicate),
      });
    }

    const sharedAttendees = [...uidRecordCount.entries()]
      .filter(([, n]) => n > 1)
      .map(([uid, n]) => ({ uid, recordsAfterMerge: n }));

    if (sharedAttendees.length > 0 && !allowSharedAttendees) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Some users would end up with more than one record on the surviving festival',
          detail:
            'Each attendance record carries its own notes, rating and attached shows, and shows ' +
            'hang off the record id, so nothing here can safely combine two of them without ' +
            'losing something. Re-send with allowSharedAttendees: true to proceed and leave the ' +
            'duplicate records for a human to reconcile, or drop those festivals from this merge.',
          sharedAttendees,
        }),
      };
    }

    const recordsToRepoint = perDuplicate.reduce((n, d) => n + d.attendance.length, 0);
    const plan = {
      survivor: {
        id: survivor.id,
        name: survivor.name,
        startDate: survivor.startDate,
        endDate: survivor.endDate,
        location: survivor.location,
        attendeeCount: survivorAttendance.length,
      },
      duplicates: perDuplicate.map(d => ({
        id: d.id,
        name: d.name,
        startDate: d.startDate,
        endDate: d.endDate,
        recordsToRepoint: d.attendance.length,
        differences: d.differences,
      })),
      alreadyMerged: missing,
      recordsRepointed: recordsToRepoint,
      festivalsDeleted: duplicates.length,
      mergedUnmatched: unmatched.map(u => u.id),
      sharedAttendees,
      showsTouched: 0,
      notesTouched: 0,
    };

    if (dryRun) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, dryRun: true, plan }) };
    }

    // ── write ────────────────────────────────────────────────────────
    // Repoint first, delete second. If this call dies between the two, the
    // records point at the survivor and the duplicate is an orphaned but
    // harmless document — re-running the merge finishes the job. The other
    // order would leave records pointing at a festival that no longer
    // exists, which renders as a missing festival for a real user.
    const refs = [];
    perDuplicate.forEach(duplicate => {
      duplicate.attendance.forEach(a => {
        refs.push(db.collection('users').doc(a.uid).collection('festivals').doc(a.attendanceId));
      });
    });

    let repointed = 0;
    for (let i = 0; i < refs.length; i += WRITE_BATCH_SIZE) {
      const batch = db.batch();
      const slice = refs.slice(i, i + WRITE_BATCH_SIZE);
      // merge: true — only the pointer and updatedAt are written. notes,
      // rating and every attached show are keyed off this same document and
      // are left exactly as they are.
      slice.forEach(ref => batch.set(ref, { festivalId: survivor.id, updatedAt: Timestamp.now() }, { merge: true }));
      await batch.commit();
      repointed += slice.length;
    }

    let deleted = 0;
    for (let i = 0; i < duplicates.length; i += WRITE_BATCH_SIZE) {
      const batch = db.batch();
      const slice = duplicates.slice(i, i + WRITE_BATCH_SIZE);
      slice.forEach(d => batch.delete(db.collection('festivals').doc(d.id)));
      await batch.commit();
      deleted += slice.length;
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        dryRun: false,
        plan: { ...plan, recordsRepointed: repointed, festivalsDeleted: deleted },
      }),
    };
  } catch (error) {
    console.error('Festival merge error:', error);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

// Exported for lib/__tests__/festivalMerge.test.js — the clustering is the
// part worth testing directly, and it is pure.
exports.clusterFestivals = clusterFestivals;
exports.differencesFrom = differencesFrom;
