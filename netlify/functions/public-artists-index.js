// netlify/functions/public-artists-index.js
//
// GET /artists/ — every band with a public page, from the snapshot index.

const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');
const { renderIndex } = require('./lib/publicArtistPages');
const { notFoundPage } = require('./lib/publicPageHtml');

exports.handler = async function (event) {
  try {
    return renderIndex(await loadIndex(openBlobStore(event)));
  } catch (err) {
    console.error('public-artists-index error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
