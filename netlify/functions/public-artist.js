// netlify/functions/public-artist.js
//
// GET /artist/{slug}/ — a public band page, server-rendered from the daily
// snapshot (lib/publicArtistSnapshot.js) so crawlers see the setlists and
// song stats without running JavaScript. Fully public: no login, no
// gating. An unknown or not-yet-published slug is a real 404.

const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtist } = require('./lib/publicArtistSnapshot');
const { renderBand, notFound } = require('./lib/publicArtistPages');
const { notFoundPage } = require('./lib/publicPageHtml');

exports.handler = async function (event) {
  const slug = routeParams(event, 'artist').slug.toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(slug)) return notFound('No band at this address.');

  try {
    const loaded = await loadArtist(openBlobStore(event), slug);
    if (!loaded) return notFound('No band at this address.');
    return renderBand(loaded);
  } catch (err) {
    console.error('public-artist error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
