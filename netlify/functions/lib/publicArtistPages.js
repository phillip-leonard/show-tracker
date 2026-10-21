// netlify/functions/lib/publicArtistPages.js
//
// Renders the public artist pages from a snapshot loaded by
// publicArtistSnapshot.js: the band page, the song page, the /artists
// index, and the "temporarily unavailable" state for phish.net data past
// 24 hours. Also builds the /api/artist and /api/artist-song JSON from the
// same loaded snapshot, so the HTML and the JSON can never disagree.
//
// Each function returns a complete Netlify response. Plain HTML through
// publicPageHtml.page(), same shell as the /u/ pages.

const { escapeHtml, page, notFoundPage, formatShowDate, SITE_URL } = require('./publicPageHtml');
const { availability, cacheHeaders, UNAVAILABLE_CACHE_HEADERS } = require('./publicArtistSnapshot');

const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

const EXTRA_STYLE = `
  .crumbs { font-size: 13px; color: #b7b6c9; margin: -12px 0 18px; }
  .crumbs a { color: #b7b6c9; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  .stat .n.sm { font-size: 15px; line-height: 1.35; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; color: #b7b6c9; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding: 0 8px 8px 0; }
  td { padding: 9px 8px 9px 0; border-top: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; padding-right: 0; padding-left: 10px; }
  .note { font-size: 13px; color: #b7b6c9; }
  .source { margin-top: 28px; font-size: 13px; color: #b7b6c9; }
  .cta a.btn { display: inline-block; margin-top: 6px; padding: 10px 18px; border-radius: 999px; background: #f5c451; color: #1f1f3a; font-weight: 700; }
  .artists { list-style: none; padding: 0; margin: 0; }
  .artists li { margin-bottom: 8px; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border: 1px solid rgba(255,255,255,0.25); border-radius: 999px; font-size: 11px; line-height: 16px; color: #b7b6c9; white-space: nowrap; vertical-align: 1px; }
`;

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
const date = (d) => (d ? formatShowDate(d, 'short') : '');
const longDate = (d) => (d ? formatShowDate(d, 'long') : '');

const bandPath = (slug) => `/artist/${slug}/`;
const songPath = (slug, songSlug) => `/artist/${slug}/song/${songSlug}/`;

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

function sourceLine(snapshot, updated) {
  const a = snapshot.attribution;
  return `<p class="source">${escapeHtml(a.text)}: <a href="${escapeHtml(a.url)}">${escapeHtml(a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>. Updated ${escapeHtml(longDate(updated.slice(0, 10)))}.</p>`;
}

function showLink(show) {
  const text = `${escapeHtml(show.venue)}${show.city ? `, ${escapeHtml(show.city)}` : ''}`;
  return show.url ? `<a href="${escapeHtml(show.url)}">${text}</a>` : text;
}

