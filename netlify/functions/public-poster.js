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

const { routeParams } = require('./lib/publicRouteParams');
const { notFoundPage } = require('./lib/publicPageHtml');
const heard = require('./lib/heardRecord');
const { render } = require('./lib/posterImage');
const { openPosterStore, loadRecord, renderPosterPage, KINDS } = require('./lib/myPosters');

const NOT_FOUND = 'No poster at this address.';

exports.handler = async function (event) {
  const image = routeParams(event, 'posterImage');
  const pageParams = routeParams(event, 'poster');

  try {
    if (image.code) {
      const kind = KINDS[image.image];
      const record = kind ? await loadRecord(openPosterStore(event), image.code) : null;
      if (!record) {
        return { statusCode: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, s-maxage=60' }, body: 'Not found' };
      }
      const png = render(heard.posterSvg(heard.personalData(record), record, kind));
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'X-Robots-Tag': 'noindex',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600, s-maxage=604800',
        },
        body: png.toString('base64'),
        isBase64Encoded: true,
      };
    }

    const record = pageParams.code ? await loadRecord(openPosterStore(event), pageParams.code) : null;
    if (!record) {
      // Short: a code stored a moment ago may not have reached this server yet.
      return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60', 'X-Robots-Tag': 'noindex' }, body: notFoundPage(NOT_FOUND) };
    }
    return renderPosterPage(record, pageParams.code);
  } catch (err) {
    console.error('public-poster error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
