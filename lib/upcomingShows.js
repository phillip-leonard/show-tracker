// lib/upcomingShows.js
//
// Pure helpers for upcoming shows: shows the user is going to rather than
// shows they've been to. Firestore reads and writes live in AppContext next
// to the rest of the show CRUD. This file is only shapes and rules, so it
// can be unit tested without Firebase (lib/__tests__/upcomingShows.test.js).
//
// ── WHERE THEY LIVE ────────────────────────────────────────────────────
//
// `users/{uid}/upcomingShows/{id}`, owner-only (see firestore.rules).
// NOT `users/{uid}/shows` with a status flag. That collection is read by
// every stat, song count, tour, run, festival, year-in-review, public
// profile, rank and anniversary email in the app, client and server. An
// upcoming show stored there would count in all of them until each one
// learned to skip it. In a collection of its own, nothing counts it by
// accident.
//
// Document shape:
//   { artist, venue, city, date (YYYY-MM-DD), time|null, notes,
//     source: 'ticketmaster'|'seatgeek'|'manual', sourceEventId|null,
//     ticketUrl|null, taggedFriendUids: [],
//     taggedBy|null, taggedByUid|null,   // set when accepted from a tag
//     originUpcomingId|null,             // the tagger's own upcoming doc
//     createdAt, updatedAt }
//
// ── TAGS ───────────────────────────────────────────────────────────────
//
// Friends are tagged through the same `showTags` collection as past shows.
// The tag's showData carries `upcoming: true` and the tag carries
// `upcomingShowId` (the tagger's doc). Accepting one adds the show to the
// friend's own upcoming list rather than their history. Status
// `'revoked'` means the tagger removed them (or blocked them, or deleted
// the show) before they answered.

// CommonJS (5.60.29): the server's tag actions (netlify/functions/
// friends.js) build tags and accept upcoming ones with the same rules.
const { today: localToday, toIsoDate, compareShowDates, fromSetlistfmDate } = require('./showDate');
const { upcomingToShowData } = require('./showInputs');

const UPCOMING_COLLECTION = 'upcomingShows';

// Today as YYYY-MM-DD in the device's own time zone. A show "tonight" must
// not flip to past at 5pm Pacific because UTC has rolled over.
function todayIso(now = new Date()) {
  return localToday(now);
}

function isValidIsoDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && toIsoDate(date) === date;
}

// The day itself still counts as upcoming: "convert to a past show" opens
// the morning after, when there's a setlist to pull.
function isUpcomingPast(show, today = todayIso()) {
  const date = toIsoDate(show?.date);
  return !!date && date < today;
}

function sortUpcoming(shows) {
  return [...(shows || [])].sort((a, b) =>
    compareShowDates(a.date, b.date) || (a.artist || '').localeCompare(b.artist || ''));
}

// Form/event input -> the fields stored on the document. Everything is
// trimmed and every optional field has an explicit null, so an edit can
// clear a field rather than leaving the old value behind.
function normalizeUpcomingInput(input = {}) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    artist: str(input.artist),
    venue: str(input.venue),
    city: str(input.city),
    date: str(input.date),
    time: str(input.time) || null,
    notes: str(input.notes).slice(0, 1000),
    source: ['ticketmaster', 'seatgeek'].includes(input.source) ? input.source : 'manual',
    sourceEventId: input.sourceEventId || null,
    ticketUrl: input.ticketUrl || null,
  };
}

// What's missing before an upcoming show can be saved, as a message the
// form can show, or null when it's complete. A past date is refused: that
// show belongs in My Shows, through the normal add.
function validateUpcomingInput(input, today = todayIso()) {
  const data = normalizeUpcomingInput(input);
  if (!data.artist) return 'Add the artist.';
  if (!data.venue) return 'Add the venue.';
  if (!data.date) return 'Add the date.';
  if (!isValidIsoDate(data.date)) return 'That date doesn’t look right.';
  if (data.date < today) return 'That date has passed. Add it to My Shows instead.';
  return null;
}

// ── The documents (5.60.22) ──────────────────────────────────────────
// What AppContext writes, as pure functions, so fixtures/upcoming-shows/
// pins the shape for the native app, which writes the same documents
// directly (docs/ios-native/DECISIONS.md, "Stage 1"). `now` is the
// timestamp to store: serverTimestamp() in the app, a placeholder in tests.

// A new upcoming show: the normalized fields, nobody tagged yet, and the
// tag credit when it came from accepting a friend's tag.
function newUpcomingRecord(input, extra = {}, now = null) {
  return {
    ...normalizeUpcomingInput(input),
    taggedFriendUids: [],
    taggedBy: extra.taggedBy || null,
    taggedByUid: extra.taggedByUid || null,
    originUpcomingId: extra.originUpcomingId || null,
    createdAt: now,
    updatedAt: now,
  };
}

