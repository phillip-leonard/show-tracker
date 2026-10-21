// netlify/functions/lib/heardPages.js
//
// The "Songs I've heard" pages, rendered by public-heard.js from the band
// show lists (publicArtistSnapshot.js's shows/<slug>.json):
//
//   /heard/                   pick a band                    indexable
//   /heard/<slug>/            the tool: tick shows, see the  indexable
//                             record live, poster, share
//   /heard/<slug>/r/<code>/   a shared record, rendered      noindex
//                             here, with a preview image
//
// The tool itself runs in the browser: heardRecord.js's createHeard and
// heardClient.js's createHeardApp are inlined into the page, and the show
// list comes from /api/artist-shows. The HTML around it is real content
// (what the tool does, the band's most played songs, where the data comes
// from) so a crawler sees a page, not a spinner.
//
// Nothing here is in out/ or the iOS bundle.

const { escapeHtml, page, formatShowDate, SITE_URL } = require('./publicPageHtml');
const { availability, cacheHeaders } = require('./publicArtistSnapshot');
const { unavailablePage, bandPath, songPath } = require('./publicArtistPages');
const heard = require('./heardRecord');
const { createHeardApp } = require('./heardClient');

const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

const heardPath = (slug) => (slug ? `/heard/${slug}/` : '/heard/');
const sharePath = (slug, code) => `/heard/${slug}/r/${code}/`;
const imagePath = (slug, code, kind) => `${sharePath(slug, code)}${kind === 'card' ? 'og' : `poster-${kind}`}.png`;

/** "Setlists courtesy of elgoose.net": on every page and every poster. */
const heardCredit = (shows) => heard.credit(shows);

const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const date = (d) => (d ? formatShowDate(d, 'short') : '');

// The public pages are dark; these follow the visitor's light or dark
// setting, since people land on them from wherever they shared a poster.
const STYLE = `
  :root { --bg: #1f1f3a; --fg: #f4f3fb; --muted: #b7b6c9; --card: rgba(255,255,255,0.05); --card-strong: rgba(255,255,255,0.09); --line: rgba(255,255,255,0.1); --link: #f5c451; --mint: #10d98a; --amber: #ffb700; --btn-fg: #1f1f3a; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --bg: #f6f6fa; --fg: #1f1f3a; --muted: #57566f; --card: #ffffff; --card-strong: #ececf4; --line: rgba(31,31,58,0.13); --link: #8a5a00; --mint: #047857; --amber: #b07800; }
  }
  body { background: var(--bg); color: var(--fg); }
  a { color: var(--link); }
  .brand { color: var(--link); }
  .sub, .note, .crumbs, .crumbs a, .stat .l, .footer, .footer a { color: var(--muted); }
  .stat, .show { background: var(--card); }
  .cta { background: var(--card); border: 1px solid var(--line); }
  .crumbs { font-size: 13px; margin: -12px 0 18px; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  h3 { font-size: 15px; margin: 22px 0 8px; }
  .stat .n.sm { font-size: 15px; line-height: 1.35; }
  .note { font-size: 13px; }
  .source { margin-top: 28px; font-size: 13px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding: 0 8px 8px 0; }
  td { padding: 8px 8px 8px 0; border-top: 1px solid var(--line); vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; padding-right: 0; padding-left: 10px; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; line-height: 16px; color: var(--muted); white-space: nowrap; vertical-align: 1px; }
  .btn { display: inline-block; padding: 11px 18px; border-radius: 999px; background: var(--amber); color: var(--btn-fg); font-weight: 700; font-size: 15px; border: 0; cursor: pointer; font-family: inherit; text-decoration: none; }
  .btn:hover { text-decoration: none; filter: brightness(1.05); }
  .btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
  .btn[disabled] { opacity: 0.5; cursor: default; }
  .bands { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .bands a { display: block; padding: 16px 18px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
  .bands .name { font-weight: 800; font-size: 17px; color: var(--fg); }
  .bands .meta { font-size: 13px; color: var(--muted); }
  ol.songs { margin: 0; padding-left: 22px; font-size: 14px; }
  ol.songs li { padding: 3px 0; }
  details { margin-top: 10px; }
  summary { cursor: pointer; font-weight: 700; }
  .faq h3 { margin-top: 18px; }
  .faq p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
`;

