// netlify/functions/lib/heardImport.js
//
// "Import from setlist.fm" on /heard/<slug>/: read a setlist.fm user's
// attended list (GET /1.0/user/{userId}/attended, 20 setlists a page,
// newest first, every artist mixed together) and tick the band's shows it
// names. heard-import.js does the fetching; this is the matching, kept
// apart so the tests can run it without the network.
//
// A setlist is the band's when its artist mbid is the band's setlistfmMbid
// (config/public-artists.json). The name alone won't do: setlist.fm has a
// Belgian GOOSE as well as ours. It is matched to an archive show by date,
// and between two shows on one date (an early and a late show) by venue.
// setlist.fm and the archives sometimes disagree by a day about a show that
// ran past midnight, so a miss on the date tries the day either side at the
// same venue before giving up. Anything still unmatched is reported back,
// not dropped.

const { isoDate } = require('./publicPageHtml');
const { decodeEntities } = require('./publicArtistSources');

const squash = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

function venueMatches(a, b) {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function shiftDay(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * @param shows    the band's show list (buildShowList shape)
 * @param setlists setlist.fm setlist objects from /user/{id}/attended
 * @param mbid     the band's setlist.fm mbid
 * @returns { ids, unmatched: [{ date, venue, city }], attended }
 */
function matchAttended(shows, setlists, mbid) {
  const byDate = new Map();
  for (const show of shows.shows) {
    if (!byDate.has(show.date)) byDate.set(show.date, []);
    byDate.get(show.date).push(show);
  }
  const venueName = (show) => (shows.venues[show.venue] || [''])[0];

  const ids = [];
  const unmatched = [];
  const seen = new Set();
  // setlist.fm can hold the same night twice (two users entering it); one
  // night is one show attended.
  const nights = new Set();

  for (const sl of setlists) {
    if (!sl || !sl.artist || sl.artist.mbid !== mbid) continue;
    const date = isoDate(sl.eventDate);
    if (!date) continue;
    const venue = decodeEntities(sl.venue && sl.venue.name);
    const night = `${date}|${squash(venue)}`;
    if (nights.has(night)) continue;
    nights.add(night);
    const sameDay = byDate.get(date) || [];
    let match = sameDay.length === 1 ? sameDay[0] : sameDay.find((s) => venueMatches(venueName(s), venue));
    if (!match && sameDay.length > 1) match = sameDay[0];
    if (!match) {
      const near = [...(byDate.get(shiftDay(date, -1)) || []), ...(byDate.get(shiftDay(date, 1)) || [])];
      match = near.find((s) => venueMatches(venueName(s), venue));
    }
    if (match) {
      if (!seen.has(match.id)) { seen.add(match.id); ids.push(match.id); }
    } else {
      unmatched.push({ date, venue, city: decodeEntities(sl.venue && sl.venue.city && sl.venue.city.name) });
    }
  }
  return { ids, unmatched, attended: nights.size };
}

module.exports = { matchAttended, venueMatches };
