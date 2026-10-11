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

export const UPCOMING_COLLECTION = 'upcomingShows';

// Today as YYYY-MM-DD in the device's own time zone. A show "tonight" must
// not flip to past at 5pm Pacific because UTC has rolled over.
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// The day itself still counts as upcoming: "convert to a past show" opens
// the morning after, when there's a setlist to pull.
export function isUpcomingPast(show, today = todayIso()) {
  return !!show?.date && show.date < today;
}

export function sortUpcoming(shows) {
  return [...(shows || [])].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.artist || '').localeCompare(b.artist || ''));
}

// Form/event input -> the fields stored on the document. Everything is
// trimmed and every optional field has an explicit null, so an edit can
// clear a field rather than leaving the old value behind.
export function normalizeUpcomingInput(input = {}) {
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
export function validateUpcomingInput(input, today = todayIso()) {
  const data = normalizeUpcomingInput(input);
  if (!data.artist) return 'Add the artist.';
  if (!data.venue) return 'Add the venue.';
  if (!data.date) return 'Add the date.';
  if (!isValidIsoDate(data.date)) return 'That date doesn’t look right.';
  if (data.date < today) return 'That date has passed. Add it to My Shows instead.';
  return null;
}

// One merged Ticketmaster/SeatGeek event (lib/utils.js mergeTicketEvents)
// -> form input. City and state are joined the way the event card shows them.
export function eventToUpcomingInput(event, artist) {
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
export function upcomingTagShowData(show) {
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
export function upcomingInputFromTag(tag) {
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
export function goingFriends(show, friends, blockedUserIds = []) {
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
export function findSetlistForDate(setlists, isoDate, venue = '') {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-');
  const target = `${d}-${m}-${y}`;
  const sameDay = (setlists || []).filter(s => s?.eventDate === target);
  if (sameDay.length <= 1) return sameDay[0] || null;
  const v = venue.trim().toLowerCase();
  return sameDay.find(s => (s.venue?.name || '').trim().toLowerCase() === v)
    || sameDay.find(s => v && (s.venue?.name || '').toLowerCase().includes(v))
    || sameDay[0];
}

// Upcoming show -> addShow input for the conversion. Tags travel with it;
// the setlist fields come from setlist.fm when a setlist was found.
export function upcomingToShowData(show, setlistShowData = null) {
  const base = {
    artist: show.artist,
    venue: show.venue,
    city: show.city || '',
    date: show.date,
    setlist: [],
  };
  const merged = setlistShowData
    ? { ...base, ...setlistShowData, date: show.date }
    : base;
  if (show.taggedFriendUids?.length) merged.taggedFriendUids = [...show.taggedFriendUids];
  if (show.taggedBy) merged.taggedBy = show.taggedBy;
  if (show.taggedByUid) merged.taggedByUid = show.taggedByUid;
  if (show.notes) merged.comment = show.notes;
  return merged;
}
