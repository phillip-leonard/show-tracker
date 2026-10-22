/**
 * netlify/functions/lib/songfishSites.js
 *
 * The server's view of config/songfish-sites.json: which Songfish archives
 * /api/band-setlist may call, and which of a site's artists a request means.
 *
 * Only ENABLED sites come out of here. band-setlist.js builds its adapter
 * list from enabledSites(), so a disabled site has no adapter, a request
 * naming it gets the same 400 as any unknown source, and nothing ever
 * reaches its host. The client registry (lib/setlistSources.js) applies the
 * same rule, so it never asks in the first place.
 */

const config = require('../../../config/songfish-sites.json');

// The same normalization as lib/setlistSources.js's artistNameKey and
// artistNameKeyLoose (that file is ESM and imports lib/wishlist.js, so it
// can't be required from a function). Kept in step by
// lib/__tests__/songfishAdapter.test.js.
function artistNameKey(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

function artistNameKeyLoose(name) {
  const stripped = String(name == null ? '' : name)
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .trim()
    .replace(/^the\s+/i, '');
  return artistNameKey(stripped);
}

function hostnameOf(baseUrl) {
  return new URL(baseUrl).hostname;
}

const SITES = config.sites.map((site) => ({
  ...site,
  hostname: hostnameOf(site.baseUrl),
  // Songfish permalinks are bare filenames under /setlists/ on every site
  // checked (elgoose.net, ttbase.net, kglw.net).
  permalinkBase: `${site.baseUrl.replace(/\/+$/, '')}/setlists/`,
}));

function enabledSites() {
  return SITES.filter((site) => site.enabled === true);
}

// Enabled sites only. A disabled site is indistinguishable from one that
// doesn't exist, which is the point.
function siteById(id) {
  return enabledSites().find((site) => site.id === id) || null;
}

/**
 * artistIdFor(site, { artist, artistId }) -> number | null
 *
 * The site's numeric artist_id for this request. The client sends the
 * registry's id as `artistId`; installed app versions from before 5.47.4
 * send 'goose' there instead, so a value that isn't one of the site's ids
 * falls back to matching the artist name. Null when neither identifies an
 * artist mapped on this site: the caller then asks the archive nothing.
 */
function artistIdFor(site, { artist, artistId } = {}) {
  if (!site) return null;
  const hinted = Number(artistId);
  if (String(artistId == null ? '' : artistId).trim() && Number.isInteger(hinted)) {
    const match = site.artists.find((a) => a.artistId === hinted);
    if (match) return match.artistId;
  }

  const exact = artistNameKey(artist);
  const loose = artistNameKeyLoose(artist);
  if (!exact && !loose) return null;
  for (const a of site.artists) {
    const keys = [a.name, ...(a.aliases || [])].map(artistNameKey);
    if (keys.includes(exact) || keys.includes(loose)) return a.artistId;
  }
  return null;
}

module.exports = { SITES, enabledSites, siteById, artistIdFor, artistNameKey, artistNameKeyLoose };
