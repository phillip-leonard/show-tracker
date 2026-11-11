// netlify/functions/lib/yearRecapCard.js
//
// The Year in Review recap card ("My 2026 in live music") and its share
// page, drawn on the same renderer as the "Songs I've heard" posters:
// plain SVG (heardRecord.js's text helpers, Plus Jakarta Sans) rasterized
// by lib/posterImage.js.
//
//   POST /api/my-poster  { action: 'image', kind, recap, buddyUid? } -> PNG
//                        { action: 'share', recap, buddyUid? }        -> { ok, code, url }
//                        (my-poster.js; signed-in users only)
//   GET  /p/<code>/                       the shared recap, noindex
//   GET  /p/<code>/og.png                 1200x630
//   GET  /p/<code>/poster-feed.png        1080x1350
//   GET  /p/<code>/poster-story.png       1080x1920
//                        (public-poster.js, which tells a recap from a
//                        personal poster by the stored entry's `type`)
//
// ── What a recap may contain ──────────────────────────────────────────
//
// cleanRecap keeps only: the year, the headline counts, up to 5 bands and
// 10 songs with their counts, the rarest catch and up to 5 bust-outs (song,
// band, how rare), a few highlights (busiest month, longest run) and the
// "updated through" date. No user id, name, email, notes, ratings, show
// ids or friends.
//
// The show buddy's first name is never taken from the client. The app
// sends the buddy's uid; the server adds `buddy: { firstName, shows }` only
// when that uid is the caller's friend AND their profile is public
// (userProfiles/{uid}.publicProfile === true, the same gate as /u/<handle>).
// Otherwise the card simply has no buddy line.
//
// Palette: navy ground, mint #34D399, orange #FB923C. Type only: no band
// logos or artwork.

const heard = require('./heardRecord');
const { escapeHtml, page, formatShowDate, SITE_URL } = require('./publicPageHtml');

const { esc, textWidth, clip, FONT } = heard.svgText;

const COLORS = {
  navy: '#1c1c36', navyLight: '#2a2a4e', mint: '#34D399', orange: '#FB923C',
  text: '#f5f5f5', muted: '#a9a8c2', line: 'rgba(255,255,255,0.14)',
};
const SIZES = heard.SIZES;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── The record ────────────────────────────────────────────────────────

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, max = 1000000) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

/** A recap, cleaned to what may be drawn or stored; null if unusable. */
function cleanRecap(input) {
  if (!input || typeof input !== 'object') return null;
  const year = int(input.year, 9999);
  const shows = int(input.shows);
  if (year < 1900 || !shows) return null;
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

  const topBands = list(input.topBands, 5)
    .map((b) => ({ name: str(b && b.name, 120), shows: int(b && b.shows) }))
    .filter((b) => b.name && b.shows);
  const topSongs = list(input.topSongs, 10)
    .map((s) => ({ name: str(s && s.name, 160), artist: str(s && s.artist, 120), count: int(s && s.count) }))
    .filter((s) => s.name && s.count);
  const r = input.rarest;
  const rarest = r && str(r.name, 160) && int(r.timesPlayed)
    ? { name: str(r.name, 160), band: str(r.band, 120), timesPlayed: int(r.timesPlayed) }
    : null;
  const bustOuts = list(input.bustOuts, 5)
    .map((b) => ({ name: str(b && b.name, 160), band: str(b && b.band, 120), gap: int(b && b.gap) }))
    .filter((b) => b.name && b.gap);
  const month = Number.isInteger(input.busiestMonth?.month) && input.busiestMonth.month >= 0 && input.busiestMonth.month < 12
    ? { month: input.busiestMonth.month, shows: int(input.busiestMonth.shows) }
    : null;
  const run = input.longestRun && int(input.longestRun.nights) >= 2
    ? { artist: str(input.longestRun.artist, 120), venue: str(input.longestRun.venue, 160), nights: int(input.longestRun.nights, 100) }
    : null;

  return {
    type: 'recap',
    year,
    shows,
    bands: Math.min(int(input.bands), shows),
    venues: Math.min(int(input.venues), shows),
    songsHeard: int(input.songsHeard),
    newBands: Math.min(int(input.newBands), shows),
    topBands,
    topSongs,
    rarest,
    bustOuts,
    busiestMonth: month && month.shows ? month : null,
    longestRun: run && run.artist ? run : null,
    updatedThrough: iso(input.updatedThrough),
    // Only ever set by the server (withBuddy below).
    buddy: input.buddy && str(input.buddy.firstName, 40) && int(input.buddy.shows)
      ? { firstName: str(input.buddy.firstName, 40), shows: int(input.buddy.shows) }
      : null,
  };
}

