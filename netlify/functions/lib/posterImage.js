// netlify/functions/lib/posterImage.js
//
// SVG to PNG for the poster functions: public-heard-image.js (the
// "Songs I've heard" share images) and public-poster.js / my-poster.js
// (the personal posters). heardRecord.js's posterSvg draws; this rasterizes
// with resvg.
//
// resvg has no system fonts on Lambda; the poster's font, Plus Jakarta Sans
// (the app's own, SIL OFL), ships with each function from
// netlify/functions/fonts/ (included_files in netlify.toml). resvg-js is a
// native module, so it's left out of the bundle and installed as is
// (external_node_modules). Every function that requires this file needs
// both lines in netlify.toml.

const fs = require('fs');
const path = require('path');

const FONT_FILES = ['PlusJakartaSans-Regular.ttf', 'PlusJakartaSans-Bold.ttf', 'PlusJakartaSans-ExtraBold.ttf'];

// Where included_files land depends on how the function was bundled, so
// look in the likely places once.
let fontPaths = null;
function fonts() {
  if (fontPaths) return fontPaths;
  const dirs = [
    path.join(__dirname, 'fonts'),
    path.join(__dirname, '..', 'fonts'),
    path.join(process.cwd(), 'netlify', 'functions', 'fonts'),
    path.join(__dirname, 'netlify', 'functions', 'fonts'),
    path.resolve(__dirname, '..', '..', 'netlify', 'functions', 'fonts'),
    path.resolve(__dirname, '..', '..', '..', 'netlify', 'functions', 'fonts'),
    '/var/task/netlify/functions/fonts',
  ];
  const dir = dirs.find((d) => fs.existsSync(path.join(d, FONT_FILES[0])));
  if (!dir) throw new Error(`poster fonts not found (looked in ${dirs.join(', ')})`);
  fontPaths = FONT_FILES.map((f) => path.join(dir, f));
  return fontPaths;
}

/** A PNG Buffer of an SVG string. */
function render(svg) {
  const { Resvg } = require('@resvg/resvg-js');
  return new Resvg(svg, {
    font: { fontFiles: fonts(), loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
  }).render().asPng();
}

module.exports = { render, FONT_FILES };
