// netlify/functions/lib/festivalActions.js — the festival writes other
// people read, on the server (5.60.36, Stage 5 Part 2). Served by
// netlify/functions/festivals.js; the decisions are in
// docs/ios-native/STAGE5-AUDIT.md and DECISIONS.md "Stage 5".
//
// A festival is two documents (context/AppContext.jsx, "FESTIVAL
// FUNCTIONS"): the shared canonical festivals/{festivalId}, which every
// signed-in user can read, and the caller's private attendance record
// users/{uid}/festivals/{attendanceId}. Shows point at the attendance id.
//
//   create  { attendanceId, name, startDate?, endDate?, year?, location?, edition?, notes? }
//           -> { festival, already }
//           Both documents in one batch. The app mints attendanceId, so a
//           retry after a lost answer finds the festival it made.
//   join    { festivalId, attendanceId } -> { festival, already }
//           An attendance record for an existing canonical festival; a
//           second join answers the record already there.
//   leave   { attendanceId } -> { detached }
//           Clears festivalId on every one of the caller's shows that has
//           it (found here, not on the device), then deletes the record.
//           The canonical festival is never touched, the creator's included.
//   update  { attendanceId, name?, startDate?, endDate?, year?, location?, edition? }
//           -> { festival }
//           The creator's (or the admin's) edit of the shared details.
//           Dates are rewritten whole: both dates and their year, or only
//           the year. A record from before 5.30.0 has no canonical, so its
//           owner's edit goes on the record itself.
//
// Every answer's festival is lib/festivalCatalog.js joinedFestival, the
// object the screens read. Notes, the typed lineup and attaching shows are
// the caller's own one-field writes and stay in the apps.

const { festivalNameProblem, normalizeFestivalName } = require('../../../lib/festivalMatch');
const { festivalWhenFields } = require('../../../lib/festivalDates');
const { joinedFestival, isSeededFestival } = require('../../../lib/festivalCatalog');
const { takeDailyQuota } = require('./rateLimit');

// New festivals per user per UTC day. A canonical festival is shared and
// can't be deleted by anyone but the admin, so a script mustn't be able to
// fill the catalog.
const CREATES_PER_DAY = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LOCATION_MAX = 200;
const EDITION_MAX = 40;
const NOTES_MAX = 10000;
// A batch holds 500 writes; leave keeps one for the record's delete.
const BATCH_MAX = 450;

class Refusal extends Error {
  constructor(status, message, code = null, field = null) { super(message); this.status = status; this.code = code; this.field = field; }
}
const refuse = (status, message, code = null, field = null) => { throw new Refusal(status, message, code, field); };

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function idFrom(body, key, what) {
  const id = String((body && body[key]) || '');
  if (!ID_RE.test(id)) refuse(400, `Which ${what}?`, 'bad-input', key);
  return id;
}

