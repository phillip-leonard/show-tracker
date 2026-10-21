// netlify/functions/artist-api.js
//
//   GET /api/artist?slug=<slug>                 band stats + song list
//   GET /api/artist-song?slug=<slug>&song=<song> one song's stats
//
// The public band and song pages as JSON, for the iOS app to render
// natively. Read from the same snapshot, through the same loadArtist and
// availability rules, as public-artist.js and public-artist-song.js, with
// the same cache headers; see lib/publicArtistPages.js (artistJson,
// artistSongJson). 404 for an unknown slug or song, 503 while phish.net
// data is past its 24 hours.
//
// netlify.toml rewrites the two public paths to /.netlify/functions/artist-api/band
// and .../song; the visitor's query string passes through untouched.

const { openBlobStore, loadArtist } = require('./lib/publicArtistSnapshot');
const { artistJson, artistSongJson, jsonResponse } = require('./lib/publicArtistPages');

function wantsSong(event) {
  const paths = [event.path || ''];
  try { if (event.rawUrl) paths.push(new URL(event.rawUrl).pathname); } catch { /* path is enough */ }
  return paths.some((p) => /\/(song|artist-song)\/?$/.test(p));
}

exports.handler = async function (event) {
  const query = event.queryStringParameters || {};
  const slug = String(query.slug || '').toLowerCase().trim();
  const song = String(query.song || '').toLowerCase().trim();
  const isSong = wantsSong(event);
  const notFound = () => jsonResponse(404, { ok: false, error: 'not_found' }, { 'Cache-Control': 'public, s-maxage=300' });

  if (!/^[a-z0-9-]+$/.test(slug)) return notFound();
  if (isSong && !/^[a-z0-9-]+$/.test(song)) return notFound();

  try {
    const loaded = await loadArtist(openBlobStore(event), slug);
    return isSong ? artistSongJson(loaded, song) : artistJson(loaded);
  } catch (err) {
    console.error('artist-api error:', err);
    return jsonResponse(500, { ok: false, error: 'server_error' }, { 'Cache-Control': 'no-store' });
  }
};