// The tool page is wider than the other public pages: the show list and
// the record sit side by side on a desktop.
const TOOL_STYLE = `
  .wrap { max-width: 1120px; }
  .heard-intro { max-width: 720px; }
  #heard-app { margin-top: 8px; }
  .h-layout { display: grid; gap: 28px; }
  @media (min-width: 960px) { .h-layout { grid-template-columns: minmax(0, 1fr) 420px; align-items: start; } .h-results { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; } }
  .h-panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
  .h-controls { display: grid; gap: 10px; grid-template-columns: 1fr; margin-bottom: 12px; }
  @media (min-width: 560px) { .h-controls { grid-template-columns: 1fr 140px 1fr; } }
  .h-controls input, .h-controls select, .h-import input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card-strong); color: var(--fg); font: inherit; font-size: 15px; }
  .h-bar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .h-bar button, .h-link { background: none; border: 0; color: var(--link); font: inherit; cursor: pointer; padding: 6px 0; }
  .h-year { margin-top: 14px; }
  .h-year > h3 { display: flex; justify-content: space-between; margin: 0 0 6px; padding: 8px 0; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
  .h-year > h3 span { font-weight: 500; color: var(--muted); font-size: 13px; }
  .h-show { display: grid; grid-template-columns: 28px 92px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--line); font-size: 14px; }
  .h-show input { width: 20px; height: 20px; accent-color: #10b981; margin: 0; }
  .h-show label { display: contents; cursor: pointer; }
  .h-show .d { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
  .h-show .v { min-width: 0; }
  .h-show .v b { font-weight: 600; }
  .h-show .v small { display: block; color: var(--muted); font-size: 12px; }
  .h-show .run { font-size: 12px; white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: none; color: var(--link); cursor: pointer; font-family: inherit; }
  .h-show.on { background: rgba(16,185,129,0.1); }
  .h-show.noset .v b::after { content: " · no setlist known"; font-weight: 400; color: var(--muted); font-size: 12px; }
  .h-import { display: flex; gap: 8px; margin-top: 8px; }
  .h-import input { flex: 1; }
  .h-msg { font-size: 13px; color: var(--muted); margin: 8px 0 0; }
  .h-msg.err { color: #e05555; }
  .h-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 4px 0 6px; }
  .h-stats .stat { padding: 10px; }
  .h-stats .stat .n { font-size: 20px; }
  .h-results h2 { margin: 22px 0 8px; font-size: 16px; }
  .h-results h2:first-child { margin-top: 0; }
  .h-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .h-sort { font-size: 12px; color: var(--muted); }
  .h-sort button { background: none; border: 0; color: var(--link); cursor: pointer; font: inherit; padding: 4px; }
  .h-sort button[aria-pressed="true"] { color: var(--fg); font-weight: 700; }
  .h-posters { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .h-posters img { width: 100%; border-radius: 10px; border: 1px solid var(--line); display: block; background: #1f1f3a; }
  .h-posters figure { margin: 0; }
  .h-posters figcaption { font-size: 12px; color: var(--muted); margin: 6px 0; }
  .h-posters .h-actions { margin-top: 4px; gap: 6px; }
  .h-posters .btn { padding: 8px 12px; font-size: 13px; }
  .h-share input { width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card-strong); color: var(--fg); font-size: 13px; margin-top: 8px; }
  .h-dock { position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; z-index: 5; }
  .h-dock .btn { white-space: nowrap; flex-shrink: 0; }
  .h-dock[hidden] { display: none; }
  @media (max-width: 959px) { .wrap { padding-bottom: 120px; } }
  @media (min-width: 960px) { .h-dock { display: none; } }
  .h-empty { color: var(--muted); font-size: 14px; }
`;

