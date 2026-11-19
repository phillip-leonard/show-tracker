// lib/festivalCatalog.js
//
// Festivals that came from the MySetlists catalog rather than from a user,
// and the joined festival every screen reads.
//
// The seeder (netlify/functions/admin-seed-festivals.js, document shape in
// netlify/functions/lib/festivalSeed.js) writes ordinary canonical
// festivals with createdBy "system:seed" and source "seed". Nobody created
// them, so the creator-only edit rule leaves them editable by the admin
// alone, and the UI says so in place of "someone else created this".
//
// Two seed fields reach the screen, renamed on the way:
//   status "cut_short" → catalogStatus, a small note on the festival header.
//   notes             → catalogNote. Renamed because a user's own notes are
//                       `notes` on their attendance record, and the joined
//                       festival object carries both.
//
// CommonJS since 5.60.36 (Stage 5): netlify/functions/festivals.js answers
// with joinedFestival, the web's loadFestivals builds the same object, and
// the native app's copy is checked against fixtures/festivals/joined.json.

const SEED_SOURCE = 'seed';

/** True for a canonical festival document (or a joined festival) from the catalog. */
function isSeededFestival(festival) {
  return !!festival && (festival.source === SEED_SOURCE || festival.isSeeded === true);
}

/**
 * The catalog fields copied from a canonical document onto the joined
 * festival. Empty-ish for a user-created festival.
 */
function catalogFields(canonical) {
  return {
    isSeeded: !!canonical && canonical.source === SEED_SOURCE,
    catalogStatus: (canonical && canonical.status) || null,
    catalogNote: (canonical && canonical.notes) || null,
  };
}

function isCutShort(festival) {
  return !!festival && festival.catalogStatus === 'cut_short';
}

const PERSONAL = ['notes', 'rating', 'myLineup'];

/**
 * One festival as the screens read it: the caller's attendance record
 * (users/{uid}/festivals/{attendanceId}) joined to the canonical festival
 * it points at. The canonical document wins on name, dates and location;
 * the attendance record keeps notes, rating and the typed lineup.
 *
 *   canonical undefined   a record from before 5.30.0: it holds its own
 *                         name and dates (`unmigrated`, the owner edits it)
 *   canonical null        the canonical can't be read (`unavailable`)
 *
 * Timestamps are left out, so the object is plain JSON.
 */
function joinedFestival(attendanceId, attendance = {}, canonical, uid) {
  const a = attendance || {};
  const personal = {};
  for (const k of PERSONAL) personal[k] = k === 'myLineup' ? (Array.isArray(a.myLineup) ? a.myLineup : []) : (a[k] ?? (k === 'notes' ? '' : null));
  const when = (src) => {
    const out = {};
    if (src.startDate) { out.startDate = src.startDate; out.endDate = src.endDate || src.startDate; }
    if (Number.isInteger(src.year)) out.year = src.year;
    return out;
  };

  if (!a.festivalId) {
    return {
      id: attendanceId, festivalId: null, name: a.name || 'Untitled festival', ...when(a),
      location: a.location || '', edition: a.edition || '',
      isCreator: true, unmigrated: true, ...catalogFields(null), ...personal,
      lineup: [], lineupSource: null, lineupUrl: null,
    };
  }
  if (!canonical) {
    return {
      id: attendanceId, festivalId: a.festivalId, name: a.name || 'Unavailable festival',
      location: '', edition: '', isCreator: false, unavailable: true, ...catalogFields(null), ...personal,
      lineup: [], lineupSource: null, lineupUrl: null,
    };
  }
  return {
    id: attendanceId,
    festivalId: a.festivalId,
    name: canonical.name || '',
    ...when(canonical),
    location: canonical.location || '',
    edition: canonical.edition || '',
    isCreator: !!uid && canonical.createdBy === uid,
    ...catalogFields(canonical),
    ...personal,
    lineup: Array.isArray(canonical.lineup) ? canonical.lineup : [],
    lineupSource: canonical.lineupSource || null,
    lineupUrl: canonical.lineupUrl || null,
  };
}

module.exports = { SEED_SOURCE, isSeededFestival, catalogFields, isCutShort, joinedFestival };