// An edit: every normalized field (so a cleared field is written as cleared)
// and updatedAt. Tags, the tag credit and createdAt are left as stored.
function upcomingUpdate(input, now = null) {
  return { ...normalizeUpcomingInput(input), updatedAt: now };
}

// The upcoming show already on the list for the same band on the same day
// (band compared trimmed and case-insensitively), or null. Adding it again
// opens that one instead.
function findDuplicateUpcoming(upcomingShows, input) {
  const data = normalizeUpcomingInput(input);
  const band = data.artist.toLowerCase();
  return (upcomingShows || []).find(u =>
    (u.artist || '').trim().toLowerCase() === band && u.date === data.date
  ) || null;
}

// One merged Ticketmaster/SeatGeek event (lib/utils.js mergeTicketEvents)
// -> form input. City and state are joined the way the event card shows them.
function eventToUpcomingInput(event, artist) {
  if (!event) return normalizeUpcomingInput({ artist });
  const fromTm = String(event.id || '').startsWith('tm_');
  return normalizeUpcomingInput({
    artist,
    venue: event.venue || '',
    city: [event.city, event.state].filter(Boolean).join(', '),
    date: event.date || '',
    time: event.time || '',
    source: fromTm ? 'ticketmaster' : 'seatgeek',
    sourceEventId: event.id || null,
    ticketUrl: event.tmUrl || event.sgUrl || null,
  });
}

// The copy of the show a tag carries. Same idea as sanitizeShowForTag in
// AppContext for past shows: event facts only, never the tagger's notes.
function upcomingTagShowData(show) {
  return {
    artist: show.artist || '',
    venue: show.venue || '',
    date: show.date || '',
    city: show.city || '',
    time: show.time || null,
    ticketUrl: show.ticketUrl || null,
    upcoming: true,
  };
}

// Accepting an upcoming tag -> the fields for the friend's own copy.
function upcomingInputFromTag(tag) {
  const data = tag?.showData || {};
  return {
    ...normalizeUpcomingInput({
      artist: data.artist,
      venue: data.venue,
      city: data.city,
      date: data.date,
      time: data.time || '',
      ticketUrl: data.ticketUrl || null,
    }),
    taggedBy: tag?.fromName || null,
    taggedByUid: tag?.fromUid || null,
    originUpcomingId: tag?.upcomingShowId || null,
  };
}

// Who's going, as friend records. Blocked accounts never appear, whether
// the friend list still holds them or not.
function goingFriends(show, friends, blockedUserIds = []) {
  const blocked = new Set(blockedUserIds || []);
  const byUid = new Map((friends || []).map(f => [f.friendUid, f]));
  return (show?.taggedFriendUids || [])
    .filter(uid => !blocked.has(uid))
    .map(uid => byUid.get(uid))
    .filter(Boolean);
}

// Converting to a past show: the setlist.fm setlist for this date, from an
// artist + year search. setlist.fm dates are DD-MM-YYYY. When an artist
// played twice that day (rare: matinee + evening, or a festival and an
// aftershow) prefer the one at the same venue.
function findSetlistForDate(setlists, isoDate, venue = '') {
  if (!isoDate) return null;
  const target = toIsoDate(isoDate);
  const sameDay = (setlists || []).filter(s => target && fromSetlistfmDate(s?.eventDate) === target);
  if (sameDay.length <= 1) return sameDay[0] || null;
  const v = venue.trim().toLowerCase();
  return sameDay.find(s => (s.venue?.name || '').trim().toLowerCase() === v)
    || sameDay.find(s => v && (s.venue?.name || '').toLowerCase().includes(v))
    || sameDay[0];
}

// Upcoming show -> addShow input for the conversion. Tags travel with it;
// the setlist fields come from setlist.fm when a setlist was found.
// Moved to lib/showInputs.js (CommonJS, 5.60.5), where the server's
// normalize-show builds the same show from an upcoming one.

module.exports = {
  UPCOMING_COLLECTION,
  todayIso,
  isValidIsoDate,
  isUpcomingPast,
  sortUpcoming,
  normalizeUpcomingInput,
  validateUpcomingInput,
  newUpcomingRecord,
  upcomingUpdate,
  findDuplicateUpcoming,
  eventToUpcomingInput,
  upcomingTagShowData,
  upcomingInputFromTag,
  goingFriends,
  findSetlistForDate,
  upcomingToShowData,
};