/**
 * The recap the client posted, cleaned, with the buddy line added only
 * when the server says so. `lookup(uid, buddyUid)` resolves
 * { firstName } for a public friend, else null.
 */
async function withBuddy(input, { uid, buddyUid, buddyShows }, lookup) {
  const recap = cleanRecap({ ...(input || {}), buddy: null });
  if (!recap) return null;
  if (!buddyUid || !uid || !lookup) return recap;
  const found = await lookup(uid, String(buddyUid));
  if (found && found.firstName && int(buddyShows)) {
    recap.buddy = { firstName: str(found.firstName, 40), shows: int(buddyShows) };
  }
  return recap;
}

/** Firestore lookup for withBuddy: a friend of uid with a public profile. */
function firestoreBuddyLookup(db) {
  return async (uid, buddyUid) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(buddyUid)) return null;
    const [friend, profile] = await Promise.all([
      db.doc(`users/${uid}/friends/${buddyUid}`).get(),
      db.doc(`userProfiles/${buddyUid}`).get(),
    ]);
    if (!friend.exists || !profile.exists) return null;
    const p = profile.data() || {};
    if (p.publicProfile !== true) return null;
    const first = str(p.firstName, 40) || str(p.displayName, 80).split(' ')[0];
    return first ? { firstName: first } : null;
  };
}

// ── Drawing ───────────────────────────────────────────────────────────

const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || `${one}s`)}`;

function text(x, y, content, { size, weight = 700, fill = COLORS.text, anchor = 'start', spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(content)}</text>`;
}
const label = (x, y, content, size, anchor) => text(x, y, String(content).toUpperCase(), { size, weight: 800, fill: COLORS.mint, spacing: size * 0.16, anchor });
const rule = (x1, x2, y) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${COLORS.line}" stroke-width="2"/>`;

function frame(width, height, inset) {
  return `<defs><radialGradient id="glow" cx="50%" cy="18%" r="80%"><stop offset="0%" stop-color="${COLORS.mint}" stop-opacity="0.18"/><stop offset="60%" stop-color="${COLORS.navyLight}" stop-opacity="0.45"/><stop offset="100%" stop-color="${COLORS.navy}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="${COLORS.navy}"/>`
    + `<rect width="${width}" height="${height}" fill="url(#glow)"/>`
    + `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="${COLORS.orange}" stroke-width="3"/>`;
}

function headlineStats(recap) {
  return [
    [num(recap.shows), recap.shows === 1 ? 'Show' : 'Shows', COLORS.mint],
    [num(recap.bands), recap.bands === 1 ? 'Band' : 'Bands', COLORS.orange],
    [num(recap.venues), recap.venues === 1 ? 'Venue' : 'Venues', COLORS.text],
    [num(recap.songsHeard), recap.songsHeard === 1 ? 'Song heard' : 'Songs heard', COLORS.text],
  ];
}

