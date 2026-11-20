// lib/yearRecapRarity.js
//
// The recap's "Rarest catch" and "Bust-outs witnessed", for the bands with
// a full setlist archive (lib/heardLinks.js HEARD_BANDS: Goose, Phish,
// Umphrey's McGee, King Gizzard). The arithmetic is the "Songs I've heard"
// tool's own, heardRecord.js's matchLoggedShows + buildRecord, run on just
// the year's shows, so a rarest catch here is the one /heard/ would show
// for the same nights.
//
// Each band's show list is the /api/artist-shows JSON, which the caller
// loads: netlify/functions/year-recap.js reads it from the band-page
// snapshot in-process (Stage 6, call D), and the web and the native app ask
// year-recap. A band whose list can't be loaded is left out rather than
// failing the section: the page hides the section when nothing comes back,
// and never shows a zero.
//
// Across bands:
//   rarest catch  the song the band has played the fewest times ever,
//                 ties to the more recent show
//   bust-outs     every bust-out witnessed (a gap of BUST_OUT_MIN_GAP+
//                 shows), biggest gap first
//
// CommonJS, no `@/` imports, so the function can require it.

const heard = require('../netlify/functions/lib/heardRecord');
const { heardBandsFor } = require('./publicBands');
const { toIsoDate, compareShowDates } = require('./showDate');

const MAX_BUST_OUTS = 5;

/** The year's shows per archive band: [{ slug, name, shows: [{ date, venue }] }]. */
function archiveBandsFor(yearShows) {
  const dated = (yearShows || []).map((s) => ({ ...s, date: toIsoDate(s.date) || s.date }));
  return heardBandsFor(dated);
}

/**
 * Pure: the rarity sections from loaded band archives.
 * @param loaded [{ band: { slug, name, shows }, data }] — data is /api/artist-shows JSON
 * @returns { rarest, bustOuts } — rarest null and bustOuts [] when there's nothing
 */
function rarityFrom(loaded) {
  let rarest = null;
  const bustOuts = [];
  (loaded || []).forEach(({ band, data }) => {
    if (!data || !Array.isArray(data.shows)) return;
    const { ids } = heard.matchLoggedShows(data, band.shows);
    if (!ids.length) return;
    const record = heard.buildRecord(data, ids);
    const pick = (s) => ({
      band: band.name,
      slug: band.slug,
      name: s.name,
      timesPlayed: s.timesPlayed,
      ...(s.gap != null ? { gap: s.gap } : {}),
    });
    // buildRecord's `rarest` is songs, without the show they were heard
    // at; the show is the last time the user heard it.
    const top = record.rarest[0];
    if (top && top.timesPlayed > 0) {
      const candidate = { ...pick(top), date: top.lastHeard };
      if (!rarest || candidate.timesPlayed < rarest.timesPlayed
        || (candidate.timesPlayed === rarest.timesPlayed && candidate.date > rarest.date)) {
        rarest = candidate;
      }
    }
    record.bustOuts.forEach((b) => bustOuts.push({ ...pick(b), date: b.show.date, venue: b.show.venue }));
  });
  bustOuts.sort((a, b) => b.gap - a.gap || compareShowDates(b.date, a.date) || a.name.localeCompare(b.name));
  return { rarest, bustOuts: bustOuts.slice(0, MAX_BUST_OUTS) };
}

/**
 * Loads the archives the year needs with `load(slug)` (the band's
 * /api/artist-shows JSON, or null) and resolves rarityFrom()'s result.
 */
async function loadYearRarity(yearShows, load) {
  const bands = archiveBandsFor(yearShows);
  if (!bands.length) return { rarest: null, bustOuts: [] };
  const loaded = await Promise.all(bands.map(async (band) => {
    const data = await load(band.slug);
    return data ? { band, data } : null;
  }));
  return rarityFrom(loaded.filter(Boolean));
}

module.exports = { MAX_BUST_OUTS, archiveBandsFor, rarityFrom, loadYearRarity };
