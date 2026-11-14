/**
 * showIdentity — when two show records are the same night (5.59.10).
 *
 * Used by the duplicate check (findDuplicateShow, every add path including
 * festival imports and the guest merge), Shows Together and show
 * suggestions, and the setlist scan. Dates are compared as calendar days
 * through lib/showDate.js, so "28-05-2025" and "2025-05-28" are the same
 * night (B-07, B-08) whatever format each document was stored in.
 */

import { toIsoDate, fromSetlistfmDate } from '@/lib/showDate';

const norm = (v) => String(v || '').trim().toLowerCase();

/** Same artist, same venue, same day: the duplicate rule. */
export function isSameShow(a, b) {
  if (!a || !b || !a.artist || !a.date || !b.artist || !b.date) return false;
  const day = toIsoDate(a.date);
  return !!day
    && norm(a.artist) === norm(b.artist)
    && norm(a.venue) === norm(b.venue)
    && day === toIsoDate(b.date);
}

/** The existing show `candidate` duplicates, or null. */
export function findDuplicate(shows, candidate) {
  if (!candidate?.artist || !candidate?.date) return null;
  return (shows || []).find((s) => isSameShow(s, candidate)) || null;
}

/**
 * The key two friends' shows match on for Shows Together and suggestions:
 * the setlist.fm id when there is one, otherwise artist|venue|day.
 */
export function showMatchKey(show) {
  if (show?.setlistfmId) return show.setlistfmId;
  const day = toIsoDate(show?.date) || norm(show?.date);
  return `${norm(show?.artist)}|${norm(show?.venue)}|${day}`;
}

/** A setlist.fm result's eventDate (DD-MM-YYYY) is this show's day. */
export function setlistIsOnShowDate(eventDate, showDate) {
  const day = toIsoDate(showDate);
  return !!day && fromSetlistfmDate(eventDate) === day;
}