function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items
    .map((c, i) => (i === items.length - 1 ? escapeHtml(c.name) : `<a href="${SITE_URL}${c.path}">${escapeHtml(c.name)}</a>`))
    .join(' &rsaquo; ')}</nav>`;
}

function breadcrumbLd(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${SITE_URL}${c.path}` })),
  };
}

function songLink(slug, s) {
  return `<a href="${SITE_URL}${songPath(slug, s.slug)}">${escapeHtml(s.name)}</a>`;
}

function sourceLine(shows, entry) {
  const a = shows.attribution;
  return `<p class="source">${escapeHtml(heardCredit(shows))}: <a href="${escapeHtml(a.url)}">${escapeHtml(a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>. Updated ${escapeHtml(formatShowDate(entry.fetchedAt.slice(0, 10), 'long'))}.</p>`;
}

function htmlResponse(statusCode, body, headers) {
  return { statusCode, headers: { ...HTML, ...headers }, body };
}

// ── /heard/ ───────────────────────────────────────────────────────────

/** `bands`: [{ entry }] for every band with a published show list. */
function renderHeardIndex(bands, now = Date.now()) {
  const trail = [{ name: 'Home', path: '/' }, { name: "Songs I've heard", path: heardPath() }];
  const shown = bands.filter(({ entry }) => availability(entry, now).available);
  const rows = shown.map(({ entry }) => `
    <li><a href="${SITE_URL}${heardPath(entry.slug)}">
      <div class="name">${escapeHtml(entry.name)}</div>
      <div class="meta">${plural(entry.totalShows, 'show')} to pick from · ${plural(entry.songCount, 'song')}</div>
    </a></li>`).join('');

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>How many songs have you heard live?</h1>
    <p class="sub">Pick a band, tick the shows you were at, and see every song you've heard live: how many times, your rarest catches, the bust-outs you were there for and the songs you're still chasing. Then make a poster and share it. Free, and no account needed.</p>
    ${rows ? `<ul class="bands">${rows}</ul>` : '<p class="sub">No bands yet. Check back soon.</p>'}
    <p class="note" style="margin-top:16px;">More bands coming. These four come from their fans' own archives, which have every setlist back to the first show.</p>
    <div class="faq">
      <h2>How it works</h2>
      <h3>Where do the setlists come from?</h3>
      <p>From each band's fan archive: elgoose.net for Goose, Phish.net for Phish, All Things Umphrey's for Umphrey's McGee and kglw.net for King Gizzard &amp; the Lizard Wizard. We refresh them every day.</p>
      <h3>Do I need an account?</h3>
      <p>No. Your picks stay in your browser. If you want to keep them, you can save the shows to a free MySetlists account in one step.</p>
    </div>
    <div class="cta">
      <p style="margin:0 0 8px;">Track every show you've been to, for every band.</p>
      <a class="btn" href="${SITE_URL}/?signup=1">Start tracking free</a>
    </div>
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        itemListElement: shown.map(({ entry }, i) => ({ '@type': 'ListItem', position: i + 1, name: `${entry.name}: songs I've heard`, url: `${SITE_URL}${heardPath(entry.slug)}` })),
      },
      breadcrumbLd(trail),
    ],
  };

  return htmlResponse(200, page({
    title: "How Many Songs Have You Heard Live? Goose, Phish & More | MySetlists",
    description: `Tick the shows you've been to and see every song you've heard live, with your rarest catches and bust-outs, then share a poster. Free for ${shown.map(({ entry }) => entry.name).join(', ')}.`,
    canonicalPath: heardPath(),
    jsonLd,
    bodyHtml,
    extraStyle: STYLE,
  }), { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}

// ── /heard/<slug>/ ────────────────────────────────────────────────────

// What the browser script needs. Kept small: the show list itself comes
// from /api/artist-shows.
function bootData(shows) {
  return {
    slug: shows.slug,
    name: shows.name,
    credit: heardCredit(shows),
    siteUrl: SITE_URL,
    showsApi: `/api/artist-shows?slug=${encodeURIComponent(shows.slug)}`,
    importApi: '/api/heard-import',
    shareApi: '/api/heard-share',
    toolPath: heardPath(shows.slug),
    songPath: `/artist/${shows.slug}/song/`,
    saveUrl: `${SITE_URL}/shows/?signup=1&heard=`,
  };
}

const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function toolScript(shows) {
  return `<script>
(function () {
  var Heard = (${heard.createHeard.toString()})();
  (${createHeardApp.toString()})(Heard, ${scriptJson(bootData(shows))});
})();
</script>`;
}

function renderHeardBand({ entry, shows }, now = Date.now()) {
  if (!availability(entry, now).available) return unavailablePage(shows);
  const { name, slug } = shows;
  const trail = [{ name: 'Home', path: '/' }, { name: "Songs I've heard", path: heardPath() }, { name, path: heardPath(slug) }];
  const mostPlayed = shows.songs
    .filter(heard.isSong)
    .slice()
    .sort((a, b) => b.timesPlayed - a.timesPlayed || a.name.localeCompare(b.name))
    .slice(0, 10);
  const first = shows.shows[0];
  const last = shows.shows[shows.shows.length - 1];
  const years = first && last ? `${first.date.slice(0, 4)} to ${last.date.slice(0, 4)}` : '';

  const bodyHtml = `
    ${crumbs(trail)}
    <div class="heard-intro">
      <h1>How many times have you heard ${escapeHtml(name)} songs live?</h1>
      <p class="sub">Tick the ${escapeHtml(name)} shows you were at and see every song you've heard live: how many times, your rarest catches, the bust-outs you witnessed and the songs you're still chasing. Then download a poster or share your record. Free, and no account needed.</p>
    </div>
    <div id="heard-app" aria-live="polite">
      <p class="note">Loading all ${plural(shows.shows.length, `${name} show`)}…</p>
      <noscript><p class="note">The show picker needs JavaScript. Every ${escapeHtml(name)} setlist is on <a href="${escapeHtml(shows.attribution.url)}">${escapeHtml(shows.sourceName)}</a>.</p></noscript>
    </div>

    <div class="heard-intro">
      <h2>Most played ${escapeHtml(name)} songs</h2>
      <p class="note">${escapeHtml(name)} has played ${plural(shows.totalShows, 'show')}${years ? ` from ${escapeHtml(years)}` : ''}. How many of these have you heard?</p>
      <ol class="songs">${mostPlayed.map((s) => `<li>${songLink(slug, s)} <span class="note">· ${plural(s.timesPlayed, 'time')}</span></li>`).join('')}</ol>
      <p><a href="${SITE_URL}${bandPath(slug)}">Every ${escapeHtml(name)} song, with gaps and bust-outs &rarr;</a></p>

      <div class="faq">
        <h2>How it works</h2>
        <h3>How are songs counted?</h3>
        <p>A song played twice at one show (a reprise or a sandwich) counts once for that show. "Performances" counts every time a song was played at your shows. A bust-out is a song played after 50 or more shows away, counted the way ${escapeHtml(shows.sourceName)} counts it.</p>
        <h3>Where does the data come from?</h3>
        <p>${escapeHtml(heardCredit(shows))}, refreshed ${shows.source === 'phishnet' ? 'every few hours' : 'every day'}.</p>
        <h3>Is my list saved?</h3>
        <p>In this browser, yes, and nowhere else. A share link holds only which shows you picked, never your name. To keep your shows for good, save them to a free MySetlists account.</p>
        <h3>Can I import my setlist.fm attendance?</h3>
        <p>Yes. Enter your setlist.fm username and we tick every ${escapeHtml(name)} show you've marked "I was there".</p>
      </div>
      ${sourceLine(shows, entry)}
    </div>
    <div class="h-dock" id="heard-dock" hidden></div>
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: `How many ${name} songs have you heard?`,
        url: `${SITE_URL}${heardPath(slug)}`,
        applicationCategory: 'EntertainmentApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        about: { '@type': 'MusicGroup', name, url: `${SITE_URL}${bandPath(slug)}` },
      },
      breadcrumbLd(trail),
    ],
  };

  return htmlResponse(200, page({
    title: `How many times have you heard ${name} songs live? | MySetlists`,
    description: `Tick the ${name} shows you've been to and count every ${name} song you've heard live, with your rarest catches, bust-outs and the songs you're still chasing. Free poster, no account needed.`,
    canonicalPath: heardPath(slug),
    jsonLd,
    bodyHtml,
    extraStyle: STYLE + TOOL_STYLE,
    scriptHtml: toolScript(shows),
  }), cacheHeaders(entry, now));
}

