/**
 * cityLookup — where a city is, from the same GeoNames list the settings city
 * search uses (public/data/cities.json, scripts/build-city-list.js). For a show
 * a band announced by email that Ticketmaster doesn't list yet.
 *
 * Rows are biggest city first, so with no state to go on the biggest city of
 * that name wins. That can be the wrong Springfield, so with no state the
 * caller should treat the result as a guess only if nothing better exists.
 */

const { normalizeCity } = require('./onsaleAlerts');

let index = null;

function load() {
  if (index) return index;
  index = new Map();
  // eslint-disable-next-line global-require
  require('../../../public/data/cities.json').forEach(([name, region, cc, lat, lng]) => {
    const key = normalizeCity(name);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ region, cc, lat, lng });
  });
  return index;
}

/** { lat, lng } or null. With a state, only a city in that state counts. */
function lookupCity(city, state) {
  const rows = load().get(normalizeCity(city));
  if (!rows) return null;
  const wanted = String(state || '').trim().toUpperCase();
  const row = wanted ? rows.find((r) => r.region === wanted) : rows[0];
  return row ? { lat: row.lat, lng: row.lng } : null;
}

module.exports = { lookupCity };