function showRows(shows) {
  return `<table><thead><tr><th>Date</th><th>Venue</th></tr></thead><tbody>${shows
    .map((s) => `<tr><td style="white-space:nowrap">${escapeHtml(date(s.date))}</td><td>${showLink(s)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function songName(artistSlug, s) {
  return s.hasPage ? `<a href="${SITE_URL}${songPath(artistSlug, s.slug)}">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
}

function datedLink(show) {
  const text = escapeHtml(date(show.date));
  return show.url ? `<a href="${escapeHtml(show.url)}">${text}</a>` : text;
}

// "Original", "Cover (by The Band)", "Cover", or '' when the source doesn't say.
function songKind(song) {
  if (song.isOriginal === true) return 'Original';
  if (song.isOriginal !== false) return '';
  return song.originalArtist ? `Cover (by ${escapeHtml(song.originalArtist)})` : 'Cover';
}

function gapText(n) {
  return n === 0 ? 'played at the most recent show' : `${plural(n, 'show')} since last played`;
}

// ── Responses shared by every page ────────────────────────────────────

function notFound(message) {
  return { statusCode: 404, headers: { ...HTML, 'Cache-Control': 'public, s-maxage=300' }, body: notFoundPage(message) };
}

function unavailablePage(snapshotOrEntry) {
  const name = snapshotOrEntry.name;
  const body = `
    <h1>${escapeHtml(name)} data is temporarily unavailable</h1>
    <p class="sub">Our copy of the ${escapeHtml(name)} setlist data is out of date, and Phish.net's terms let us show it for 24 hours after we fetch it. It will be back after the next update.</p>
    <p>In the meantime, every ${escapeHtml(name)} setlist is on <a href="https://phish.net/">Phish.net</a>.</p>
    <div class="cta"><a href="${SITE_URL}/artists/">Browse other bands</a></div>`;
  return {
    statusCode: 503,
    headers: { ...HTML, ...UNAVAILABLE_CACHE_HEADERS, 'Retry-After': '3600' },
    body: page({ title: `${name} – Temporarily Unavailable | MySetlists`, description: `${name} setlist data is temporarily unavailable.`, canonicalPath: bandPath(snapshotOrEntry.slug), bodyHtml: body, extraStyle: EXTRA_STYLE }),
  };
}

// ── Band page ─────────────────────────────────────────────────────────

function bandIntro(snapshot) {
  const { band, coverage, name, sourceName } = snapshot;
  const span = band.firstShow && band.lastShow
    ? ` from ${longDate(band.firstShow.date)} to ${longDate(band.lastShow.date)}`
    : '';
  if (coverage.kind === 'window' && coverage.shows < band.totalShows) {
    return `${escapeHtml(name)} has ${plural(band.totalShows, 'show')} on setlist.fm${escapeHtml(span)}. The song stats below cover the ${plural(coverage.shows, 'most recent setlist', 'most recent setlists')} there, ${escapeHtml(longDate(coverage.from))} to ${escapeHtml(longDate(coverage.to))}.`;
  }
  if (coverage.kind === 'window') {
    return `Every ${escapeHtml(name)} setlist on setlist.fm${escapeHtml(span)}: ${plural(band.totalShows, 'show')} and ${plural(band.songCount, 'song')}, with how often each song is played and how long since it last was.`;
  }
  // Shows with no known setlist count too (the archive counts them in its
  // gaps); say so when there are any.
  const unknown = band.totalShows - coverage.shows;
  return `Every ${escapeHtml(name)} show on ${escapeHtml(sourceName)}${escapeHtml(span)}: ${plural(band.totalShows, 'show')}${unknown > 0 ? ` (${plural(unknown, 'show')} with no known setlist)` : ''} and ${plural(band.songCount, 'song')}, with how often each song is played and how long since it last was.`;
}

function renderBand({ entry, snapshot }, now = Date.now()) {
  if (!availability(entry, now).available) return unavailablePage(snapshot);
  const { band, name, slug, coverage } = snapshot;
  const trail = [{ name: 'Home', path: '/' }, { name: 'Artists', path: '/artists/' }, { name, path: bandPath(slug) }];

  const top = band.mostPlayed[0];
  const title = `${name} Setlists, Song Stats & Gaps | MySetlists`;
  // A version 1 snapshot (written before the original/cover split) has
  // none of these; its page shows what it can until the next run.
  const originalGaps = band.originalGapLeaders || [];
  const coverGaps = band.coverGapLeaders || [];
  const bustOuts = band.bustOuts || [];

  const description = coverage.kind === 'window'
    ? `${name} setlists and song stats: ${band.totalShows.toLocaleString('en-US')} shows on setlist.fm, the most played songs${top ? ` (${top.name}, ${top.timesPlayed} times in the last ${coverage.shows} setlists)` : ''} and the longest current gaps. Track your ${name} shows on MySetlists.`
    : `${name} setlists and song stats: ${band.totalShows.toLocaleString('en-US')} shows since ${band.firstShow.date.slice(0, 4)}, the most played songs${top ? ` (${top.name}, ${top.timesPlayed} times)` : ''}, the longest current gaps and the biggest bust-outs. Track your ${name} shows on MySetlists.`;

  const stats = `
    <div class="stats">
      <div class="stat"><div class="n">${band.totalShows.toLocaleString('en-US')}</div><div class="l">Shows</div></div>
      <div class="stat"><div class="n">${band.songCount.toLocaleString('en-US')}</div><div class="l">Songs${coverage.kind === 'window' && coverage.shows < band.totalShows ? ' (recent)' : ''}</div></div>
      <div class="stat"><div class="n sm">${escapeHtml(date(band.firstShow?.date))}</div><div class="l">First show</div></div>
      <div class="stat"><div class="n sm">${escapeHtml(date(band.lastShow?.date))}</div><div class="l">Last show</div></div>
    </div>`;

  const mostPlayed = band.mostPlayed.length ? `
    <h2>Most played ${escapeHtml(name)} songs</h2>
    <table><thead><tr><th>#</th><th>Song</th><th class="num">Times played</th></tr></thead><tbody>${band.mostPlayed
      .map((s, i) => `<tr><td>${i + 1}</td><td>${songName(slug, s)}${s.isOriginal === false ? '<span class="tag">Cover</span>' : ''}</td><td class="num">${s.timesPlayed.toLocaleString('en-US')}</td></tr>`)
      .join('')}</tbody></table>` : '';

  const inWindow = coverage.kind === 'window' ? ' in these setlists' : '';
  const gapTable = (heading, note, list) => (list.length ? `
    <h2>${heading}</h2>
    <p class="note">${note}</p>
    <table><thead><tr><th>Song</th><th class="num">Shows since</th><th class="num">Last played</th></tr></thead><tbody>${list
      .map((s) => `<tr><td>${songName(slug, s)}</td><td class="num">${s.currentGap.toLocaleString('en-US')}</td><td class="num">${escapeHtml(date(s.lastPlayed))}</td></tr>`)
      .join('')}</tbody></table>` : '');

  const originalGapLeaders = gapTable(
    `${escapeHtml(name)} songs with the longest gaps`,
    `${escapeHtml(name)} originals played at least 5 times${inWindow}, by shows since they were last played.`,
    originalGaps,
  );
  const coverGapLeaders = gapTable(
    `${escapeHtml(name)} covers with the longest gaps`,
    `Covers played at least 5 times${inWindow}, by shows since ${escapeHtml(name)} last played them.`,
    coverGaps,
  );

  const bustOutTable = bustOuts.length ? `
    <h2>Biggest ${escapeHtml(name)} bust-outs</h2>
    <p class="note">${escapeHtml(name)} originals that went the most shows without being played. The gap counts every ${escapeHtml(name)} show from the one after it was last played through the bust-out, as ${escapeHtml(snapshot.sourceName)} does.</p>
    <table><thead><tr><th>Song</th><th class="num">Gap</th><th class="num">Last played</th><th class="num">Bust-out</th></tr></thead><tbody>${bustOuts
      .map((s) => `<tr><td>${songName(slug, s)}</td><td class="num">${s.longestGap.toLocaleString('en-US')}</td><td class="num">${datedLink(s.gapStart)}</td><td class="num">${datedLink(s.gapEnd)}</td></tr>`)
      .join('')}</tbody></table>` : '';

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>${escapeHtml(name)} setlists, song stats &amp; show tracker</h1>
    <p class="sub">${bandIntro(snapshot)}</p>
    ${stats}
    ${mostPlayed}
    ${originalGapLeaders}
    ${coverGapLeaders}
    ${bustOutTable}
    <h2>Recent ${escapeHtml(name)} shows</h2>
    ${showRows(band.recentShows)}
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">Track your ${escapeHtml(name)} shows</p>
      <p class="note" style="margin:0 0 8px;">Log the shows you've been to and see every song you've heard live, your own gaps and your stats.</p>
      <a class="btn" href="${SITE_URL}/">Start tracking free</a>
    </div>
    ${sourceLine(snapshot, entry.fetchedAt)}
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'MusicGroup',
        name,
        url: `${SITE_URL}${bandPath(slug)}`,
        sameAs: [snapshot.attribution.url],
      },
      breadcrumbLd(trail),
    ],
  };

  return {
    statusCode: 200,
    headers: { ...HTML, ...cacheHeaders(entry, now) },
    body: page({ title, description, canonicalPath: bandPath(slug), jsonLd, bodyHtml, extraStyle: EXTRA_STYLE }),
  };
}

// ── Song page ─────────────────────────────────────────────────────────

function findSong(snapshot, songSlug) {
  if (!snapshot.songPages) return null;
  return snapshot.songs.find((s) => s.slug === songSlug) || null;
}

function renderSong({ entry, snapshot }, songSlug, now = Date.now()) {
  const song = findSong(snapshot, songSlug);
  if (!song) return notFound('No song at this address.');
  if (!availability(entry, now).available) return unavailablePage(snapshot);

  const { name: band, slug } = snapshot;
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Artists', path: '/artists/' },
    { name: band, path: bandPath(slug) },
    { name: song.name, path: songPath(slug, song.slug) },
  ];
  const isPhish = snapshot.source === 'phishnet';

  const title = `${song.name} – ${band} Song Stats, Gap & Last Played | MySetlists`;
  const description = `${band} has played ${song.name} ${plural(song.timesPlayed, 'time')}, last on ${longDate(song.lastPlayed.date)} at ${song.lastPlayed.venue}${song.currentGap ? `, ${plural(song.currentGap, 'show')} ago` : ''}. First played ${longDate(song.firstPlayed.date)}. Gaps, recent performances and more on MySetlists.`;

  const kind = songKind(song);

  const stats = `
    <div class="stats">
      <div class="stat"><div class="n">${song.timesPlayed.toLocaleString('en-US')}</div><div class="l">Times played</div></div>
      <div class="stat"><div class="n">${song.currentGap.toLocaleString('en-US')}</div><div class="l">Shows since last played</div></div>
      <div class="stat"><div class="n">${song.averageGap == null ? '&ndash;' : song.averageGap}</div><div class="l">Average gap (shows)</div></div>
      <div class="stat"><div class="n">${song.longestGap == null ? '&ndash;' : song.longestGap.toLocaleString('en-US')}</div><div class="l">Longest gap (shows)</div></div>
      <div class="stat"><div class="n sm">${escapeHtml(date(song.firstPlayed.date))}</div><div class="l">First played</div></div>
      <div class="stat"><div class="n sm">${escapeHtml(date(song.lastPlayed.date))}</div><div class="l">Last played</div></div>
      ${kind ? `<div class="stat"><div class="n sm">${kind}</div><div class="l">Song</div></div>` : ''}
    </div>
    ${song.gapStart && song.gapEnd ? `<p class="note">Longest gap ever: ${plural(song.longestGap, 'show')} (${datedLink(song.gapStart)} to ${datedLink(song.gapEnd)}).</p>` : ''}`;

  const sourceLink = song.sourceUrl
    ? `<p class="source">${escapeHtml(song.name)} on ${isPhish ? 'Phish.net' : escapeHtml(snapshot.sourceName)}: <a href="${escapeHtml(song.sourceUrl)}">every performance, jam notes and more</a>.${isPhish ? ' Data courtesy of Phish.net.' : ''}</p>`
    : '';

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>${escapeHtml(song.name)} by ${escapeHtml(band)}: times played, last played &amp; gap</h1>
    <p class="sub">${escapeHtml(band)} has played ${escapeHtml(song.name)} ${plural(song.timesPlayed, 'time')}. It was first played on ${escapeHtml(longDate(song.firstPlayed.date))} at ${showLink(song.firstPlayed)}, and last on ${escapeHtml(longDate(song.lastPlayed.date))} at ${showLink(song.lastPlayed)} (${escapeHtml(gapText(song.currentGap))}).</p>
    ${stats}
    <h2>Recent performances</h2>
    ${showRows(song.recentPerformances)}
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">How many times have you heard ${escapeHtml(song.name)}?</p>
      <p class="note" style="margin:0 0 8px;">Track your shows on MySetlists and see every song you've caught live.</p>
      <a class="btn" href="${SITE_URL}/">Track your shows</a>
    </div>
    <p style="margin-top:24px;"><a href="${SITE_URL}${bandPath(slug)}">&larr; All ${escapeHtml(band)} song stats</a></p>
    ${sourceLink}
    ${sourceLine(snapshot, entry.fetchedAt)}
  `;

  const jsonLd = { '@context': 'https://schema.org', ...breadcrumbLd(trail) };

  return {
    statusCode: 200,
    headers: { ...HTML, ...cacheHeaders(entry, now) },
    body: page({ title, description, canonicalPath: songPath(slug, song.slug), jsonLd, bodyHtml, extraStyle: EXTRA_STYLE }),
  };
}

// ── /artists ──────────────────────────────────────────────────────────

function renderIndex(index, now = Date.now()) {
  const trail = [{ name: 'Home', path: '/' }, { name: 'Artists', path: '/artists/' }];
  const shown = index.artists.filter((e) => availability(e, now).available);
  const rows = shown.map((e) => `
    <li><a class="show" href="${SITE_URL}${bandPath(e.slug)}">
      <div class="artist">${escapeHtml(e.name)}</div>
      <div class="meta">${plural(e.totalShows, 'show')}${e.lastShowDate ? ` · last show ${escapeHtml(date(e.lastShowDate))}` : ''}${e.songPages ? ` · ${plural(e.songCount, 'song page')}` : ''}</div>
    </a></li>`).join('');

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>Band setlists &amp; song stats</h1>
    <p class="sub">Setlists, most played songs and current gaps for ${plural(shown.length, 'band')}, from each band's own fan archive where there is one and from setlist.fm otherwise. Updated daily.</p>
    ${rows ? `<ul class="artists">${rows}</ul>` : '<p class="sub">No bands yet. Check back soon.</p>'}
    <div class="cta">
      <p style="margin:0 0 8px;">Track every show you've been to, and every song you've heard live.</p>
      <a class="btn" href="${SITE_URL}/">Start tracking free</a>
    </div>
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        itemListElement: shown.map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: e.name, url: `${SITE_URL}${bandPath(e.slug)}` })),
      },
      breadcrumbLd(trail),
    ],
  };

  return {
    statusCode: 200,
    headers: { ...HTML, 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    body: page({
      title: 'Band Setlists, Song Stats & Gaps | MySetlists',
      description: `Setlists, song stats and gaps for ${shown.slice(0, 6).map((e) => e.name).join(', ')} and more. Track the shows you've seen on MySetlists.`,
      canonicalPath: '/artists/',
      jsonLd,
      bodyHtml,
      extraStyle: EXTRA_STYLE,
    }),
  };
}

