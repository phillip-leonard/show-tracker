// netlify/functions/lib/festivalMatchServer.js — festival matching against
// the shared catalog, on the server (5.60.8, pre-native server moves Part
// 3). The rule is lib/festivalMatch.js; this is what reads the catalog.
//
//   matchFestivalsFor(db, uid, draft)  the create form's "is this one of
//       these?": a bounded candidate set (a name-prefix query and a ±7-day
//       start window, 20 each), festivals the user already joined left
//       out, then findFestivalMatches. Moved from AppContext
//       findFestivalMatchesFor.
//   festivalsForShowFrom(db, show)     which catalog festival a show may
//       belong to (festivalsForShow): festivals starting in the 30 days up
//       to the show's day. normalize-show returns them as a suggestion.

const {
  normalizeFestivalName, findFestivalMatches, festivalsForShow, MAX_FESTIVAL_DAYS,
} = require('../../../lib/festivalMatch');
const { toIsoDate, utcIsoDate } = require('../../../lib/showDate');

const FESTIVAL_CANDIDATE_LIMIT = 20;
const DAY = 86400000;

// The catalog fields the app reads from a festival (the create form's
// match list, joining one): what it read from the documents itself before
// 5.60.8, which every signed-in user may read. No timestamps, so the
// answer is plain JSON.
const PUBLIC_FIELDS = ['name', 'startDate', 'endDate', 'year', 'location', 'edition', 'createdBy', 'source', 'status', 'notes', 'isSeeded'];

function publicFestival(f) {
  const out = { id: f.id };
  for (const k of PUBLIC_FIELDS) if (f[k] !== undefined) out[k] = f[k];
  return out;
}

async function matchFestivalsFor(db, uid, draft) {
  if (!draft || !String(draft.name || '').trim() || (!draft.startDate && !draft.year)) return [];
  const catalog = new Map();
  const collect = (snap) => snap.docs.forEach((d) => catalog.set(d.id, { id: d.id, ...d.data() }));
  const prefix = normalizeFestivalName(draft.name).split(' ')[0] || '';
  const reads = [];
  if (prefix) {
    reads.push(db.collection('festivals').where('nameNormalized', '>=', prefix).where('nameNormalized', '<=', `${prefix}`)
      .limit(FESTIVAL_CANDIDATE_LIMIT).get().then(collect));
  }
  const start = Date.parse(`${draft.startDate}T00:00:00Z`);
  const end = Date.parse(`${draft.endDate || draft.startDate}T00:00:00Z`);
  if (draft.startDate && !Number.isNaN(start) && !Number.isNaN(end)) {
    reads.push(db.collection('festivals').where('startDate', '>=', utcIsoDate(new Date(start - 7 * DAY)))
      .where('startDate', '<=', utcIsoDate(new Date(end + 7 * DAY))).limit(FESTIVAL_CANDIDATE_LIMIT).get().then(collect));
  }
  const joinedSnap = db.collection('users').doc(uid).collection('festivals').get();
  await Promise.all(reads);
  const joined = new Set((await joinedSnap).docs.map((d) => d.data().festivalId).filter(Boolean));
  // The rule's own answer, [{ festival, similarity, sameLocation }], best
  // first, with each festival's public fields.
  return findFestivalMatches(draft, [...catalog.values()].filter((c) => !joined.has(c.id)))
    .map((m) => ({ ...m, festival: publicFestival(m.festival) }));
}

async function festivalsForShowFrom(db, show) {
  const iso = toIsoDate(show && show.date);
  if (!iso) return [];
  const day = Date.parse(`${iso}T00:00:00Z`);
  const snap = await db.collection('festivals')
    .where('startDate', '>=', utcIsoDate(new Date(day - MAX_FESTIVAL_DAYS * DAY)))
    .where('startDate', '<=', iso)
    .limit(50).get();
  const catalog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return festivalsForShow(show, catalog).map(({ festival, why }) => ({ ...publicFestival(festival), why }));
}

module.exports = { matchFestivalsFor, festivalsForShowFrom, publicFestival, FESTIVAL_CANDIDATE_LIMIT };
