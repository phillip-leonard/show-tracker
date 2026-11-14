/**
 * showIdentity — when two show records are the same night (5.59.10).
 *
 * Used by the duplicate check (findDuplicateShow, every add path including
 * festival imports and the guest merge), Shows Together and show
 * suggestions, and the setlist scan. Dates are compared as calendar days
 * through lib/showDate.js, so "28-05-2025" and "2025-05-28" are the same
 * night (B-07, B-08) whatever format each document was stored in.
 */

// CommonJS since 5.60.5, shared with the server's normalize-show, which
// returns classifyDuplicate's answer for every show it builds.

const { toIsoDate, fromSetlistfmDate } = require('./showDate');

const norm = (v) => String(v || '').trim().toLowerCase();

/** Same artist, same venue, same day: the duplicate rule. */
function isSameShow(a, b) {
  if (!a || !b || !a.artist || !a.date || !b.artist || !b.date) return false;
  const day = toIsoDate(a.date);
  return !!day
    && norm(a.artist) === norm(b.artist)
    && norm(a.venue) === norm(b.venue)
    && day === toIsoDate(b.date);
}

/** The existing show `candidate` duplicates, or null. */
function findDuplicate(shows, candidate) {
  if (!candidate?.artist || !candidate?.date) return null;
  return (shows || []).find((s) => isSameShow(s, candidate)) || null;
}

/**
 * The key two friends' shows match on for Shows Together and suggestions:
 * the setlist.fm id when there is one, otherwise artist|venue|day.
 */
function showMatchKey(show) {
  if (show?.setlistfmId) return show.setlistfmId;
  const day = toIsoDate(show?.date) || norm(show?.date);
  return `${norm(show?.artist)}|${norm(show?.venue)}|${day}`;
}

/** A setlist.fm result's eventDate (DD-MM-YYYY) is this show's day. */
function setlistIsOnShowDate(eventDate, showDate) {
  const day = toIsoDate(showDate);
  return !!day && fromSetlistfmDate(eventDate) === day;
}

// ── Venue names ───────────────────────────────────────────────────────
// Case, punctuation and spacing don't make a different venue ("Dick's
// Sporting Goods Park" / "Dicks Sporting Goods Park"). Moved here from
// lib/utils.js (which re-exports both) so the server shares them.

function normalizeVenueName(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** One name contains the other once normalized: a likely match, not a certain one. */
function venuesFuzzyMatch(a, b) {
  const na = normalizeVenueName(a);
  const nb = normalizeVenueName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * classifyDuplicate(shows, candidate) -> { show, rule } | null
 *
 * The one duplicate rule (5.60.5, pre-native server moves decision 3),
 * from most to least certain:
 *   'setlistfm-id'  the same setlist.fm setlist
 *   'same-show'     same artist and calendar day, and the same venue once
 *                   case, punctuation and spacing are ignored
 *   'possible'      same artist and day, venue spelled differently or
 *                   missing: probably the same night, possibly two sets in
 *                   one day. Only ever a question for the user; nothing
 *                   is merged or skipped on it.
 * A candidate with an `id` never matches itself.
 */
function classifyDuplicate(shows, candidate) {
  if (!candidate) return null;
  const others = (shows || []).filter((s) => s && (!candidate.id || s.id !== candidate.id));

  if (candidate.setlistfmId) {
    const byId = others.find((s) => s.setlistfmId && String(s.setlistfmId) === String(candidate.setlistfmId));
    if (byId) return { show: byId, rule: 'setlistfm-id' };
  }

  const day = toIsoDate(candidate.date);
  const artist = norm(candidate.artist);
  if (!day || !artist) return null;
  const sameNight = others.filter((s) => norm(s.artist) === artist && toIsoDate(s.date) === day);
  if (!sameNight.length) return null;

  const venue = normalizeVenueName(candidate.venue);
  const same = venue && sameNight.find((s) => normalizeVenueName(s.venue) === venue);
  if (same) return { show: same, rule: 'same-show' };
  return { show: sameNight[0], rule: 'possible' };
}

module.exports = {
  isSameShow, findDuplicate, showMatchKey, setlistIsOnShowDate,
  normalizeVenueName, venuesFuzzyMatch, classifyDuplicate,
};