// A 2x2 (tall cards) or 4x1 grid of the headline numbers.
function statGrid(recap, x, y, width, { cols, size, labelSize, rowGap }) {
  const out = [];
  const colW = width / cols;
  headlineStats(recap).forEach(([v, l, fill], i) => {
    const cx = x + (i % cols) * colW;
    const cy = y + Math.floor(i / cols) * rowGap;
    const s = Math.min(size, Math.floor(size * (colW - 24) / Math.max(1, textWidth(v, size, 800))));
    out.push(text(cx, cy, v, { size: s, weight: 800, fill }));
    out.push(text(cx, cy + labelSize * 1.8, l.toUpperCase(), { size: labelSize, weight: 700, fill: COLORS.muted, spacing: labelSize * 0.1 }));
  });
  return out.join('');
}

function bandRows(bands, x, y, width, { size, rowHeight }) {
  return bands.map((b, i) => {
    const yy = y + i * rowHeight;
    const count = plural(b.shows, 'show');
    const countW = textWidth(count, size * 0.7, 700) + 24;
    return text(x, yy, `${i + 1}`, { size, weight: 800, fill: COLORS.orange })
      + text(x + size * 1.1, yy, clip(b.name, size, 800, width - size * 1.1 - countW), { size, weight: 800 })
      + text(x + width, yy, count, { size: size * 0.7, weight: 700, fill: COLORS.muted, anchor: 'end' });
  }).join('');
}

function songRows(songs, x, y, width, { size, rowHeight }) {
  const countW = size * 2.4;
  return songs.map((s, i) => {
    const yy = y + i * rowHeight;
    return text(x, yy, `${s.count}×`, { size, weight: 800, fill: COLORS.mint })
      + text(x + countW, yy, clip(s.name, size, 700, width - countW), { size, weight: 700 });
  }).join('');
}

// The tall cards, top to bottom: title, numbers, top bands, top songs,
// then the rarest catch and show buddy side by side, and the footer. What
// doesn't fit is trimmed from the bottom up, never squeezed: top songs go
// down to 3 rows, then the buddy goes, then the rarest catch.
const TALL = {
  story: {
    pad: 104, eyebrow: [180, 28], title: [300, 112], subtitle: [384, 56], rule1: 436,
    stats: { y: 540, cols: 2, size: 92, labelSize: 22, rowGap: 150 }, newBands: [800, 26], rule2: 846,
    footer: 140, gap: 34, label: 24,
    bands: { head: 62, row: 64, size: 42 }, songs: { head: 60, row: 54, size: 36 },
    pair: { h: 130, name: 38, sub: 24 },
  },
  feed: {
    pad: 88, eyebrow: [120, 24], title: [214, 92], subtitle: [276, 44], rule1: 316,
    stats: { y: 404, cols: 4, size: 70, labelSize: 17, rowGap: 0 }, newBands: [482, 22], rule2: 512,
    footer: 96, gap: 20, label: 21,
    bands: { head: 54, row: 52, size: 36 }, songs: { head: 52, row: 44, size: 31 },
    pair: { h: 108, name: 32, sub: 21 },
  },
};

function title(width, y, year, size) {
  return `<text x="${width / 2}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="800" text-anchor="middle"><tspan fill="${COLORS.text}">My </tspan><tspan fill="${COLORS.orange}">${esc(year)}</tspan></text>`;
}