// ── JSON, for the iOS app ─────────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

function jsonResponse(statusCode, body, cache) {
  return { statusCode, headers: { ...JSON_HEADERS, ...cache }, body: JSON.stringify(body) };
}

function artistMeta(entry, snapshot) {
  return {
    slug: snapshot.slug,
    name: snapshot.name,
    source: snapshot.source,
    sourceName: snapshot.sourceName,
    attribution: snapshot.attribution,
    url: `${SITE_URL}${bandPath(snapshot.slug)}`,
    fetchedAt: entry.fetchedAt,
    dataUpdatedAt: snapshot.dataUpdatedAt,
    songPages: snapshot.songPages,
    coverage: snapshot.coverage,
  };
}

function artistJson(loaded, now = Date.now()) {
  if (!loaded) return jsonResponse(404, { ok: false, error: 'not_found' }, { 'Cache-Control': 'public, s-maxage=300' });
  const { entry, snapshot } = loaded;
  if (!availability(entry, now).available) return jsonResponse(503, { ok: false, error: 'unavailable' }, UNAVAILABLE_CACHE_HEADERS);
  return jsonResponse(200, {
    ok: true,
    schemaVersion: snapshot.schemaVersion,
    artist: artistMeta(entry, snapshot),
    band: snapshot.band,
    // Every song, summarized; /api/artist-song has the detail.
    songs: snapshot.songs.map((s) => ({
      slug: s.slug,
      name: s.name,
      isOriginal: s.isOriginal,
      originalArtist: s.originalArtist,
      timesPlayed: s.timesPlayed,
      currentGap: s.currentGap,
      lastPlayed: s.lastPlayed.date,
      longestGap: s.longestGap,
      gapStart: s.gapStart ? s.gapStart.date : null,
      gapEnd: s.gapEnd ? s.gapEnd.date : null,
    })),
  }, cacheHeaders(entry, now));
}

function artistSongJson(loaded, songSlug, now = Date.now()) {
  const song = loaded && findSong(loaded.snapshot, songSlug);
  if (!song) return jsonResponse(404, { ok: false, error: 'not_found' }, { 'Cache-Control': 'public, s-maxage=300' });
  const { entry, snapshot } = loaded;
  if (!availability(entry, now).available) return jsonResponse(503, { ok: false, error: 'unavailable' }, UNAVAILABLE_CACHE_HEADERS);
  const { key, ...publicSong } = song;
  return jsonResponse(200, {
    ok: true,
    schemaVersion: snapshot.schemaVersion,
    artist: artistMeta(entry, snapshot),
    song: { ...publicSong, url: `${SITE_URL}${songPath(snapshot.slug, song.slug)}` },
  }, cacheHeaders(entry, now));
}

module.exports = {
  bandPath,
  songPath,
  renderBand,
  renderSong,
  renderIndex,
  notFound,
  artistJson,
  artistSongJson,
  jsonResponse,
};
