// netlify/functions/public-poster.js
//
// A shared personal poster (lib/myPosters.js), from the record stored under
// its code:
//
//   GET /p/{code}/                    the record, noindex, "Make your own"
//   GET /p/{code}/og.png              its link preview, 1200x630
//   GET /p/{code}/poster-feed.png     1080x1350
//   GET /p/{code}/poster-story.png    1080x1920
//
// The images are heardRecord.js's posterSvg, rasterized by
// lib/posterImage.js, so they match the posters the app drew from the same
// record. An unknown code is a real 404.
//
// A code can also name a Year in Review recap (lib/yearRecapCard.js),
// stored in the same place: same addresses, drawn by recapSvg and shown by
// renderRecapPage instead.

const { withCors } = require('./lib/cors');
const { routeParams } = require('./lib/publicRouteParams');
const { notFoundPage } = require('./lib/publicPageHtml');
const heard = require('./lib/heardRecord');
const { render } = require('./lib/posterImage');
const { openPosterStore, loadEntry, renderPosterPage, KINDS } = require('./lib/myPosters');
const { recapSvg, renderRecapPage } = require('./lib/yearRecapCard');

const NOT_FOUND = 'No poster at this address.';

exports.handler = async function (event) {
  const image = routeParams(event, 'posterImage');
  const pageParams = routeParams(event, 'poster');

  try {
    if (image.code) {
      const kind = KINDS[image.image];
      const entry = kind ? await loadEntry(openPosterStore(event), image.code) : null;
      if (!entry) {
        return { statusCode: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, s-maxage=60' }, body: 'Not found' };
      }
      const png = render(entry.type === 'recap'
        ? recapSvg(entry.recap, kind)
        : heard.posterSvg(heard.personalData(entry.record), entry.record, kind));
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'X-Robots-Tag': 'noindex',
          'Cache-Control': 'public, max-age=3600, s-maxage=604800',
        },
        body: png.toString('base64'),
        isBase64Encoded: true,
      };
    }

    const entry = pageParams.code ? await loadEntry(openPosterStore(event), pageParams.code) : null;
    if (!entry) {
      // Short: a code stored a moment ago may not have reached this server yet.
      return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60', 'X-Robots-Tag': 'noindex' }, body: notFoundPage(NOT_FOUND) };
    }
    return entry.type === 'recap'
      ? renderRecapPage(entry.recap, pageParams.code)
      : renderPosterPage(entry.record, pageParams.code);
  } catch (err) {
    console.error('public-poster error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