function tallCard(recap, { width, height }, story) {
  const m = TALL[story ? 'story' : 'feed'];
  const pad = m.pad;
  const inner = width - pad * 2;
  const out = [];

  out.push(label(width / 2, m.eyebrow[0], 'Year in Review', m.eyebrow[1], 'middle'));
  out.push(title(width, m.title[0], recap.year, m.title[1]));
  out.push(text(width / 2, m.subtitle[0], 'in live music', { size: m.subtitle[1], weight: 700, anchor: 'middle' }));
  out.push(rule(pad, width - pad, m.rule1));
  out.push(statGrid(recap, pad, m.stats.y, inner, m.stats));
  if (recap.newBands) {
    out.push(text(width / 2, m.newBands[0], `${plural(recap.newBands, 'band')} seen for the first time`, { size: m.newBands[1], weight: 400, fill: COLORS.muted, anchor: 'middle' }));
  }
  out.push(rule(pad, width - pad, m.rule2));

  const footY = height - m.footer;
  const footRule = footY - Math.round(m.footer * 0.62);
  const room = footRule - m.rule2;

  const bands = recap.topBands.slice(0, 3);
  let songCount = Math.min(5, recap.topSongs.length);
  let pair = [recap.rarest ? 'rarest' : null, recap.buddy ? 'buddy' : null].filter(Boolean);
  const heightOf = () => {
    const parts = [];
    if (bands.length) parts.push(m.bands.head + m.bands.row * bands.length);
    if (songCount) parts.push(m.songs.head + m.songs.row * songCount);
    if (pair.length) parts.push(m.pair.h);
    return parts.reduce((n, h) => n + h + m.gap, m.gap);
  };
  while (heightOf() > room) {
    if (songCount > 3) songCount--;
    else if (pair.includes('buddy')) pair = pair.filter((p) => p !== 'buddy');
    else if (pair.length) pair = [];
    else if (songCount > 0) songCount--;
    else break;
  }

  let y = m.rule2 + m.gap;
  if (bands.length) {
    out.push(label(pad, y + m.label, 'Top bands', m.label));
    out.push(bandRows(bands, pad, y + m.bands.head + m.bands.size * 0.55, inner, { size: m.bands.size, rowHeight: m.bands.row }));
    y += m.bands.head + m.bands.row * bands.length + m.gap;
  }
  if (songCount) {
    out.push(label(pad, y + m.label, 'Top songs', m.label));
    out.push(songRows(recap.topSongs.slice(0, songCount), pad, y + m.songs.head + m.songs.size * 0.55, inner, { size: m.songs.size, rowHeight: m.songs.row }));
    y += m.songs.head + m.songs.row * songCount + m.gap;
  }
  if (pair.length) {
    const colW = pair.length === 2 ? inner / 2 - 20 : inner;
    pair.forEach((kind, i) => {
      const x = pad + i * (inner / 2 + 20);
      if (kind === 'rarest') {
        out.push(label(x, y + m.label, 'Rarest catch', m.label));
        out.push(text(x, y + m.label + m.pair.name * 1.45, clip(recap.rarest.name, m.pair.name, 800, colW), { size: m.pair.name, weight: 800 }));
        out.push(text(x, y + m.label + m.pair.name * 1.45 + m.pair.sub * 1.6, clip(`${recap.rarest.band} · played ${plural(recap.rarest.timesPlayed, 'time')} ever`, m.pair.sub, 400, colW), { size: m.pair.sub, weight: 400, fill: COLORS.muted }));
      } else {
        out.push(label(x, y + m.label, 'Show buddy', m.label));
        out.push(text(x, y + m.label + m.pair.name * 1.45, clip(recap.buddy.firstName, m.pair.name, 800, colW), { size: m.pair.name, weight: 800 }));
        out.push(text(x, y + m.label + m.pair.name * 1.45 + m.pair.sub * 1.6, clip(`${plural(recap.buddy.shows, 'show')} together`, m.pair.sub, 400, colW), { size: m.pair.sub, weight: 400, fill: COLORS.muted }));
      }
    });
  }

  out.push(rule(pad, width - pad, footRule));
  out.push(text(width / 2, footY, 'mysetlists.net', { size: story ? 42 : 36, weight: 800, fill: COLORS.orange, anchor: 'middle' }));
  return out.join('');
}

