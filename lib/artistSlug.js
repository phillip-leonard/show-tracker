// lib/artistSlug.js — the slug of an artist name, as song and run links use
// it (/songs/?artist=goose, run keys "goose:red-rocks:2024-06-21").
//
// The same as lib/wishlist.js artistKeyFor({ name }) with no mbid, which is
// what lib/songIndex.js's artistSlugFromName always was. CommonJS (5.60.16)
// so lib/runIndex.js, and through it lib/yearRecap.js, can run on the server
// too. Not lib/stats/keys.js artistNameKey: that one trims first, so
// " Goose" slugs differently, and changing it would change existing keys.

function artistSlugFromName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

module.exports = { artistSlugFromName };
