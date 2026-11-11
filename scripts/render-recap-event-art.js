#!/usr/bin/env node
// scripts/render-recap-event-art.js
//
// The App Store In-App Event media for "Your 2026 in Live Music"
// (Dec 2 – Jan 1), in the recap card's palette
// (netlify/functions/lib/yearRecapCard.js), rasterized by the same renderer:
//
//   event-card-1920x1080 / -3840x2160        the event card (16:9)
//   event-details-1080x1920 / -2160x3840     the event details page (9:16)
//
// Written to docs/app-store/year-in-review-2026/ as .jpg and .png, at
// Apple's minimum and maximum sizes, opaque sRGB with no alpha channel.
//
// Apple's In-App Event guidance, which this follows:
//   - avoid text and logos where possible: there's none here. The event
//     name and description come from the event's own metadata.
//   - don't add borders or gradients: the App Store applies its own crop
//     and gradient. Flat shapes on a flat navy ground only.
//   - keep the card and the details page visually continuous: both are the
//     same illustration, a recap card (a year bar, four stat tiles, top
//     songs) among setlist rows, with the main shapes centered so the
//     automatic crop doesn't cut them.
//
//   node scripts/render-recap-event-art.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { render } = require('../netlify/functions/lib/posterImage');

const C = { navy: '#1c1c36', panel: '#262648', tile: '#30305a', mint: '#34D399', orange: '#FB923C', text: '#f5f5f5', faint: '#3a3a64' };
const OUT = path.join(__dirname, '..', 'docs', 'app-store', 'year-in-review-2026');

const rect = (x, y, w, h, r, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${extra}/>`;
const dot = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

// A column of setlist rows: a dot, then a bar of varying length.
function setlistRows(x, y, rows, { width, gap, bar }) {
  const lengths = [0.62, 0.84, 0.48, 0.74, 0.56, 0.9, 0.66, 0.42, 0.8, 0.58, 0.7, 0.5];
  let out = '';
  for (let i = 0; i < rows; i++) {
    const yy = y + i * gap;
    out += dot(x + bar * 0.45, yy, bar * 0.45, i % 3 === 0 ? C.orange : C.mint);
    out += rect(x + bar * 1.4, yy - bar / 2, width * lengths[i % lengths.length], bar, bar / 2, i % 4 === 1 ? C.tile : C.faint);
  }
  return out;
}

// The recap card itself, drawn as shapes: the year as an orange bar, a
// subtitle bar, a 2x2 grid of stat tiles (shows mint, bands orange, venues
// and songs white), and four "top songs" rows with mint counts.
function recapCard(x, y, w) {
  const h = w * 1.6;
  const pad = w * 0.09;
  const inner = w - pad * 2;
  let out = rect(x, y, w, h, w * 0.07, C.panel);
  out += rect(x + pad, y + pad * 1.1, inner * 0.62, w * 0.11, w * 0.055, C.orange);
  out += rect(x + pad, y + pad * 1.1 + w * 0.16, inner * 0.4, w * 0.05, w * 0.025, C.text, ' fill-opacity="0.55"');
  const tileW = (inner - pad * 0.5) / 2;
  const tileH = w * 0.26;
  const tilesY = y + pad * 1.1 + w * 0.3;
  [[C.mint, 0.55], [C.orange, 0.42], [C.text, 0.5], [C.text, 0.68]].forEach(([fill, len], i) => {
    const tx = x + pad + (i % 2) * (tileW + pad * 0.5);
    const ty = tilesY + Math.floor(i / 2) * (tileH + pad * 0.5);
    out += rect(tx, ty, tileW, tileH, w * 0.035, C.tile);
    out += rect(tx + tileW * 0.12, ty + tileH * 0.24, tileW * len, tileH * 0.26, tileH * 0.13, fill);
    out += rect(tx + tileW * 0.12, ty + tileH * 0.64, tileW * 0.4, tileH * 0.1, tileH * 0.05, C.text, ' fill-opacity="0.3"');
  });
  const rowsY = tilesY + tileH * 2 + pad * 1.4;
  [0.7, 0.52, 0.62, 0.45].forEach((len, i) => {
    const ry = rowsY + i * w * 0.115;
    out += rect(x + pad, ry, w * 0.09, w * 0.06, w * 0.03, C.mint);
    out += rect(x + pad + w * 0.14, ry, inner * len, w * 0.06, w * 0.03, C.text, ' fill-opacity="0.75"');
  });
  return out;
}

// Scattered confetti dots, a nod to the last show of the year.
function confetti(points, r) {
  return points.map(([x, y, c], i) => dot(x, y, r * (i % 3 === 0 ? 1.4 : 1), c === 'o' ? C.orange : C.mint)).join('');
}

function eventCard() {
  const W = 1920; const H = 1080;
  const cardW = 480;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${rect(0, 0, W, H, 0, C.navy)}
    ${setlistRows(230, 270, 10, { width: 380, gap: 58, bar: 20 })}
    ${setlistRows(1250, 270, 10, { width: 380, gap: 58, bar: 20 })}
    ${recapCard((W - cardW) / 2, (H - cardW * 1.6) / 2, cardW)}
    ${confetti([[560, 170, 'o'], [690, 120, 'm'], [1240, 150, 'm'], [1380, 110, 'o'], [1500, 200, 'm'], [420, 230, 'm'], [1640, 900, 'o'], [300, 880, 'o'], [1560, 960, 'm']], 9)}
  </svg>`;
}

function eventDetails() {
  const W = 1080; const H = 1920;
  const cardW = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${rect(0, 0, W, H, 0, C.navy)}
    ${setlistRows(150, 200, 5, { width: 640, gap: 56, bar: 20 })}
    ${recapCard((W - cardW) / 2, (H - cardW * 1.6) / 2, cardW)}
    ${setlistRows(150, 1500, 5, { width: 640, gap: 56, bar: 20 })}
    ${confetti([[120, 120, 'o'], [930, 160, 'm'], [990, 520, 'o'], [90, 760, 'm'], [1000, 1180, 'm'], [80, 1380, 'o'], [940, 1820, 'o'], [200, 1840, 'm']], 10)}
  </svg>`;
}

// Each image at Apple's minimum and maximum size (1x and 2x), as JPEG and
// as PNG. Both are opaque RGB in sRGB: the PNG is made from the JPEG, so it
// has no alpha channel either.
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

function writeAll(svg, width, height, name) {
  const written = [];
  for (const scale of [1, 2]) {
    const w = width * scale;
    const h = height * scale;
    const scaled = svg.replace(`width="${width}" height="${height}"`, `width="${w}" height="${h}"`);
    const base = path.join(OUT, `${name}-${w}x${h}`);
    const tmp = path.join(os.tmpdir(), `${name}-${w}x${h}.png`);
    fs.writeFileSync(tmp, render(scaled));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '--matchTo', SRGB, tmp, '--out', `${base}.jpg`], { stdio: 'ignore' });
    execFileSync('sips', ['-s', 'format', 'png', `${base}.jpg`, '--out', `${base}.png`], { stdio: 'ignore' });
    fs.unlinkSync(tmp);
    written.push(`${base}.jpg`, `${base}.png`);
  }
  return written;
}

fs.mkdirSync(OUT, { recursive: true });
[...writeAll(eventCard(), 1920, 1080, 'event-card'), ...writeAll(eventDetails(), 1080, 1920, 'event-details')]
  .forEach((f) => console.log(f));
