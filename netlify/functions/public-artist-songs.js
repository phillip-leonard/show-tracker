// netlify/functions/public-artist-songs.js
//
// GET /artist/{slug}/songs/ — every song a band has played, A to Z, each
// linked to its song page, from the same snapshot as the band page. Only
// artists with songPages in config/public-artists.json have one; any other
// slug is a 404. It is how every song page, thin ones included, is reached
// by a link and not only through the sitemap.

const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtist } = require('./lib/publicArtistSnapshot');
const { renderSongIndex, notFound } = require('./lib/publicArtistPages');
const { notFoundPage } = require('./lib/publicPageHtml');

exports.handler = async function (event) {
  const slug = routeParams(event, 'songs').slug.toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(slug)) return notFound('No song list at this address.');

  try {
    const loaded = await loadArtist(openBlobStore(event), slug);
    if (!loaded) return notFound('No song list at this address.');
    return renderSongIndex(loaded);
  } catch (err) {
    console.error('public-artist-songs error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
