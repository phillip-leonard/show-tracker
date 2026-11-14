// lib/stats/keys.js — the identity keys the stats count by (5.59.15).
//
// CommonJS twins of the app's ESM originals, so the Netlify functions can
// use them without pulling config files into the browser bundle:
//   songKey   = lib/songCounts.js songTitleKey (normalizeSongTitle in
//               lib/utils.js, else the trimmed title)
//   bandKey   = lib/setlistSources.js artistNameKeyLoose
// lib/__tests__/stats.test.js fails if either drifts from its original.

/** One song: "Ashes//Dust" and "Ashes // Dust" are the same; "(Live)" and remaster tags dropped. */
function normalizeSongTitle(title) {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .replace(/[-–—]\s*(live|remaster(ed)?( \d{4})?|mono|stereo|single|album)( version)?\s*$/i, '')
    .replace(/\(\s*(live|remaster(ed)?( \d{4})?|mono|stereo|single|album)( version)?\s*\)\s*$/i, '')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function songKey(name) {
  const raw = String(name == null ? '' : name).trim();
  return normalizeSongTitle(raw) || raw;
}

function artistNameKey(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

/** One band: "Goose" and "goose (US)", "The Band" and "Band" are the same. */
function bandKey(name) {
  const stripped = String(name == null ? '' : name)
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .trim()
    .replace(/^the\s+/i, '');
  return artistNameKey(stripped);
}

module.exports = { songKey, bandKey, normalizeSongTitle, artistNameKey };