// ── /heard/<slug>/r/<code>/ ───────────────────────────────────────────

function recordTables(slug, record) {
  const songRows = (list, extra) => list.map((s) => `<tr><td>${songLink(slug, s)}${s.isOriginal === false ? '<span class="tag">Cover</span>' : ''}</td>${extra(s)}</tr>`).join('');
  const parts = [];
  if (record.top.length) {
    parts.push(`<h2>Most heard</h2><table><thead><tr><th>Song</th><th class="num">Heard</th></tr></thead><tbody>${songRows(record.top, (s) => `<td class="num">${s.count}&times;</td>`)}</tbody></table>`);
  }
  if (record.rarest.length) {
    parts.push(`<h2>Rarest catches</h2><p class="note">The songs heard here that the band has played the fewest times.</p><table><thead><tr><th>Song</th><th class="num">Played ever</th></tr></thead><tbody>${songRows(record.rarest, (s) => `<td class="num">${num(s.timesPlayed)}</td>`)}</tbody></table>`);
  }
  if (record.bustOuts.length) {
    parts.push(`<h2>Bust-outs witnessed</h2><table><thead><tr><th>Song</th><th class="num">Gap</th><th class="num">Show</th></tr></thead><tbody>${songRows(record.bustOuts, (s) => `<td class="num">${num(s.gap)}</td><td class="num">${escapeHtml(date(s.show.date))}</td>`)}</tbody></table>`);
  }
  if (record.debuts.length) {
    parts.push(`<h2>Debuts witnessed</h2><table><thead><tr><th>Song</th><th class="num">Show</th></tr></thead><tbody>${songRows(record.debuts.slice(0, 25), (s) => `<td class="num">${escapeHtml(date(s.show.date))}</td>`)}</tbody></table>`);
  }
  if (record.chasing.length) {
    parts.push(`<h2>Still chasing</h2><p class="note">The band's most played originals not heard yet.</p><ol class="songs">${record.chasing.map((s) => `<li>${songLink(slug, s)} <span class="note">· played ${plural(s.timesPlayed, 'time')}</span></li>`).join('')}</ol>`);
  }
  if (record.songs.length) {
    parts.push(`<details><summary>Every song heard (${num(record.songs.length)})</summary><table style="margin-top:10px"><tbody>${songRows(record.songs, (s) => `<td class="num">${s.count}&times;</td>`)}</tbody></table></details>`);
  }
  return parts.join('');
}

