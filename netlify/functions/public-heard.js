// netlify/functions/public-heard.js
//
// The "Songs I've heard" pages (lib/heardPages.js), from the band show
// lists in the public-artists snapshot:
//
//   GET /heard/                  pick a band
//   GET /heard/{slug}/           the tool
//
// An unknown band or a band without a show list is a real 404.

const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtistShows, loadIndex, heardArtists } = require('./lib/publicArtistSnapshot');
const { notFound } = require('./lib/publicArtistPages');
const { renderHeardIndex, renderHeardBand } = require('./lib/heardPages');
const { notFoundPage } = require('./lib/publicPageHtml');

const SLUG = /^[a-z0-9-]+$/;

exports.handler = async function (event) {
  const band = routeParams(event, 'heard');

  try {
    const store = openBlobStore(event);

    if (band.slug) {
      const slug = band.slug.toLowerCase();
      if (!SLUG.test(slug)) return notFound('No band at this address.');
      const loaded = await loadArtistShows(store, slug);
      if (!loaded) return notFound('No band at this address.');
      return renderHeardBand(loaded);
    }

    const index = await loadIndex(store);
    const entries = heardArtists()
      .map((a) => index.artists.find((e) => e.slug === a.slug && e.showsHash))
      .filter(Boolean)
      .map((entry) => ({ entry }));
    return renderHeardIndex(entries);
  } catch (err) {
    console.error('public-heard error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
