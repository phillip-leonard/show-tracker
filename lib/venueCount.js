// lib/venueCount.js — what "a venue" is when the app counts venues (B-04,
// 5.59.10).
//
// CommonJS on purpose, like lib/recommendations.js: the app imports it
// through webpack and a server function can require it, so there is one
// definition.
//
// THE DEFINITION. Shows carry no venue id, only the `venue` and `city`
// text the user (or setlist.fm) wrote. Two shows are at the same venue
// when their names match and their cities match, each compared trimmed,
// lowercased and with runs of whitespace collapsed:
//
//   "Red Rocks Amphitheatre", "Morrison"   ┐ one venue
//   "red rocks  amphitheatre ", "morrison" ┘
//   "The Fillmore", "San Francisco"        ┐ two venues: a name alone is
//   "The Fillmore", "Denver"               ┘ not a venue
//
// A show with no venue name isn't counted. Punctuation is NOT stripped
// ("Terminal 5" and "Terminal-5" stay two), so a key never merges venues
// whose names differ.
//
// Before 5.59.10 the screens disagreed: My Shows, Profile and the Stats
// header counted distinct names as typed (case-sensitive, ignoring city);
// the Stats venue list and song history used "venue, city" as typed; Year
// in Review used this rule without collapsing whitespace; My poster
// stripped punctuation.
//
// NOT changed here: userProfiles.venueCount (the leaderboard) still uses
// the old name-only count until the server-side stats PR (B-05), and
// venueRatings / venue pages keep their stored key (venueKeyFor in
// lib/venues.js, normalizeVenueKey in AppContext), which existing
// documents are keyed by. The poster's server-side count
// (netlify/functions/lib/heardRecord.js) counts the source archive's own
// venue ids, which are real ids, and stays as it is.

function venuePart(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The venue a show was at, as a comparable key, or null when it has no venue name. */
function venueCountKey(show) {
  const name = venuePart(show && show.venue);
  return name ? `${name}::${venuePart(show && show.city)}` : null;
}

/** How many venues these shows were at. */
function countVenues(shows) {
  const keys = new Set();
  for (const show of shows || []) {
    const key = venueCountKey(show);
    if (key) keys.add(key);
  }
  return keys.size;
}

module.exports = { venueCountKey, countVenues, venuePart };
