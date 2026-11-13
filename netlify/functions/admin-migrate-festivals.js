/**
 * admin-migrate-festivals — Admin-only migration from 5.28.0's per-user
 * festivals to 5.30.0's shared catalog + per-user attendance.
 *
 * POST body:   { dryRun?: boolean }  (default dryRun=true — set to false to write)
 * Auth header: Authorization: Bearer {idToken}   (admin account only)
 *
 * Response:    { success, dryRun, usersScanned, festivalsScanned,
 *                alreadyMigrated, groups[], canonicalCreated, recordsRepointed,
 *                conflicts[], failures[] }
 *
 * WHAT IT DOES
 *   1. Reads every user's users/{uid}/festivals subcollection.
 *   2. Groups records across ALL users by the same match rule the app uses
 *      (see MATCH RULE below) — so two people who each created "Bonnaroo
 *      2026" end up in one group.
 *   3. Creates one canonical festivals/{id} per group. Earliest-created
 *      record in the group wins every canonical field value.
 *   4. Rewrites each user's record in place to point at that canonical id,
 *      keeping their notes and rating and DROPPING the now-canonical
 *      name/dates/location from their private copy — the duplicated-fact
 *      drift this whole change exists to remove.
 *
 * WHAT IT NEVER DOES
 *   - Never touches a show. Show documents link to festivals by the
 *     ATTENDANCE record's id, and this migration keeps every attendance
 *     record at its existing id, so no show link changes and no show is
 *     read or written here at all.
 *   - Never deletes a user's notes or rating.
 *   - Never picks silently between disagreeing group members: the earliest
 *     wins for the canonical values, and every disagreement is reported in
 *     `conflicts` for a human to look at.
 *
 * IDEMPOTENT. A record that already carries `festivalId` is counted under
 * `alreadyMigrated` and skipped, and it contributes its canonical document
 * to the group so a second run reuses that document rather than creating a
 * parallel one. Running twice creates nothing the first run didn't.
 *
 * PER-USER FAILURE ISOLATION. A record that fails to write is reported in
 * `failures` and left exactly as it was — still holding its own name and
 * dates, still rendering on that user's Festivals page (the app reads a
 * record with no `festivalId` as a pre-migration record and shows it
 * unchanged). A partially-migrated user never sees an empty page.
 *
 * MATCH RULE. Re-implemented here rather than imported from
 * lib/festivalMatch.js: this is CommonJS running under firebase-admin in a
 * Netlify function, with no build step to resolve the app's `@/lib` alias.
 * It is a direct port and must stay in step — if you change one, change
 * both. lib/__tests__/festivalMatch.test.js covers the shared semantics.
 */

const { withCors } = require('./lib/cors');
const ADMIN_EMAILS = ['phillip.leonard@gmail.com'];
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Ported from lib/festivalMatch.js — keep in step.
const MAX_START_DATE_GAP_DAYS = 3;
const MIN_NAME_SIMILARITY = 0.6;
const MIN_NAME_LENGTH = 3;
const MS_PER_DAY = 86400000;
// See lib/festivalMatch.js for why these exist: a startDate typed as
// "0011-08-12" parsed as year 11 AD, giving a ~2001-year window that
// merged a 2011 festival into a 2008 one. Out-of-range dates now match
// nothing rather than everything.
const MAX_FESTIVAL_DAYS = 30;
const MIN_FESTIVAL_YEAR = 1900;
const MAX_FESTIVAL_YEAR = 2100;
const LEADING_ARTICLES = /^(the|a|an)\s+/;
const TRAILING_YEAR = /\s+(19|20)\d{2}$/;