/** The canonical document create writes. Every field is the create rule's (lib/__tests__/festivalSeed.test.js). */
function newCanonicalFestival({ name, when, location, edition, uid, now }) {
  const canonical = {
    name,
    nameNormalized: normalizeFestivalName(name),
    startDate: when.startDate,
    endDate: when.endDate,
    year: when.year,
    location,
    edition,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
  // A year-only festival has no date fields at all (firestore.rules
  // festivalWhenIsValid: never one date without the other, never null).
  if (!when.startDate) { delete canonical.startDate; delete canonical.endDate; }
  return canonical;
}

function nameFrom(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const problem = festivalNameProblem(name);
  if (problem) refuse(400, problem, 'bad-input', 'name');
  return name;
}

function whenFrom(body) {
  const year = body.year === '' || body.year == null ? undefined : body.year;
  const when = festivalWhenFields({
    startDate: typeof body.startDate === 'string' ? body.startDate : '',
    endDate: typeof body.endDate === 'string' ? body.endDate : '',
    year,
  });
  if (!when) refuse(400, 'Add the start and end dates (the end not before the start), or the year from 1900 to 2100.', 'bad-input', 'dates');
  return when;
}

async function readJoined(db, uid, attendanceId) {
  const snap = await db.doc(`users/${uid}/festivals/${attendanceId}`).get();
  if (!snap.exists) return null;
  const attendance = snap.data();
  if (!attendance.festivalId) return joinedFestival(attendanceId, attendance, undefined, uid);
  const canonical = await db.doc(`festivals/${attendance.festivalId}`).get();
  return joinedFestival(attendanceId, attendance, canonical.exists ? canonical.data() : null, uid);
}

async function create({ db, uid, body, now = new Date() }) {
  const attendanceId = idFrom(body, 'attendanceId', 'festival');
  // A retry of a create that already went through: the same festival.
  const existing = await readJoined(db, uid, attendanceId);
  if (existing) {
    if (existing.isCreator && !existing.unmigrated) return { festival: existing, already: true };
    refuse(409, 'That festival id is already in use.', 'conflict');
  }
  const name = nameFrom(body);
  const when = whenFrom(body);
  const quota = await takeDailyQuota(db, `festcreate_${uid}`, CREATES_PER_DAY, { uid });
  if (!quota.allowed) refuse(429, 'You’ve created a lot of festivals today. Try again tomorrow.', 'rate_limited');

  const canonicalRef = db.collection('festivals').doc();
  const canonical = newCanonicalFestival({
    name, when, location: text(body.location, LOCATION_MAX), edition: text(body.edition, EDITION_MAX), uid, now,
  });
  const attendance = {
    festivalId: canonicalRef.id, notes: text(body.notes, NOTES_MAX), rating: null, createdAt: now, updatedAt: now,
  };
  // One batch: never a shared festival nobody attends (it couldn't be
  // deleted), never a record pointing at nothing.
  const batch = db.batch();
  batch.set(canonicalRef, canonical);
  batch.set(db.doc(`users/${uid}/festivals/${attendanceId}`), attendance);
  await batch.commit();
  return { festival: joinedFestival(attendanceId, attendance, canonical, uid), already: false };
}

async function join({ db, uid, body, now = new Date() }) {
  const festivalId = idFrom(body, 'festivalId', 'festival');
  const attendanceId = idFrom(body, 'attendanceId', 'festival');
  const canonicalSnap = await db.doc(`festivals/${festivalId}`).get();
  if (!canonicalSnap.exists) refuse(404, 'That festival isn’t there any more.', 'not_found');
  const canonical = canonicalSnap.data();

  const mine = await db.collection(`users/${uid}/festivals`).where('festivalId', '==', festivalId).limit(1).get();
  if (!mine.empty) {
    const d = mine.docs[0];
    return { festival: joinedFestival(d.id, d.data(), canonical, uid), already: true };
  }
  const ref = db.doc(`users/${uid}/festivals/${attendanceId}`);
  if ((await ref.get()).exists) refuse(409, 'That festival id is already in use.', 'conflict');
  const attendance = { festivalId, notes: '', rating: null, createdAt: now, updatedAt: now };
  await ref.set(attendance);
  return { festival: joinedFestival(attendanceId, attendance, canonical, uid), already: false };
}

async function leave({ db, uid, body }) {
  const attendanceId = idFrom(body, 'attendanceId', 'festival');
  const shows = await db.collection(`users/${uid}/shows`).where('festivalId', '==', attendanceId).get();
  const refs = shows.docs.map((d) => d.ref);
  // Shows first, the record last: a failure part way leaves the festival
  // in place to leave again, never shows pointing at a deleted record.
  for (let i = 0; i < refs.length; i += BATCH_MAX) {
    const batch = db.batch();
    refs.slice(i, i + BATCH_MAX).forEach((ref) => batch.update(ref, { festivalId: null }));
    await batch.commit();
  }
  await db.doc(`users/${uid}/festivals/${attendanceId}`).delete();
  return { detached: refs.length };
}

const DETAIL_KEYS = ['name', 'startDate', 'endDate', 'year', 'location', 'edition'];
const has = (body, k) => Object.prototype.hasOwnProperty.call(body, k);

async function update({ db, uid, body, isAdmin = false, now = new Date() }) {
  const attendanceId = idFrom(body, 'attendanceId', 'festival');
  if (!DETAIL_KEYS.some((k) => has(body, k))) refuse(400, 'Nothing to change.', 'bad-input');
  const attendanceRef = db.doc(`users/${uid}/festivals/${attendanceId}`);
  const attendanceSnap = await attendanceRef.get();
  if (!attendanceSnap.exists) refuse(404, 'That festival isn’t in your festivals.', 'not_found');
  const attendance = attendanceSnap.data();

  const apply = (current) => {
    const next = { ...current };
    if (has(body, 'name')) {
      next.name = nameFrom(body);
      next.nameNormalized = normalizeFestivalName(next.name);
    }
    if (has(body, 'location')) next.location = text(body.location, LOCATION_MAX);
    if (has(body, 'edition')) next.edition = text(body.edition, EDITION_MAX);
    if (['startDate', 'endDate', 'year'].some((k) => has(body, k))) {
      const when = whenFrom(body);
      delete next.startDate; delete next.endDate; delete next.year;
      Object.assign(next, when);
    }
    next.updatedAt = now;
    return next;
  };

  // A record from before 5.30.0: still entirely its owner's.
  if (!attendance.festivalId) {
    const next = apply(attendance);
    delete next.nameNormalized;
    await attendanceRef.set(next);
    return { festival: joinedFestival(attendanceId, next, undefined, uid) };
  }

  const canonicalRef = db.doc(`festivals/${attendance.festivalId}`);
  const canonical = await db.runTransaction(async (tx) => {
    const snap = await tx.get(canonicalRef);
    if (!snap.exists) refuse(404, 'That festival isn’t there any more.', 'not_found');
    const current = snap.data();
    if (current.createdBy !== uid && !isAdmin) {
      refuse(403, isSeededFestival(current)
        ? 'Festivals from the MySetlists catalog can’t be edited here.'
        : 'Only the person who created this festival can change its details.', 'not_creator');
    }
    // A whole-document set, so a change between dates and year-only drops
    // the old fields; the lineup, seed and creator fields are carried over.
    const next = apply(current);
    tx.set(canonicalRef, next);
    return next;
  });
  return { festival: joinedFestival(attendanceId, attendance, canonical, uid) };
}

const ACTIONS = { create, join, leave, update };

module.exports = { ACTIONS, Refusal, newCanonicalFestival, CREATES_PER_DAY, BATCH_MAX };
