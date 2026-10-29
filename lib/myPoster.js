// lib/myPoster.js
//
// A "Songs I've heard" record for any band, from the signed-in user's own
// logged shows and setlists: what /my-poster/?artist=<name> shows
// (components/heard/MyPosterView.jsx) and the record its poster and /p/
// share link are drawn from (netlify/functions/lib/myPosters.js).
//
// The archive-backed bands (lib/heardLinks.js HEARD_BANDS) have the full
// /heard/ tool, which counts against the band's whole history: rarest
// catches, bust-outs, songs still to chase. Here there is no band history,
// only the user's shows, so the record is the part that needs nothing
// else: shows, years, venues, songs, performances, most heard, every song
// heard with its first and last time.
//
// Counting matches Stats → Songs (lib/songCounts.js): one song is one
// songTitleKey, a song played twice at one show is heard once there, and
// "performances" counts every play. One band is one artistNameKeyLoose, so
// "Widespread Panic" and "Widespread Panic (US)" are the same band.
//
// The finished record goes through heardRecord.js's cleanPersonalRecord,
// the same function the server runs on what it's sent, so the poster drawn
// for the page and the one behind a share link can't differ.

import heard from '@/netlify/functions/lib/heardRecord';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { songTitleKey } from '@/lib/songCounts';
import { configBandFor, isoDate } from '@/lib/bandScreens';
import { heardBandFor } from '@/lib/heardLinks';

/** Shows with a setlist a band needs before "Make my poster" appears. */
export const MIN_SHOWS_WITH_SETLIST = 2;

export const ARCHIVE_NOTE = "Rarest catches and bust-outs are available for bands with a full setlist archive: Goose, Phish, Umphrey's McGee and King Gizzard.";

const hasSetlist = (show) => (show?.setlist || []).some((song) => songTitleKey(song?.name));

/** The user's shows of a band, oldest first; undated shows last. */
export function myShowsOf(shows, artist) {
  const key = artistNameKeyLoose(artist);
  if (!key) return [];
  return (shows || [])
    .filter((s) => s && artistNameKeyLoose(s.artist) === key)
    .slice()
    .sort((a, b) => (isoDate(a.date) || '9999').localeCompare(isoDate(b.date) || '9999'));
}

/** True when the band has enough shows with setlists for a poster. */
export function canMakeMyPoster(shows, artist) {
  return myShowsOf(shows, artist).filter(hasSetlist).length >= MIN_SHOWS_WITH_SETLIST;
}

// "Widespread Panic (US)" -> "Widespread Panic": the band's configured
// name when it has a band page, else the spelling the user logs most,
// without setlist.fm's qualifiers.
function bandName(artist, mine) {
  const configured = configBandFor(artist);
  if (configured) return configured.name;
  const spellings = new Map();
  mine.forEach((s) => {
    const name = String(s.artist || '').replace(/\s*[([{][^)\]}]*[)\]}]/g, '').trim();
    if (name) spellings.set(name, (spellings.get(name) || 0) + 1);
  });
  const best = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : String(artist || '').trim();
}

const venueKey = (show) => `${String(show.venue || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(show.city || '').toLowerCase().trim()}`;

/**
 * Everything /my-poster/ shows for one band:
 *   archive   the /heard/ band ({ slug, name }) when the band has one
 *   name      the band's name on the poster
 *   shows     the user's shows of it, oldest first
 *   noSetlist the ones with no setlist yet, to add one
 *   record    the cleaned record (heardRecord.js cleanPersonalRecord), or
 *             null with no shows
 */
export function buildMyPoster(shows, artist) {
  const mine = myShowsOf(shows, artist);
  const name = bandName(artist, mine);
  const archive = heardBandFor(artist) || heardBandFor(name);

  const songs = new Map(); // songTitleKey -> { count, first, last, spellings }
  const venues = new Set();
  const years = new Set();
  let performances = 0;
  let withSetlist = 0;
  const noSetlist = [];
  const dated = [];

  mine.forEach((show) => {
    const date = isoDate(show.date);
    venues.add(venueKey(show));
    if (date) { years.add(date.slice(0, 4)); dated.push({ show, date }); }
    if (!hasSetlist(show)) { noSetlist.push(show); return; }
    withSetlist++;
    const here = new Set();
    (show.setlist || []).forEach((song) => {
      const key = songTitleKey(song?.name);
      if (!key) return;
      performances++;
      const entry = songs.get(key) || { count: 0, first: '', last: '', spellings: new Map() };
      entry.spellings.set(song.name.trim(), (entry.spellings.get(song.name.trim()) || 0) + 1);
      if (!here.has(key)) {
        here.add(key);
        entry.count++;
        if (date && (!entry.first || date < entry.first)) entry.first = date;
        if (date && date > entry.last) entry.last = date;
      }
      songs.set(key, entry);
    });
  });

  const showRef = (d) => (d ? { date: d.date, venue: d.show.venue || '', city: d.show.city || '' } : null);
  const record = heard.cleanPersonalRecord({
    name,
    shows: mine.length,
    showsWithSetlist: withSetlist,
    years: years.size,
    venues: venues.size,
    totalSongs: performances,
    firstShow: showRef(dated[0]),
    lastShow: showRef(dated[dated.length - 1]),
    songs: [...songs.values()].map((e) => ({
      name: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: e.count,
      firstHeard: e.first,
      lastHeard: e.last,
    })),
  });

  return { archive, name, shows: mine, noSetlist, record };
}