function normalizeFestivalName(name) {
  let out = String(name || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(LEADING_ARTICLES, '');
  return out.replace(TRAILING_YEAR, '').trim();
}

function nameTokens(normalized) {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function nameSimilarity(a, b) {
  const ta = new Set(nameTokens(normalizeFestivalName(a)));
  const tb = new Set(nameTokens(normalizeFestivalName(b)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach(t => { if (tb.has(t)) shared++; });
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

function namesAreClose(a, b) {
  const na = normalizeFestivalName(a);
  const nb = normalizeFestivalName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < MIN_NAME_LENGTH || nb.length < MIN_NAME_LENGTH) return false;
  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longerSet = new Set(ta.length <= tb.length ? tb : ta);
  if (shorter.every(t => longerSet.has(t))) return true;
  return nameSimilarity(a, b) >= MIN_NAME_SIMILARITY;
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const year = Number(value.slice(0, 4));
  if (year < MIN_FESTIVAL_YEAR || year > MAX_FESTIVAL_YEAR) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function windowOf(festival) {
  const start = parseDay(festival && festival.startDate);
  if (start === null) return null;
  const end = parseDay(festival && festival.endDate);
  if (end === null || end < start) return { start, end: start };
  if (end - start > MAX_FESTIVAL_DAYS * MS_PER_DAY) return null;
  return { start, end };
}

function datesAreClose(a, b) {
  const wa = windowOf(a);
  const wb = windowOf(b);
  if (!wa || !wb) return false;
  if (wa.start <= wb.end && wb.start <= wa.end) return true;
  return Math.abs(wa.start - wb.start) <= MAX_START_DATE_GAP_DAYS * MS_PER_DAY;
}

function normalizeLocation(location) {
  return String(location || '')
    .toLowerCase()
    .split(',')[0]
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function festivalsMatch(a, b) {
  if (!a || !b) return false;
  return namesAreClose(a.name, b.name) && datesAreClose(a, b);
}
// ── end ported match rule ─────────────────────────────────────────────

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

// Firestore Timestamp | ISO string | undefined -> comparable number.
// Missing createdAt sorts last, so a record that has one always wins
// "earliest" over one that doesn't.
function createdAtMs(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * Groups every per-user festival record into clusters of the same
 * real-world festival, and decides what each cluster's canonical document
 * should hold. Pure — no Firestore access — so it can be exercised
 * directly against fixtures. Exported for that reason.
 *
 * `records` are { uid, docId, name, startDate, endDate, location, notes,
 * rating, createdAt, festivalId }.
 *
 * `existingCanonicals` are the canonical festivals already in the catalog,
 * { id, name, nameNormalized, startDate, endDate, location, createdBy }.
 * They seed the grouping, which is what makes a rerun idempotent in both
 * directions: an already-migrated record rejoins the canonical it points
 * at, AND a record that failed on the first run is matched against the
 * canonical that run created rather than getting a second one. (Migrated
 * records have had their own name and dates deleted, so they carry nothing
 * left to match on — the seed is where those facts now live.)
 */
function planMigration(records, existingCanonicals = []) {
  const groups = existingCanonicals.map(canonical => ({
    existingFestivalId: canonical.id,
    canonical: {
      name: (canonical.name || '').trim(),
      nameNormalized: canonical.nameNormalized || normalizeFestivalName(canonical.name),
      startDate: canonical.startDate || '',
      endDate: canonical.endDate || canonical.startDate || '',
      location: (canonical.location || '').trim(),
      edition: canonical.edition || '',
      createdBy: canonical.createdBy || '',
    },
    members: [],
    conflicts: [],
  }));

  // Deterministic order so a rerun groups identically: earliest first,
  // then by uid/docId to break ties. The earliest-created record in a new
  // group defines that group's canonical values.
  const sorted = records
    .slice()
    .sort((a, b) =>
      createdAtMs(a.createdAt) - createdAtMs(b.createdAt) ||
      String(a.uid).localeCompare(String(b.uid)) ||
      String(a.docId).localeCompare(String(b.docId))
    );

  sorted.forEach(record => {
    let group = record.festivalId
      ? groups.find(g => g.existingFestivalId === record.festivalId)
      : null;

    // A record pointing at a canonical that no longer exists falls back to
    // matching on its own fields rather than being dropped.
    if (!group) group = groups.find(g => festivalsMatch(record, g.canonical));

    if (!group) {
      group = {
        existingFestivalId: null,
        canonical: {
          name: (record.name || '').trim(),
          nameNormalized: normalizeFestivalName(record.name),
          startDate: record.startDate || '',
          endDate: record.endDate || record.startDate || '',
          location: (record.location || '').trim(),
          edition: '',
          createdBy: record.uid,
        },
        members: [],
        conflicts: [],
      };
      groups.push(group);
    }

    // Anything a later member disagrees with is logged rather than merged
    // in or silently dropped. A record that has already been migrated has
    // no local name or dates left to disagree with, so it's skipped here.
    const c = group.canonical;
    if (group.members.length > 0 && !record.festivalId) {
      const differences = [];
      if ((record.name || '').trim() !== c.name) differences.push(`name "${record.name}" vs "${c.name}"`);
      if ((record.startDate || '') !== c.startDate) differences.push(`startDate ${record.startDate} vs ${c.startDate}`);
      if ((record.endDate || record.startDate || '') !== c.endDate) differences.push(`endDate ${record.endDate} vs ${c.endDate}`);
      if (normalizeLocation(record.location) !== normalizeLocation(c.location)) {
        differences.push(`location "${record.location}" vs "${c.location}"`);
      }
      if (differences.length > 0) {
        group.conflicts.push({ uid: record.uid, docId: record.docId, differences });
      }
    }

    group.members.push(record);
  });

  // A seeded canonical nobody turned out to belong to is not part of this
  // migration's plan.
  return groups.filter(g => g.members.length > 0);
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

  const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
  const db = getFirestore();

  const body = JSON.parse(event.body || '{}');
  const dryRun = body.dryRun !== false; // default to dry run

  try {
    // ── Read every user's festivals ──────────────────────────────────
    const usersSnap = await db.collection('userProfiles').get();
    const records = [];
    let usersScanned = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      usersScanned++;
      const festSnap = await db.collection('users').doc(uid).collection('festivals').get();
      festSnap.docs.forEach(d => {
        const data = d.data();
        records.push({
          uid,
          docId: d.id,
          festivalId: data.festivalId || null,
          name: data.name || '',
          startDate: data.startDate || '',
          endDate: data.endDate || '',
          location: data.location || '',
          notes: data.notes || '',
          rating: data.rating === undefined ? null : data.rating,
          createdAt: data.createdAt,
        });
      });
    }

    // Seed the grouping with the canonical festivals that already exist,
    // so a rerun reuses them instead of creating a parallel set.
    const canonicalSnap = await db.collection('festivals').get();
    const existingCanonicals = canonicalSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const alreadyMigrated = records.filter(r => r.festivalId).length;
    const groups = planMigration(records, existingCanonicals);

    // ── Apply (or describe) ──────────────────────────────────────────
    const plan = [];
    const conflicts = [];
    const failures = [];
    let canonicalCreated = 0;
    let recordsRepointed = 0;

    for (const group of groups) {
      let festivalId = group.existingFestivalId;

      // The canonical document, created once per group.
      if (!festivalId) {
        const ref = db.collection('festivals').doc();
        festivalId = ref.id;
        if (!dryRun) {
          try {
            await ref.set({
              ...group.canonical,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            });
          } catch (e) {
            failures.push({
              scope: 'canonical',
              name: group.canonical.name,
              members: group.members.map(m => `${m.uid}/${m.docId}`),
              reason: e.message,
            });
            // Leave every member of this group untouched — they keep
            // rendering as pre-migration records.
            continue;
          }
        }
        canonicalCreated++;
      }

      const repointed = [];
      for (const member of group.members) {
        if (member.festivalId === festivalId) continue; // already done
        if (!dryRun) {
          try {
            await db.collection('users').doc(member.uid).collection('festivals').doc(member.docId).set({
              festivalId,
              notes: member.notes,
              rating: member.rating,
              // The canonical document owns these now. Deleting the local
              // copies is the point: two copies of one fact is exactly the
              // drift this change removes.
              name: FieldValue.delete(),
              startDate: FieldValue.delete(),
              endDate: FieldValue.delete(),
              location: FieldValue.delete(),
              updatedAt: Timestamp.now(),
            }, { merge: true });
          } catch (e) {
            failures.push({ scope: 'attendance', uid: member.uid, docId: member.docId, reason: e.message });
            continue;
          }
        }
        recordsRepointed++;
        repointed.push(`${member.uid}/${member.docId}`);
      }

      group.conflicts.forEach(c => conflicts.push({ festival: group.canonical.name, ...c }));

      plan.push({
        festivalId,
        reused: !!group.existingFestivalId,
        canonical: group.canonical,
        memberCount: group.members.length,
        members: group.members.map(m => ({
          uid: m.uid,
          docId: m.docId,
          name: m.name,
          startDate: m.startDate,
          endDate: m.endDate,
          location: m.location,
          hasNotes: !!m.notes,
        })),
        repointed,
      });
    }

    // Merged groups first — those are the ones worth eyeballing.
    plan.sort((a, b) => b.memberCount - a.memberCount || a.canonical.name.localeCompare(b.canonical.name));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        dryRun,
        usersScanned,
        festivalsScanned: records.length,
        alreadyMigrated,
        canonicalCreated,
        recordsRepointed,
        mergedGroups: plan.filter(g => g.memberCount > 1).length,
        groups: plan,
        conflicts,
        failures,
      }),
    };
  } catch (error) {
    console.error('Festival migration error:', error);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

// Exported for the fixture harness in scripts/festival-migration-dryrun.js.
exports.planMigration = planMigration;
exports.normalizeFestivalName = normalizeFestivalName;
exports.festivalsMatch = festivalsMatch;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