// The 1200x630 link preview.
function previewCard(recap, { width, height }) {
  const pad = 72;
  const out = [];
  out.push(label(pad, 112, 'Year in Review', 20));
  out.push(`<text x="${pad}" y="200" font-family="${FONT}" font-size="80" font-weight="800"><tspan fill="${COLORS.text}">My </tspan><tspan fill="${COLORS.orange}">${esc(recap.year)}</tspan></text>`);
  out.push(text(pad, 252, 'in live music', { size: 40, weight: 700 }));
  out.push(statGrid(recap, pad, 380, 520, { cols: 2, size: 58, labelSize: 16, rowGap: 120 }));
  const rx = 680;
  out.push(`<line x1="${rx - 40}" y1="96" x2="${rx - 40}" y2="${height - 96}" stroke="${COLORS.line}" stroke-width="2"/>`);
  let y = 118;
  const bands = recap.topBands.slice(0, 3);
  if (bands.length) {
    out.push(label(rx, y, 'Top bands', 20));
    out.push(bandRows(bands, rx, y + 56, width - rx - pad, { size: 32, rowHeight: 52 }));
    y += 56 + bands.length * 52 + 30;
  }
  const songs = recap.topSongs.slice(0, 3);
  if (songs.length) {
    out.push(label(rx, y, 'Top songs', 20));
    out.push(songRows(songs, rx, y + 52, width - rx - pad, { size: 28, rowHeight: 46 }));
  }
  out.push(text(width - pad, height - 64, 'mysetlists.net', { size: 26, weight: 800, fill: COLORS.orange, anchor: 'end' }));
  return out.join('');
}

