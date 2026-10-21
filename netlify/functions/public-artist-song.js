// netlify/functions/public-artist-song.js
//
// GET /artist/{slug}/song/{song}/ — a public song page: times played,
// first and last played, gaps and recent performances, from the same
// snapshot as the band page. Only artists with songPages in
// config/public-artists.json have them; any other slug or song is a 404.

const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtist } = require('./lib/publicArtistSnapshot');
const { renderSong, notFound } = require('./lib/publicArtistPages');
const { notFoundPage } = require('./lib/publicPageHtml');

exports.handler = async function (event) {
  const params = routeParams(event, 'song');
  const slug = params.slug.toLowerCase().trim();
  const song = params.song.toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+$/.test(song)) return notFound('No song at this address.');

  try {
    const loaded = await loadArtist(openBlobStore(event), slug);
    if (!loaded) return notFound('No song at this address.');
    return renderSong(loaded, song);
  } catch (err) {
    console.error('public-artist-song error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
