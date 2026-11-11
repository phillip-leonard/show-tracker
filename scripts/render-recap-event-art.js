#!/usr/bin/env node
// scripts/render-recap-event-art.js
//
// The App Store In-App Event media for "Your 2026 in Live Music"
// (Dec 2 – Jan 1), drawn on the same renderer and in the same palette as
// the recap card (netlify/functions/lib/yearRecapCard.js):
//
//   event-card-1920x1080.jpg      the event card (16:9)
//   event-details-1080x1920.jpg   the event details page (9:16)
//
// Written to docs/app-store/year-in-review-2026/. JPEG, so there's no
// alpha channel for App Store Connect to reject.
//
// Type only: "2026" and abstract setlist rows, no band names or artwork.
// The App Store lays the event's badge, name and short description over
// the lower part of the media, so everything here sits in the top part and
// the bottom fades to plain navy.
//
//   node scripts/render-recap-event-art.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { render } = require('../netlify/functions/lib/posterImage');
const { svgText } = require('../netlify/functions/lib/heardRecord');

const C = { navy: '#1c1c36', navyLight: '#2a2a4e', mint: '#34D399', orange: '#FB923C', text: '#f5f5f5' };
const OUT = path.join(__dirname, '..', 'docs', 'app-store', 'year-in-review-2026');

function defs(id) {
  return `<defs>
    <radialGradient id="${id}-glow" cx="50%" cy="28%" r="70%">
      <stop offset="0%" stop-color="${C.mint}" stop-opacity="0.22"/>
      <stop offset="45%" stop-color="${C.navyLight}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${C.navy}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-warm" cx="78%" cy="18%" r="45%">
      <stop offset="0%" stop-color="${C.orange}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${C.orange}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.navy}" stop-opacity="0"/>
      <stop offset="1" stop-color="${C.navy}" stop-opacity="1"/>
    </linearGradient>
  </defs>`;
}

// A column of setlist-like rows: a dot, then a bar of varying length.
function setlistRows(x, y, rows, { width, gap, bar, dot, accent }) {
  const lengths = [0.62, 0.84, 0.48, 0.74, 0.56, 0.9, 0.66, 0.42, 0.8, 0.58];
  let out = '';
  for (let i = 0; i < rows; i++) {
    const yy = y + i * gap;
    const len = width * lengths[i % lengths.length];
    const color = i % 4 === 1 ? accent : C.text;
    out += `<circle cx="${x + dot}" cy="${yy}" r="${dot}" fill="${i % 3 === 0 ? C.orange : C.mint}" fill-opacity="0.85"/>`;
    out += `<rect x="${x + dot * 3.2}" y="${yy - bar / 2}" width="${len}" height="${bar}" rx="${bar / 2}" fill="${color}" fill-opacity="${color === C.text ? 0.16 : 0.5}"/>`;
  }
  return out;
}

function year(x, y, size) {
  return `<text x="${x}" y="${y}" font-family="${svgText.FONT}" font-size="${size}" font-weight="800" fill="${C.orange}" text-anchor="middle" letter-spacing="${-size * 0.02}">2026</text>`;
}

function eventCard() {
  const W = 1920; const H = 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs('c')}
    <rect width="${W}" height="${H}" fill="${C.navy}"/>
    <rect width="${W}" height="${H}" fill="url(#c-glow)"/>
    <rect width="${W}" height="${H}" fill="url(#c-warm)"/>
    ${setlistRows(150, 150, 8, { width: 260, gap: 58, bar: 16, dot: 7, accent: C.mint })}
    ${setlistRows(1480, 150, 8, { width: 260, gap: 58, bar: 16, dot: 7, accent: C.orange })}
    ${year(W / 2, 450, 340)}
    <rect x="${W / 2 - 180}" y="530" width="360" height="10" rx="5" fill="${C.mint}"/>
    <rect y="${H * 0.52}" width="${W}" height="${H * 0.48}" fill="url(#c-fade)"/>
  </svg>`;
}

function eventDetails() {
  const W = 1080; const H = 1920;
  // Four stat tiles under the year, as on the recap page, with bars in
  // place of numbers.
  const tiles = [[C.mint, 0.5], [C.orange, 0.38], [C.text, 0.44], [C.text, 0.62]].map(([color, len], i) => {
    const x = 120 + (i % 2) * 432;
    const y = 760 + Math.floor(i / 2) * 200;
    return `<rect x="${x}" y="${y}" width="408" height="176" rx="28" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2"/>`
      + `<rect x="${x + 36}" y="${y + 50}" width="${408 * len}" height="40" rx="20" fill="${color}" fill-opacity="${color === C.text ? 0.75 : 0.95}"/>`
      + `<rect x="${x + 36}" y="${y + 116}" width="150" height="16" rx="8" fill="${C.text}" fill-opacity="0.25"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs('d')}
    <rect width="${W}" height="${H}" fill="${C.navy}"/>
    <rect width="${W}" height="${H}" fill="url(#d-glow)"/>
    <rect width="${W}" height="${H}" fill="url(#d-warm)"/>
    ${year(W / 2, 560, 330)}
    <rect x="${W / 2 - 150}" y="612" width="300" height="10" rx="5" fill="${C.mint}"/>
    ${tiles}
    ${setlistRows(150, 1230, 5, { width: 700, gap: 64, bar: 18, dot: 8, accent: C.mint })}
    <rect y="${H * 0.6}" width="${W}" height="${H * 0.4}" fill="url(#d-fade)"/>
  </svg>`;
}

function writeJpeg(svg, name) {
  const tmp = path.join(os.tmpdir(), `${name}.png`);
  fs.writeFileSync(tmp, render(svg));
  const dest = path.join(OUT, `${name}.jpg`);
  // macOS sips: PNG -> JPEG drops the alpha channel.
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', tmp, '--out', dest], { stdio: 'ignore' });
  fs.unlinkSync(tmp);
  return dest;
}

fs.mkdirSync(OUT, { recursive: true });
console.log(writeJpeg(eventCard(), 'event-card-1920x1080'));
console.log(writeJpeg(eventDetails(), 'event-details-1080x1920'));