/** The recap card as SVG. kind: 'feed' | 'story' | 'card'. */
function recapSvg(recap, kind) {
  const size = SIZES[kind] || SIZES.feed;
  const body = kind === 'card' ? previewCard(recap, size) : tallCard(recap, size, kind === 'story');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${frame(size.width, size.height, kind === 'card' ? 28 : 40)}${body}</svg>`;
}

// ── /p/<code>/ ────────────────────────────────────────────────────────

const STYLE = `
  :root { --bg: #1c1c36; --fg: #f4f3fb; --muted: #b7b6c9; --card: rgba(255,255,255,0.05); --line: rgba(255,255,255,0.1); --mint: #34D399; --orange: #FB923C; --btn-fg: #1c1c36; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --bg: #f6f6fa; --fg: #1f1f3a; --muted: #57566f; --card: #ffffff; --line: rgba(31,31,58,0.13); --mint: #047857; --orange: #c2410c; --btn-fg: #ffffff; }
  }
  body { background: var(--bg); color: var(--fg); }
  a { color: var(--orange); }
  .eyebrow { color: var(--mint); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; font-size: 13px; margin: 0 0 6px; }
  h1 { margin: 0 0 6px; }
  .sub { color: var(--muted); margin: 0 0 18px; }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
  @media (min-width: 560px) { .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .stat .n { font-size: 28px; font-weight: 800; }
  .stat .l { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .cta { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin: 22px 0; }
  .btn { display: inline-block; background: var(--orange); color: var(--btn-fg); font-weight: 800; text-decoration: none; padding: 10px 18px; border-radius: 999px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 18px; }
  td, th { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .num { text-align: right; white-space: nowrap; }
  .note { color: var(--muted); font-size: 14px; }
`;

const recapPath = (code) => `/p/${code}/`;
const recapImagePath = (code, kind) => `${recapPath(code)}${kind === 'card' ? 'og' : `poster-${kind}`}.png`;
const MAKE_YOUR_OWN = '/year-in-review/';

/** "In 2026: 41 shows, 18 bands, 22 venues, 212 songs heard" — no names, ever. */
function recapHeadline(recap) {
  return `My ${recap.year} in live music: ${plural(recap.shows, 'show')}, ${plural(recap.bands, 'band')}, ${plural(recap.songsHeard, 'song')} heard`;
}

function renderRecapPage(recap, code) {
  const headline = recapHeadline(recap);
  const stats = headlineStats(recap).map(([v, l]) => [v, l]);
  const parts = [];
  if (recap.topBands.length) {
    parts.push(`<h2>Top bands</h2><table><tbody>${recap.topBands
      .map((b, i) => `<tr><td>${i + 1}. ${escapeHtml(b.name)}</td><td class="num">${plural(b.shows, 'show')}</td></tr>`).join('')}</tbody></table>`);
  }
  if (recap.topSongs.length) {
    parts.push(`<h2>Top songs</h2><table><tbody>${recap.topSongs
      .map((s) => `<tr><td>${escapeHtml(s.name)}${s.artist ? ` <span class="note">· ${escapeHtml(s.artist)}</span>` : ''}</td><td class="num">${s.count}&times;</td></tr>`).join('')}</tbody></table>`);
  }
  if (recap.rarest || recap.bustOuts.length) {
    const rows = [];
    if (recap.rarest) rows.push(`<tr><td>Rarest catch: <strong>${escapeHtml(recap.rarest.name)}</strong> <span class="note">· ${escapeHtml(recap.rarest.band)}</span></td><td class="num">played ${plural(recap.rarest.timesPlayed, 'time')} ever</td></tr>`);
    recap.bustOuts.forEach((b) => rows.push(`<tr><td>Bust-out: ${escapeHtml(b.name)} <span class="note">· ${escapeHtml(b.band)}</span></td><td class="num">after ${plural(b.gap, 'show')}</td></tr>`));
    parts.push(`<h2>Rare ones</h2><table><tbody>${rows.join('')}</tbody></table>`);
  }
  const highlights = [];
  if (recap.busiestMonth) highlights.push(`Busiest month: ${MONTHS[recap.busiestMonth.month]} (${plural(recap.busiestMonth.shows, 'show')})`);
  if (recap.longestRun) highlights.push(`Longest run: ${recap.longestRun.nights} nights of ${escapeHtml(recap.longestRun.artist)}${recap.longestRun.venue ? ` at ${escapeHtml(recap.longestRun.venue)}` : ''}`);
  if (recap.buddy) highlights.push(`Show buddy: ${escapeHtml(recap.buddy.firstName)} (${plural(recap.buddy.shows, 'show')} together)`);
  if (highlights.length) parts.push(`<h2>Highlights</h2><ul>${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`);

  const bodyHtml = `
    <p class="eyebrow">Year in Review</p>
    <h1>My ${recap.year} in live music</h1>
    <p class="sub">${escapeHtml(headline.replace(/^My \d{4} in live music: /, ''))}${recap.updatedThrough ? `. Updated through ${escapeHtml(formatShowDate(recap.updatedThrough, 'short'))}` : ''}.</p>
    <div class="stats">${stats.map(([v, l]) => `<div class="stat"><div class="n">${escapeHtml(v)}</div><div class="l">${escapeHtml(l)}</div></div>`).join('')}</div>
    <p><img src="${SITE_URL}${recapImagePath(code, 'feed')}" alt="${escapeHtml(headline)}" width="540" height="675" style="width:100%;max-width:540px;height:auto;border-radius:12px;display:block;" loading="lazy"></p>
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">What did your ${recap.year} sound like?</p>
      <p class="note" style="margin:0 0 10px;">Log your shows on MySetlists and get your own recap: top bands, top songs, rarest catch. Free.</p>
      <a class="btn" href="${SITE_URL}${MAKE_YOUR_OWN}?year=${recap.year}">Make your own ${recap.year} recap</a>
    </div>
    ${parts.join('')}
    <p class="note">Song counts come from setlists logged on MySetlists, most of them from setlist.fm. Rarest catches and bust-outs come from the full setlist archives for Goose, Phish, Umphrey's McGee and King Gizzard.</p>
  `;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
      'X-Robots-Tag': 'noindex, follow',
    },
    body: page({
      title: `${headline} | MySetlists`,
      description: `${headline}. Top bands: ${recap.topBands.slice(0, 3).map((b) => b.name).join(', ') || '–'}. Make your own on MySetlists.`,
      canonicalPath: recapPath(code),
      ogImage: `${SITE_URL}${recapImagePath(code, 'card')}`,
      bodyHtml,
      extraStyle: STYLE,
      robots: 'noindex, follow',
    }),
  };
}

module.exports = {
  cleanRecap,
  withBuddy,
  firestoreBuddyLookup,
  recapSvg,
  recapHeadline,
  renderRecapPage,
};