/**
 * A shared record. `code` is the code in the URL (inline 'a…' or stored
 * 'b…'); `ids` are the shows it names, already resolved by the function.
 */
function renderHeardShare({ entry, shows }, code, ids, now = Date.now()) {
  if (!availability(entry, now).available) return unavailablePage(shows);
  const { name, slug } = shows;
  const record = heard.buildRecord(shows, ids);
  const headline = heard.headline(name, record);
  const span = heard.yearSpan(record);
  const stats = [
    [num(record.shows), record.shows === 1 ? 'Show' : 'Shows'],
    [num(record.uniqueSongs), 'Songs'],
    [num(record.totalSongs), 'Performances'],
    [num(record.venues), record.venues === 1 ? 'Venue' : 'Venues'],
    [span || '–', 'Years'],
  ];

  const bodyHtml = `
    <h1>${escapeHtml(headline)}</h1>
    <p class="sub">Every ${escapeHtml(name)} song heard live at ${plural(record.shows, 'show')}${span ? `, ${escapeHtml(span)}` : ''}${record.firstShow ? `: first ${escapeHtml(date(record.firstShow.date))} at ${escapeHtml(record.firstShow.venue)}, latest ${escapeHtml(date(record.lastShow.date))} at ${escapeHtml(record.lastShow.venue)}` : ''}.</p>
    <div class="stats">${stats.map(([v, l]) => `<div class="stat"><div class="n${v.length > 6 ? ' sm' : ''}">${escapeHtml(v)}</div><div class="l">${l}</div></div>`).join('')}</div>
    <p><img src="${SITE_URL}${imagePath(slug, code, 'feed')}" alt="${escapeHtml(headline)}" width="540" height="675" style="width:100%;max-width:540px;height:auto;border-radius:12px;display:block;" loading="lazy"></p>
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">How many ${escapeHtml(name)} songs have you heard?</p>
      <p class="note" style="margin:0 0 10px;">Tick your shows and get your own record and poster. Free, no account needed.</p>
      <a class="btn" href="${SITE_URL}${heardPath(slug)}">Make your own</a>
    </div>
    ${recordTables(slug, record)}
    ${sourceLine(shows, entry)}
  `;

  const avail = cacheHeaders(entry, now)['Cache-Control'];
  return htmlResponse(200, page({
    title: `${headline} | MySetlists`,
    description: `${headline}. Most heard: ${record.top.slice(0, 3).map((s) => s.name).join(', ') || 'nothing yet'}. Make your own ${name} record on MySetlists.`,
    canonicalPath: sharePath(slug, code),
    ogImage: `${SITE_URL}${imagePath(slug, code, 'card')}`,
    bodyHtml,
    extraStyle: STYLE,
    robots: 'noindex, follow',
  }), { 'Cache-Control': avail, 'X-Robots-Tag': 'noindex, follow' });
}

