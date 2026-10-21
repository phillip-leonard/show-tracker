#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Renders scripts/og-image.svg to public/og-image.png at 1200x630.
 *
 * Why a PNG: the social preview used to be public/og-image.svg, and
 * Facebook, LinkedIn, iMessage, Slack and X all ignore SVG for og:image,
 * so every shared link went out with no picture. The SVG stays as the
 * editable source; the PNG is what ships.
 *
 * A manual dev step, not part of `npm run build`: run it after editing the
 * SVG and commit the PNG. It uses the Chromium that @playwright/test
 * already installs for the e2e suite, so rendering needs no new
 * dependency (no sharp, no runtime cost).
 *
 *   node scripts/render-og-image.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const WIDTH = 1200;
const HEIGHT = 630;

const svgPath = path.join(__dirname, 'og-image.svg');
const pngPath = path.join(__dirname, '..', 'public', 'og-image.png');

async function main() {
  const svg = fs.readFileSync(svgPath, 'utf8');
  // Falls back to the installed Google Chrome when `npx playwright install`
  // has not been run; the output is the same either way.
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#1f1f3a">${svg}</body></html>`
    );
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  } finally {
    await browser.close();
  }
  const kb = Math.round(fs.statSync(pngPath).size / 1024);
  console.log(`Wrote ${path.relative(process.cwd(), pngPath)} (${WIDTH}x${HEIGHT}, ${kb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
