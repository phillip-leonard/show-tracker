// lib/reliveThisNight.js
//
// "Relive this night's magic": the show from today's month and day in an
// earlier year, offered at the top of My Shows
// (components/shows/ReliveThisNightCard.jsx).
//
// Two rules this file keeps, as lib/anniversaries.js does since 5.47.12
// (it got both wrong before):
//
// - "Today" is the device's local calendar date. new Date().toISOString()
//   is the UTC date, which on a US evening is already tomorrow.
// - A show's date is read through toIsoDate (lib/utils.js), never sliced.
//   Shows added by the ticket scanner store "23-10-2019", where
//   .slice(5, 10) reads "10-20".

import { localIsoDate, toIsoDate } from '@/lib/utils';
import { STORAGE_KEYS, storage } from '@/lib/storage';

// The most recent show on today's month and day from an earlier year, or
// null. Shows from the current year are not history yet. A Feb 29 show
// matches only on Feb 29: there is no Feb 28 stand-in.
export function pickReliveShow(shows = [], now = new Date()) {
  const today = localIsoDate(now);
  const year = today.slice(0, 4);
  const monthDay = today.slice(5);

  let best = null;
  let bestDate = '';
  for (const show of shows) {
    const iso = toIsoDate(show?.date);
    if (!iso || iso.slice(5) !== monthDay || iso.slice(0, 4) >= year) continue;
    if (iso > bestDate) {
      best = show;
      bestDate = iso;
    }
  }
  return best;
}

// ── Once a day, per user, per device ──────────────────────────────────
//
// localStorage holds the local date the card was last shown to this user.
// The first load of a day shows the card and writes the date; a reload
// later that day finds the date and shows nothing. Within one page load
// the decision is kept below, so leaving for the show detail screen and
// coming back finds the card still there, until it is dismissed.
//
// With storage unavailable the read finds nothing and the write is
// dropped (lib/storage.js), so the card shows on every load that day.
// That is the safe direction to fail.

let session = null; // { uid, date, showId, dismissed }

function seenKey(uid) {
  return `${STORAGE_KEYS.RELIVE_THIS_NIGHT_PREFIX}${uid}`;
}

// The show to offer this user right now, or null. Call only once the
// user's own shows have loaded: the first call of the day settles it.
export function reliveShowFor(uid, shows, now = new Date()) {
  if (!uid) return null;
  const today = localIsoDate(now);

  if (!session || session.uid !== uid || session.date !== today) {
    let showId = null;
    if (storage.get(seenKey(uid)) !== today) {
      const show = pickReliveShow(shows, now);
      if (show) {
        showId = show.id;
        storage.set(seenKey(uid), today);
      }
    }
    session = { uid, date: today, showId, dismissed: false };
  }

  if (session.dismissed || !session.showId) return null;
  // Deleted since: nothing to offer.
  return shows.find(s => s.id === session.showId) || null;
}

export function dismissReliveShow() {
  if (session) session.dismissed = true;
}

// Tests only.
export function resetReliveSession() {
  session = null;
}
