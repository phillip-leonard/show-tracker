// netlify/functions/artist-api.js
//
//   GET /api/artist?slug=<slug>                 band stats + song list
//   GET /api/artist-song?slug=<slug>&song=<song> one song's stats
//   GET /api/artist-shows?slug=<slug>           every show with its setlist,
//                                               for the "Songs I've heard"
//                                               tool (archive bands only)
//
// The public band and song pages as JSON, for the iOS app to render
// natively. Read from the same snapshot, through the same loadArtist and
// availability rules, as public-artist.js and public-artist-song.js, with
// the same cache headers; see lib/publicArtistPages.js (artistJson,
// artistSongJson). 404 for an unknown slug or song, 503 while phish.net
// data is past its 24 hours.
//
// netlify.toml rewrites the public paths to /.netlify/functions/artist-api/band,
// .../song and .../shows; the visitor's query string passes through untouched.

const { openBlobStore, loadArtist, loadArtistShows } = require('./lib/publicArtistSnapshot');
const { artistJson, artistSongJson, artistShowsJson, jsonResponse } = require('./lib/publicArtistPages');

function whichKind(event) {
  const paths = [event.path || ''];
  try { if (event.rawUrl) paths.push(new URL(event.rawUrl).pathname); } catch { /* path is enough */ }
  if (paths.some((p) => /\/(song|artist-song)\/?$/.test(p))) return 'song';
  if (paths.some((p) => /\/(shows|artist-shows)\/?$/.test(p))) return 'shows';
  return 'band';
}

exports.handler = async function (event) {
  const query = event.queryStringParameters || {};
  const slug = String(query.slug || '').toLowerCase().trim();
  const song = String(query.song || '').toLowerCase().trim();
  const kind = whichKind(event);
  const isSong = kind === 'song';
  const notFound = () => jsonResponse(404, { ok: false, error: 'not_found' }, { 'Cache-Control': 'public, s-maxage=300' });

  if (!/^[a-z0-9-]+$/.test(slug)) return notFound();
  if (isSong && !/^[a-z0-9-]+$/.test(song)) return notFound();

  try {
    const store = openBlobStore(event);
    if (kind === 'shows') return artistShowsJson(await loadArtistShows(store, slug));
    const loaded = await loadArtist(store, slug);
    return isSong ? artistSongJson(loaded, song) : artistJson(loaded);
  } catch (err) {
    console.error('artist-api error:', err);
    return jsonResponse(500, { ok: false, error: 'server_error' }, { 'Cache-Control': 'no-store' });
  }
};
