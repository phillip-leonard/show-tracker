// netlify/functions/public-heard.js
//
// The "Songs I've heard" pages (lib/heardPages.js), from the band show
// lists in the public-artists snapshot:
//
//   GET /heard/                  pick a band
//   GET /heard/{slug}/           the tool
//   GET /heard/{slug}/r/{code}/  a shared record (noindex)
//
// An unknown band, a band without a show list, or a code that names no
// show is a real 404.

const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtistShows, loadIndex, heardArtists } = require('./lib/publicArtistSnapshot');
const { notFound } = require('./lib/publicArtistPages');
const { renderHeardIndex, renderHeardBand, renderHeardShare } = require('./lib/heardPages');
const { openShareStore, resolveCode } = require('./lib/heardShares');
const { decodeSelection } = require('./lib/heardRecord');
const { notFoundPage } = require('./lib/publicPageHtml');

const SLUG = /^[a-z0-9-]+$/;

exports.handler = async function (event) {
  const share = routeParams(event, 'heardShare');
  const band = routeParams(event, 'heard');

  try {
    const store = openBlobStore(event);

    if (share.slug) {
      const slug = share.slug.toLowerCase();
      if (!SLUG.test(slug)) return notFound('No record at this address.');
      const loaded = await loadArtistShows(store, slug);
      if (!loaded) return notFound('No record at this address.');
      const code = await resolveCode(() => openShareStore(event), slug, share.code);
      const decoded = code && decodeSelection(loaded.shows, code);
      if (!decoded || !decoded.ids.length) return notFound('No record at this address.');
      return renderHeardShare(loaded, share.code, decoded.ids);
    }

    if (band.slug) {
      const slug = band.slug.toLowerCase();
      if (!SLUG.test(slug)) return notFound('No band at this address.');
      const loaded = await loadArtistShows(store, slug);
      if (!loaded) return notFound('No band at this address.');
      // ?mine=1 is someone's own poster: noindex, same canonical.
      const mine = (event.queryStringParameters || {}).mine === '1';
      return renderHeardBand(loaded, Date.now(), { mine });
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
