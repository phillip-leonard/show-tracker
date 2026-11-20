// lib/publicBands.js
//
// The configured public bands (config/public-artists.json) and the ones
// with the "Songs I've heard" tool, looked up by artist name. CommonJS, no
// `@/` imports, so the functions can require it (my-poster, year-recap);
// lib/bandScreens.js and lib/heardLinks.js re-export these for the app.
//
// One band is one artistNameKeyLoose: "Goose" and "goose (US)" are the
// same band.

const publicArtists = require('../config/public-artists.json');
const { artistNameKeyLoose } = require('./setlistSources');

/** Every configured public band: { slug, name, source, songPages, key }. */
const PUBLIC_BANDS = publicArtists.artists.map((a) => ({
  slug: a.slug,
  name: a.name,
  source: a.source,
  songPages: !!a.songPages,
  key: artistNameKeyLoose(a.name),
}));

/** The configured band for an artist name ("Goose", "goose (US)"), or null. */
function configBandFor(artistName) {
  const key = artistNameKeyLoose(artistName);
  return (key && PUBLIC_BANDS.find((b) => b.key === key)) || null;
}

function configBandBySlug(slug) {
  return PUBLIC_BANDS.find((b) => b.slug === slug) || null;
}

// Only the archive-backed bands have the tool: the same rule as
// HEARD_SOURCES in netlify/functions/lib/publicArtistSnapshot.js.
const HEARD_BANDS = publicArtists.artists
  .filter((a) => a.songPages && (a.source === 'songfish' || a.source === 'phishnet'))
  .map((a) => ({ slug: a.slug, name: a.name, key: artistNameKeyLoose(a.name) }));

/** The tool's band for an artist name, or null. */
function heardBandFor(artist) {
  const key = artistNameKeyLoose(artist);
  return (key && HEARD_BANDS.find((b) => b.key === key)) || null;
}

/** The user's shows per tool band, most shows first: [{ slug, name, shows: [{ date, venue }] }]. */
function heardBandsFor(shows = []) {
  const byKey = new Map(HEARD_BANDS.map((b) => [b.key, { slug: b.slug, name: b.name, shows: [] }]));
  for (const show of shows) {
    const band = show && byKey.get(artistNameKeyLoose(show.artist));
    if (band && /^\d{4}-\d{2}-\d{2}$/.test(show.date || '')) band.shows.push({ date: show.date, venue: show.venue || '' });
  }
  return [...byKey.values()].filter((b) => b.shows.length).sort((a, b) => b.shows.length - a.shows.length);
}

module.exports = { PUBLIC_BANDS, configBandFor, configBandBySlug, HEARD_BANDS, heardBandFor, heardBandsFor };
