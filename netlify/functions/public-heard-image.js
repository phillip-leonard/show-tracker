// netlify/functions/public-heard-image.js
//
// The "Songs I've heard" images for a share code, as PNG:
//
//   GET /heard/{slug}/r/{code}/og.png            1200x630, the link preview
//   GET /heard/{slug}/r/{code}/poster-feed.png   1080x1350
//   GET /heard/{slug}/r/{code}/poster-story.png  1080x1920
//
// One renderer for all three: heardRecord.js's posterSvg, rasterized with
// resvg. The tool fetches the two posters for its Download and Share
// buttons, so the poster someone downloads is the poster a link previews.
//
// resvg has no system fonts on Lambda; the poster's font, Plus Jakarta Sans
// (the app's own, SIL OFL), ships with the function from
// netlify/functions/fonts/ (included_files in netlify.toml). resvg-js is a
// native module, so it's left out of the bundle and installed as is
// (external_node_modules).
//
// Cached a day at the CDN, less for Phish: a cached image is phish.net data
// too, and may not outlive its 24 hours.

const fs = require('fs');
const path = require('path');
const { routeParams } = require('./lib/publicRouteParams');
const { openBlobStore, loadArtistShows, availability, cacheHeaders } = require('./lib/publicArtistSnapshot');
const { openShareStore, resolveCode } = require('./lib/heardShares');
const heard = require('./lib/heardRecord');

const KINDS = { og: 'card', 'poster-feed': 'feed', 'poster-story': 'story' };
const FONT_FILES = ['PlusJakartaSans-Regular.ttf', 'PlusJakartaSans-Bold.ttf', 'PlusJakartaSans-ExtraBold.ttf'];
const DAY = 86400;

// Where included_files land depends on how the function was bundled, so
// look in the likely places once.
let fontPaths = null;
function fonts() {
  if (fontPaths) return fontPaths;
  const dirs = [
    path.join(__dirname, 'fonts'),
    path.join(process.cwd(), 'netlify', 'functions', 'fonts'),
    path.join(__dirname, 'netlify', 'functions', 'fonts'),
    path.resolve(__dirname, '..', '..', 'netlify', 'functions', 'fonts'),
    '/var/task/netlify/functions/fonts',
  ];
  const dir = dirs.find((d) => fs.existsSync(path.join(d, FONT_FILES[0])));
  if (!dir) throw new Error(`poster fonts not found (looked in ${dirs.join(', ')})`);
  fontPaths = FONT_FILES.map((f) => path.join(dir, f));
  return fontPaths;
}

function render(svg) {
  const { Resvg } = require('@resvg/resvg-js');
  return new Resvg(svg, {
    font: { fontFiles: fonts(), loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
  }).render().asPng();
}

function imageCache(entry, now = Date.now()) {
  if (availability(entry, now).maxAgeSeconds == null) {
    return { 'Cache-Control': `public, max-age=3600, s-maxage=${DAY}, stale-while-revalidate=${DAY}` };
  }
  return cacheHeaders(entry, now);
}

const missing = () => ({ statusCode: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, s-maxage=300' }, body: 'Not found' });

exports.handler = async function (event) {
  const { slug, code, image } = routeParams(event, 'heardImage');
  const kind = KINDS[image];
  if (!kind || !/^[a-z0-9-]+$/.test(slug)) return missing();

  try {
    const loaded = await loadArtistShows(openBlobStore(event), slug);
    if (!loaded) return missing();
    if (!availability(loaded.entry).available) {
      return { statusCode: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, s-maxage=60' }, body: 'Temporarily unavailable' };
    }
    const resolved = await resolveCode(() => openShareStore(event), slug, code);
    const decoded = resolved && heard.decodeSelection(loaded.shows, resolved);
    if (!decoded || !decoded.ids.length) return missing();

    const record = heard.buildRecord(loaded.shows, decoded.ids);
    const png = render(heard.posterSvg(loaded.shows, record, kind));
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'X-Robots-Tag': 'noindex',
        'Access-Control-Allow-Origin': '*',
        ...imageCache(loaded.entry),
      },
      body: png.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('public-heard-image error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: 'Error' };
  }
};

exports.render = render;
