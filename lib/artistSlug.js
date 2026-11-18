// lib/artistSlug.js — the slug of an artist name, as song and run links use
// it (/songs/?artist=goose, run keys "goose:red-rocks:2024-06-21").
//
// The same as lib/wishlist.js artistKeyFor({ name }) with no mbid, which is
// what lib/songIndex.js's artistSlugFromName always was. CommonJS (5.60.16)
// so lib/runIndex.js, and through it lib/yearRecap.js, can run on the server
// too.
//
// Trimmed first (5.60.32): " Phish " is "phish", as Stats' bandKey always
// read it. Until then the spaces became hyphens before the trim, so a padded
// name was "-phish-": another band page, its own song keys and runs. The
// Swift port (BandFollows.slug) trims the same way; fixtures/song-index/
// keys.json pins both. lib/wishlist.js artistKeyFor keeps the old rule on
// purpose: it names stored wishlist documents.

function artistSlugFromName(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

module.exports = { artistSlugFromName };
