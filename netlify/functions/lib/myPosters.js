// netlify/functions/lib/myPosters.js
//
// Personal posters: "Songs I've heard" for any band a signed-in user has
// logged, built in the app from their own shows (lib/myPoster.js,
// /my-poster/?artist=<name>) rather than from a band archive. This file is
// the server half:
//
//   POST /api/my-poster  { action: 'image', kind, record }  -> PNG
//                        { action: 'share', record }        -> { ok, code, url }
//                        (my-poster.js; signed-in users only)
//   GET  /p/<code>/                     the shared record, noindex
//   GET  /p/<code>/og.png               its link preview, 1200x630
//   GET  /p/<code>/poster-feed.png      1080x1350
//   GET  /p/<code>/poster-story.png     1080x1920
//                        (public-poster.js)
//
// A share stores the record, cleaned by heardRecord.js's
// cleanPersonalRecord, in Netlify Blobs store "my-posters" under a random
// code:
//
//   my-posters/<code> = { record, createdAt }
//
// The record is a band name, counts, the first and latest show (date and
// venue) and every song heard with its count. Nothing else is posted or
// stored: no user id, name, email, notes or ratings, so a /p/ link says
// nothing about who made it.
//
// Eventual consistency, as with heardShares.js: a Lambda-style function
// reads Blobs without strong consistency, so a code stored a moment ago may
// take up to a minute to resolve everywhere. The app never reads one back
// (it draws its posters from the record it posts), so only a link opened
// that fast would notice.

const crypto = require('crypto');
const heard = require('./heardRecord');
const { escapeHtml, page, formatShowDate, SITE_URL } = require('./publicPageHtml');
const { STYLE } = require('./heardPages');

const STORE_NAME = 'my-posters';
const CODE = /^[A-Za-z0-9_-]{12}$/;
const KINDS = { og: 'card', 'poster-feed': 'feed', 'poster-story': 'story' };
const ARCHIVE_NOTE = "Rarest catches and bust-outs are available for bands with a full setlist archive: Goose, Phish, Umphrey's McGee and King Gizzard.";

function openPosterStore(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  connectLambda(event);
  const store = getStore({ name: STORE_NAME });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: (key, value) => store.setJSON(key, value),
  };
}

/** 12 random base64url characters (72 bits). */
const newCode = () => crypto.randomBytes(9).toString('base64url');

const posterPath = (code) => `/p/${code}/`;
const posterImagePath = (code, kind) => `${posterPath(code)}${kind === 'card' ? 'og' : `poster-${kind}`}.png`;
const myPosterPath = (name) => `/my-poster/?artist=${encodeURIComponent(name)}`;

/** Stores a cleaned record under a new code; resolves the code. */
async function storeRecord(store, record, now = Date.now()) {
  const code = newCode();
  await store.set(code, { record, createdAt: new Date(now).toISOString() });
  return code;
}

/** The record a code names, cleaned again on the way out, or null. */
async function loadRecord(store, code) {
  if (!CODE.test(String(code || ''))) return null;
  const saved = await store.get(code);
  return saved ? heard.cleanPersonalRecord(saved.record) : null;
}

// ── /p/<code>/ ────────────────────────────────────────────────────────

const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const date = (d) => (d ? formatShowDate(d, 'short') : '');

function songTables(record) {
  const parts = [];
  if (record.top.length) {
    parts.push(`<h2>Most heard</h2><table><thead><tr><th>Song</th><th class="num">Heard</th></tr></thead><tbody>${record.top
      .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="num">${s.count}&times;</td></tr>`).join('')}</tbody></table>`);
  }
  if (record.songs.length) {
    parts.push(`<details><summary>Every song heard (${num(record.songs.length)})</summary><table style="margin-top:10px"><thead><tr><th>Song</th><th class="num">Heard</th><th class="num">First</th><th class="num">Last</th></tr></thead><tbody>${record.songs
      .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="num">${s.count}&times;</td><td class="num">${escapeHtml(date(s.firstHeard))}</td><td class="num">${escapeHtml(date(s.lastHeard))}</td></tr>`).join('')}</tbody></table></details>`);
  }
  return parts.join('');
}

/** The shared record page. Personal: noindex, never cached as anyone's but this code's. */
function renderPosterPage(record, code) {
  const headline = heard.headline(record.name, record);
  const span = heard.yearSpan(record);
  const stats = [
    [num(record.shows), record.shows === 1 ? 'Show' : 'Shows'],
    [num(record.uniqueSongs), 'Songs'],
    [num(record.totalSongs), 'Performances'],
    [num(record.venues), record.venues === 1 ? 'Venue' : 'Venues'],
    [span || '–', 'Years'],
  ];
  const first = record.firstShow;
  const last = record.lastShow;
  const showsLine = first
    ? (first.date === last.date
      ? `: ${escapeHtml(date(first.date))}${first.venue ? ` at ${escapeHtml(first.venue)}` : ''}`
      : `: first ${escapeHtml(date(first.date))}${first.venue ? ` at ${escapeHtml(first.venue)}` : ''}, latest ${escapeHtml(date(last.date))}${last.venue ? ` at ${escapeHtml(last.venue)}` : ''}`)
    : '';

  const bodyHtml = `
    <h1>${escapeHtml(headline)}</h1>
    <p class="sub">Every ${escapeHtml(record.name)} song heard live at ${plural(record.shows, 'show')}${span ? `, ${escapeHtml(span)}` : ''}${showsLine}.</p>
    <div class="stats">${stats.map(([v, l]) => `<div class="stat"><div class="n${v.length > 6 ? ' sm' : ''}">${escapeHtml(v)}</div><div class="l">${l}</div></div>`).join('')}</div>
    <p><img src="${SITE_URL}${posterImagePath(code, 'feed')}" alt="${escapeHtml(headline)}" width="540" height="675" style="width:100%;max-width:540px;height:auto;border-radius:12px;display:block;" loading="lazy"></p>
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">How many ${escapeHtml(record.name)} songs have you heard?</p>
      <p class="note" style="margin:0 0 10px;">Log your shows on MySetlists and make your own poster from them. Free.</p>
      <a class="btn" href="${SITE_URL}${myPosterPath(record.name)}">Make your own</a>
    </div>
    ${songTables(record)}
    <p class="source">${escapeHtml(heard.PERSONAL_CREDIT)}. ${escapeHtml(ARCHIVE_NOTE)}</p>
  `;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A stored record never changes.
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
      'X-Robots-Tag': 'noindex, follow',
    },
    body: page({
      title: `${headline} | MySetlists`,
      description: `${headline}. Most heard: ${record.top.slice(0, 3).map((s) => s.name).join(', ') || 'nothing yet'}. Make your own on MySetlists.`,
      canonicalPath: posterPath(code),
      ogImage: `${SITE_URL}${posterImagePath(code, 'card')}`,
      bodyHtml,
      extraStyle: STYLE,
      robots: 'noindex, follow',
    }),
  };
}

module.exports = {
  STORE_NAME,
  CODE,
  KINDS,
  ARCHIVE_NOTE,
  openPosterStore,
  newCode,
  posterPath,
  posterImagePath,
  storeRecord,
  loadRecord,
  renderPosterPage,
};