// ── /api/artist-shows?slug=&code= ─────────────────────────────────────

/**
 * The shows a share code names, each with its setlist in the app's shape
 * ({ name, set, cover }), for the app's "Save these shows" handoff
 * (components/heard/HeardSaveModal.jsx). `code` is already resolved (an
 * inline code, never a stored id).
 */
function selectedShowsJson({ entry, shows }, code, now = Date.now()) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
  if (!availability(entry, now).available) {
    return { statusCode: 503, headers: { ...headers, 'Cache-Control': 'public, s-maxage=60' }, body: JSON.stringify({ ok: false, error: 'unavailable' }) };
  }
  const decoded = heard.decodeSelection(shows, code);
  if (!decoded) return { statusCode: 404, headers: { ...headers, 'Cache-Control': 'public, s-maxage=300' }, body: JSON.stringify({ ok: false, error: 'not_found' }) };
  const wanted = new Set(decoded.ids);
  const selected = shows.shows.filter((s) => wanted.has(s.id)).map((show) => {
    const [venue, city] = shows.venues[show.venue] || ['', ''];
    const setlist = [];
    for (const [set, songs] of show.sets) {
      for (const [index] of songs) {
        const song = shows.songs[index];
        if (song) setlist.push({ name: song.name, set, cover: song.isOriginal === false ? (song.originalArtist || null) : null });
      }
    }
    return { id: show.id, date: show.date, venue, city, tour: show.tour >= 0 ? shows.tours[show.tour] : '', url: show.url ? shows.urlBase + show.url : '', setlist };
  });
  return {
    statusCode: 200,
    headers: { ...headers, ...cacheHeaders(entry, now) },
    body: JSON.stringify({ ok: true, artist: { slug: shows.slug, name: shows.name, sourceName: shows.sourceName }, shows: selected, missing: decoded.missing }),
  };
}

module.exports = {
  selectedShowsJson,
  heardPath,
  sharePath,
  imagePath,
  heardCredit,
  renderHeardIndex,
  renderHeardBand,
  renderHeardShare,
  STYLE,
};
