// netlify/functions/lib/publicArtistPages.js
//
// Renders the public artist pages from a snapshot loaded by
// publicArtistSnapshot.js: the band page, the song page, the /artists
// index, and the "temporarily unavailable" state for phish.net data past
// 24 hours. Also builds the /api/artist and /api/artist-song JSON from the
// same loaded snapshot, so the HTML and the JSON can never disagree, and
// the /api/artists list of bands that have one.
//
// Each function returns a complete Netlify response. Plain HTML through
// publicPageHtml.page(), same shell as the /u/ pages.

const { escapeHtml, page, notFoundPage, formatShowDate, SITE_URL } = require('./publicPageHtml');
const { availability, cacheHeaders, UNAVAILABLE_CACHE_HEADERS, findArtist, hasShowList, publicArtists } = require('./publicArtistSnapshot');
const { isIndexable, isSong, RELATED_SONGS } = require('./artistSnapshotStats');

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
  .cta a.btn-secondary { margin-left: 8px; background: transparent; color: #f5f5f5; border: 1px solid rgba(255,255,255,0.35); }
  .artists { list-style: none; padding: 0; margin: 0; }
  .artists li { margin-bottom: 8px; }
  .more { margin: 14px 0 0; font-size: 15px; font-weight: 700; }
  .letters { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .letters a { display: inline-block; min-width: 28px; padding: 4px 6px; border-radius: 8px; background: rgba(255,255,255,0.06); text-align: center; font-weight: 700; font-size: 13px; }
  h2.letter { margin-top: 24px; }
  .links { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .links li a { display: block; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.04); }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border: 1px solid rgba(255,255,255,0.25); border-radius: 999px; font-size: 11px; line-height: 16px; color: #b7b6c9; white-space: nowrap; vertical-align: 1px; }
`;

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
const date = (d) => (d ? formatShowDate(d, 'short') : '');
const longDate = (d) => (d ? formatShowDate(d, 'long') : '');

const bandPath = (slug) => `/artist/${slug}/`;
const songPath = (slug, songSlug) => `/artist/${slug}/song/${songSlug}/`;
const songsPath = (slug) => `/artist/${slug}/songs/`;
// Bands with a full-history archive behind them (Songfish, phish.net) show
// show dates and venues as plain text, with one followable link to the
// archive per table, so a page isn't 30 links out to it. setlist.fm keeps a
// link on every row: its terms want an attribution link to each setlist
// shown, never nofollow (docs/setlistfm-compliance.md).
const linksEveryShow = (snapshot) => snapshot.source === 'setlistfm';
// The band on MusicBrainz, the one identifier for the band itself in the
// config (setlist.fm's mbid, or setlistfmMbid for archive bands).
const musicBrainzUrl = (slug) => {
  const artist = findArtist(slug);
  const mbid = artist && (artist.mbid || artist.setlistfmMbid);
  return mbid ? `https://musicbrainz.org/artist/${mbid}` : '';
};
// The Songs I've heard tool (heardPages.js), for bands that have it.
const heardHref = (slug) => {
  const artist = findArtist(slug);
  return artist && hasShowList(artist) ? `${SITE_URL}/heard/${slug}/` : '';
};

// The page is cached and the same for everyone, so a signed-in visitor's
// "Make my poster" (the tool opened on their own shows, ?mine=1) is swapped
// in here, from lib/signedInHint.js's localStorage key.
const SIGNED_IN_CTA = `<script>try{if(localStorage.getItem('mysetlists_signed_in')){var a=document.getElementById('heard-cta');if(a){a.href+='?mine=1';a.textContent='Make my poster';}}}catch(e){}</script>`;

// Into the app, which keeps the band and follows it once the visitor is
// signed in (context/AppContext.jsx, ?follow=).
function followHref(name) {
  return `${SITE_URL}/shows/?follow=${encodeURIComponent(name)}`;
}

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

function showLink(show, linked = true) {
  const text = `${escapeHtml(show.venue)}${show.city ? `, ${escapeHtml(show.city)}` : ''}`;
  return linked && show.url ? `<a href="${escapeHtml(show.url)}">${text}</a>` : text;
}

function showRows(shows, linked = true) {
  return `<table><thead><tr><th>Date</th><th>Venue</th></tr></thead><tbody>${shows
    .map((s) => `<tr><td style="white-space:nowrap">${escapeHtml(date(s.date))}</td><td>${showLink(s, linked)}</td></tr>`)
    .join('')}</tbody></table>`;
}

// "Every setlist on elgoose.net", under a table whose rows aren't linked.
function archiveLink(snapshot, text) {
  const { url } = snapshot.attribution;
  return `<p class="note">${escapeHtml(text)} <a href="${escapeHtml(url)}">${escapeHtml(snapshot.sourceName)}</a>.</p>`;
}

function allSongsLink(snapshot) {
  if (!snapshot.songPages || !snapshot.songs.length) return '';
  return `<p class="more"><a href="${SITE_URL}${songsPath(snapshot.slug)}">All ${plural(snapshot.songs.length, `${escapeHtml(snapshot.name)} song`)} &rarr;</a></p>`;
}

function songName(artistSlug, s) {
  return s.hasPage ? `<a href="${SITE_URL}${songPath(artistSlug, s.slug)}">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
}

function datedLink(show, linked = true) {
  const text = escapeHtml(date(show.date));
  return linked && show.url ? `<a href="${escapeHtml(show.url)}">${text}</a>` : text;
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

// ── Fans also track ───────────────────────────────────────────────────

const MIN_ALSO_TRACK = 4;
const MAX_ALSO_TRACK = 6;

/**
 * 4-6 other bands with a published page: the band's hand-curated
 * alsoTrack list (config/public-artists.json), topped up from the featured
 * bands. `index` is the snapshot index; without one every configured band
 * counts as published.
 */
function alsoTrack(slug, index) {
  const published = index ? new Set(index.artists.map((e) => e.slug)) : null;
  const ok = (s) => s !== slug && findArtist(s) && (!published || published.has(s));
  const picks = [];
  const add = (s) => { if (ok(s) && !picks.includes(s) && picks.length < MAX_ALSO_TRACK) picks.push(s); };
  (findArtist(slug)?.alsoTrack || []).forEach(add);
  if (picks.length < MIN_ALSO_TRACK) publicArtists().filter((a) => a.featured).forEach((a) => { if (picks.length < MIN_ALSO_TRACK) add(a.slug); });
  return picks.map(findArtist);
}

function alsoTrackBlock(name, slug, index) {
  const bands = alsoTrack(slug, index);
  if (!bands.length) return '';
  return `
    <h2>Fans of ${escapeHtml(name)} also track</h2>
    <ul class="links">${bands.map((a) => `<li><a href="${SITE_URL}${bandPath(a.slug)}">${escapeHtml(a.name)}</a></li>`).join('')}</ul>`;
}

function renderBand({ entry, snapshot, index }, now = Date.now()) {
  if (!availability(entry, now).available) return unavailablePage(snapshot);
  const { band, name, slug, coverage } = snapshot;
  const linked = linksEveryShow(snapshot);
  const trail = [{ name: 'Home', path: '/' }, { name: 'Artists', path: '/artists/' }, { name, path: bandPath(slug) }];

  const top = band.mostPlayed[0];
  const title = `${name} Setlists, Song Stats & Gaps | MySetlists`;
  // A version 1 snapshot (written before the original/cover split) has
  // none of these, and one from before 5.47.13 has the longest gaps with
  // retired songs in, not the overdue lists; its page shows what it can,
  // under the old headings, until the next run.
  const split = !!band.overdueOriginals;
  const originalGaps = (split ? band.overdueOriginals : band.originalGapLeaders) || [];
  const coverGaps = (split ? band.overdueCovers : band.coverGapLeaders) || [];
  const retired = band.notPlayedSince || [];
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

  // "In the last 5 years" counts back from the band's latest show
  // (artistSnapshotStats.js RETIRED_YEARS).
  const recently = 'in the five years up to their latest show';
  const originalGapLeaders = split ? gapTable(
    `${escapeHtml(name)} songs most overdue`,
    `${escapeHtml(name)} originals played at least 5 times${inWindow} and at least once ${recently}, by shows since they were last played.`,
    originalGaps,
  ) : gapTable(
    `${escapeHtml(name)} songs with the longest gaps`,
    `${escapeHtml(name)} originals played at least 5 times${inWindow}, by shows since they were last played.`,
    originalGaps,
  );
  const coverGapLeaders = split ? gapTable(
    `${escapeHtml(name)} covers most overdue`,
    `Covers played at least 5 times${inWindow} and at least once ${recently}, by shows since ${escapeHtml(name)} last played them.`,
    coverGaps,
  ) : gapTable(
    `${escapeHtml(name)} covers with the longest gaps`,
    `Covers played at least 5 times${inWindow}, by shows since ${escapeHtml(name)} last played them.`,
    coverGaps,
  );
  const notPlayedSince = gapTable(
    `${escapeHtml(name)} songs not played in 5+ years`,
    `${escapeHtml(name)} originals played at least 5 times${inWindow} but not ${recently}, longest ago first.`,
    retired,
  );

  const bustOutTable = bustOuts.length ? `
    <h2>Biggest ${escapeHtml(name)} bust-outs</h2>
    <p class="note">${escapeHtml(name)} originals that went the most shows without being played. The gap counts every ${escapeHtml(name)} show from the one after it was last played through the bust-out, as ${escapeHtml(snapshot.sourceName)} does.</p>
    <table><thead><tr><th>Song</th><th class="num">Gap</th><th class="num">Last played</th><th class="num">Bust-out</th></tr></thead><tbody>${bustOuts
      .map((s) => `<tr><td>${songName(slug, s)}</td><td class="num">${s.longestGap.toLocaleString('en-US')}</td><td class="num">${datedLink(s.gapStart, linked)}</td><td class="num">${datedLink(s.gapEnd, linked)}</td></tr>`)
      .join('')}</tbody></table>` : '';

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>${escapeHtml(name)} setlists, song stats &amp; show tracker</h1>
    <p class="sub">${bandIntro(snapshot)}</p>
    ${stats}
    ${allSongsLink(snapshot)}
    ${mostPlayed}
    ${mostPlayed ? allSongsLink(snapshot) : ''}
    ${originalGapLeaders}
    ${coverGapLeaders}
    ${notPlayedSince}
    ${bustOutTable}
    ${heardHref(slug) ? `
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">How many ${escapeHtml(name)} songs have you heard?</p>
      <p class="note" style="margin:0 0 8px;">Tick the shows you were at and see every song you've heard live, your rarest catches and the bust-outs you were there for. Free, with a poster to share.</p>
      <a class="btn" id="heard-cta" href="${heardHref(slug)}">Count your songs</a>
    </div>` : ''}
    <h2>Recent ${escapeHtml(name)} shows</h2>
    ${showRows(band.recentShows, linked)}
    ${linked ? '' : archiveLink(snapshot, `Every ${name} setlist, with notes, is on`)}
    ${alsoTrackBlock(name, slug, index)}
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">Track your ${escapeHtml(name)} shows</p>
      <p class="note" style="margin:0 0 8px;">Log the shows you've been to and see every song you've heard live, your own gaps and your stats. Follow ${escapeHtml(name)} and we'll email you when they announce a tour.</p>
      <a class="btn" href="${SITE_URL}/">Start tracking free</a>
      <a class="btn btn-secondary" href="${followHref(name)}" rel="nofollow">Follow ${escapeHtml(name)}</a>
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
        ...(musicBrainzUrl(slug) ? { sameAs: [musicBrainzUrl(slug)] } : {}),
      },
      breadcrumbLd(trail),
    ],
  };

  return {
    statusCode: 200,
    headers: { ...HTML, ...cacheHeaders(entry, now) },
    body: page({ title, description, canonicalPath: bandPath(slug), jsonLd, bodyHtml, extraStyle: EXTRA_STYLE, scriptHtml: heardHref(slug) ? SIGNED_IN_CTA : '' }),
  };
}

// ── Song page ─────────────────────────────────────────────────────────

function findSong(snapshot, songSlug) {
  if (!snapshot.songPages) return null;
  return snapshot.songs.find((s) => s.slug === songSlug) || null;
}

// A–Z by title, ignoring case and accents, numbers in numeric order.
const byTitle = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.slug.localeCompare(b.slug);
const relatable = (s) => isIndexable(s) && isSong(s);

/**
 * Up to RELATED_SONGS indexable songs for a song page: the snapshot's
 * related list (played at the same shows), topped up from the songs either
 * side of this one in the A–Z list. A snapshot from before related songs
 * existed gets the A–Z neighbours alone. `fromShows` is how many came
 * from shared shows.
 */
function relatedFor(snapshot, song) {
  const bySlug = new Map(snapshot.songs.map((s) => [s.slug, s]));
  const picks = [];
  const add = (s) => { if (s && s.slug !== song.slug && relatable(s) && !picks.includes(s) && picks.length < RELATED_SONGS) picks.push(s); };
  (song.related || []).forEach((slug) => add(bySlug.get(slug)));
  const fromShows = picks.length;
  const others = snapshot.songs.filter((s) => s.slug !== song.slug && relatable(s)).sort(byTitle);
  const pos = others.filter((s) => byTitle(s, song) < 0).length;
  const n = others.length;
  for (let d = 1; picks.length < RELATED_SONGS && d <= n; d++) {
    add(others[(((pos - d) % n) + n) % n]);
    add(others[(pos + d - 1) % n]);
  }
  return { songs: picks, fromShows };
}

function relatedBlock(snapshot, song) {
  const { songs, fromShows } = relatedFor(snapshot, song);
  if (!songs.length) return '';
  const band = escapeHtml(snapshot.name);
  const note = fromShows
    ? `The ${band} songs played most often at the same shows as ${escapeHtml(song.name)}${fromShows < songs.length ? ', then the songs next to it A&ndash;Z' : ''}.`
    : `Next to ${escapeHtml(song.name)} in the A&ndash;Z list of ${band} songs.`;
  return `
    <h2>Related ${band} songs</h2>
    <p class="note">${note}</p>
    <ul class="links">${songs.map((s) => `<li><a href="${SITE_URL}${songPath(snapshot.slug, s.slug)}">${escapeHtml(s.name)}</a></li>`).join('')}</ul>`;
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
  const linked = linksEveryShow(snapshot);
  // Thin pages stay reachable and followable, out of the index.
  const robots = isIndexable(song) ? '' : 'noindex, follow';

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
    ${song.gapStart && song.gapEnd ? `<p class="note">Longest gap ever: ${plural(song.longestGap, 'show')} (${datedLink(song.gapStart, linked)} to ${datedLink(song.gapEnd, linked)}).</p>` : ''}`;

  const sourceLink = song.sourceUrl
    ? `<p class="source">${escapeHtml(song.name)} on ${isPhish ? 'Phish.net' : escapeHtml(snapshot.sourceName)}: <a href="${escapeHtml(song.sourceUrl)}">every performance, jam notes and more</a>.${isPhish ? ' Data courtesy of Phish.net.' : ''}</p>`
    : '';

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>${escapeHtml(song.name)} by ${escapeHtml(band)}: times played, last played &amp; gap</h1>
    <p class="sub">${escapeHtml(band)} has played ${escapeHtml(song.name)} ${plural(song.timesPlayed, 'time')}. It was first played on ${escapeHtml(longDate(song.firstPlayed.date))} at ${showLink(song.firstPlayed, linked)}, and last on ${escapeHtml(longDate(song.lastPlayed.date))} at ${showLink(song.lastPlayed, linked)} (${escapeHtml(gapText(song.currentGap))}).</p>
    ${stats}
    <h2>Recent performances</h2>
    ${showRows(song.recentPerformances, linked)}
    ${linked || song.sourceUrl ? '' : archiveLink(snapshot, `Every ${band} setlist is on`)}
    <div class="cta">
      <p style="margin:0 0 4px;font-weight:700;">How many times have you heard ${escapeHtml(song.name)}?</p>
      ${heardHref(slug) ? `<p class="note" style="margin:0 0 8px;">Tick the ${escapeHtml(band)} shows you were at and count every song you've heard live, ${escapeHtml(song.name)} included. Free, no account needed.</p>
      <a class="btn" href="${heardHref(slug)}">Count your ${escapeHtml(band)} songs</a>` : `<p class="note" style="margin:0 0 8px;">Track your shows on MySetlists and see every song you've caught live.</p>
      <a class="btn" href="${SITE_URL}/">Track your shows</a>`}
    </div>
    ${relatedBlock(snapshot, song)}
    ${allSongsLink(snapshot)}
    <p style="margin-top:24px;"><a href="${SITE_URL}${bandPath(slug)}">&larr; All ${escapeHtml(band)} song stats</a></p>
    ${sourceLink}
    ${sourceLine(snapshot, entry.fetchedAt)}
  `;

  // A MusicComposition only where the source says the song is the band's
  // own: a cover's original artist isn't necessarily its composer.
  const jsonLd = song.isOriginal === true
    ? {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'MusicComposition',
          name: song.name,
          url: `${SITE_URL}${songPath(slug, song.slug)}`,
          composer: { '@type': 'MusicGroup', name: band, url: `${SITE_URL}${bandPath(slug)}` },
        },
        breadcrumbLd(trail),
      ],
    }
    : { '@context': 'https://schema.org', ...breadcrumbLd(trail) };

  return {
    statusCode: 200,
    headers: { ...HTML, ...cacheHeaders(entry, now), ...(robots ? { 'X-Robots-Tag': robots } : {}) },
    body: page({ title, description, canonicalPath: songPath(slug, song.slug), jsonLd, bodyHtml, extraStyle: EXTRA_STYLE, robots }),
  };
}

// ── Song index ────────────────────────────────────────────────────────

// '#' for a title that doesn't start with a letter, else its letter.
function letterOf(name) {
  const c = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}
const letterId = (l) => (l === '#' ? 'letter-0-9' : `letter-${l.toLowerCase()}`);

/** /artist/<slug>/songs/: every song, A–Z, each linked to its page. */
function renderSongIndex({ entry, snapshot }, now = Date.now()) {
  if (!snapshot.songPages || !snapshot.songs.length) return notFound('No song list at this address.');
  if (!availability(entry, now).available) return unavailablePage(snapshot);

  const { name: band, slug } = snapshot;
  const songs = snapshot.songs.slice().sort(byTitle);
  const count = songs.length;
  const latest = snapshot.band.lastShow?.date;
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Artists', path: '/artists/' },
    { name: band, path: bandPath(slug) },
    { name: 'Songs', path: songsPath(slug) },
  ];

  const groups = new Map();
  for (const s of songs) {
    const l = letterOf(s.name);
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(s);
  }
  const letters = [...groups.keys()].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)));

  const title = `All ${band} Songs – Times Played & Last Played | MySetlists`;
  const description = `All ${count.toLocaleString('en-US')} songs ${band} has played live, A to Z, with how many times each was played and when it was last played${latest ? `. Updated through the ${longDate(latest)} show` : ''}.`;

  const jump = `<nav class="letters" aria-label="Jump to letter">${letters
    .map((l) => `<a href="#${letterId(l)}">${l === '#' ? '0&ndash;9' : l}</a>`).join('')}</nav>`;

  const tables = letters.map((l) => `
    <h2 class="letter" id="${letterId(l)}">${l === '#' ? '0&ndash;9' : l}</h2>
    <table><thead><tr><th>Song</th><th class="num">Times played</th><th class="num">Last played</th></tr></thead><tbody>${groups.get(l)
      .map((s) => `<tr><td><a href="${SITE_URL}${songPath(slug, s.slug)}">${escapeHtml(s.name)}</a>${s.isOriginal === false ? '<span class="tag">Cover</span>' : ''}</td><td class="num">${s.timesPlayed.toLocaleString('en-US')}</td><td class="num">${escapeHtml(date(s.lastPlayed.date))}</td></tr>`)
      .join('')}</tbody></table>`).join('');

  const bodyHtml = `
    ${crumbs(trail)}
    <h1>All ${count.toLocaleString('en-US')} ${escapeHtml(band)} songs</h1>
    <p class="sub">Every song ${escapeHtml(band)} has played live, from ${escapeHtml(snapshot.sourceName)}: ${plural(snapshot.band.totalShows, 'show')}${latest ? ` through ${escapeHtml(longDate(latest))}` : ''}. Each song links to its times played, gaps and recent performances.</p>
    ${jump}
    ${tables}
    <p style="margin-top:24px;"><a href="${SITE_URL}${bandPath(slug)}">&larr; ${escapeHtml(band)} setlists and song stats</a></p>
    ${sourceLine(snapshot, entry.fetchedAt)}
  `;

  return {
    statusCode: 200,
    headers: { ...HTML, ...cacheHeaders(entry, now) },
    body: page({ title, description, canonicalPath: songsPath(slug), jsonLd: { '@context': 'https://schema.org', ...breadcrumbLd(trail) }, bodyHtml, extraStyle: EXTRA_STYLE }),
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

// /api/artists: every band whose snapshot may be shown right now, so the
// app can link a band name to its band screen only where there is one.
// `index` is loadIndex()'s. A Phish entry past its 24 hours is left out
// rather than listed and then refused; the short cache keeps that true
// within minutes of the cutoff.
function artistsIndexJson(index, now = Date.now()) {
  const artists = index.artists
    .filter((e) => findArtist(e.slug) && availability(e, now).available)
    .map((e) => ({
      slug: e.slug,
      name: e.name,
      source: e.source,
      sourceName: e.sourceName,
      songPages: !!e.songPages,
      totalShows: e.totalShows,
      songCount: e.songCount,
      lastShowDate: e.lastShowDate,
      fetchedAt: e.fetchedAt,
    }));
  return jsonResponse(200, { ok: true, schemaVersion: index.schemaVersion, artists }, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' });
}

// /api/artist-shows: every show with its setlist, for the "Songs I've
// heard" tool. `loaded` is loadArtistShows()'s { entry, shows }. The
// compact shape is artistSnapshotStats.js's buildShowList.
function artistShowsJson(loaded, now = Date.now()) {
  if (!loaded) return jsonResponse(404, { ok: false, error: 'not_found' }, { 'Cache-Control': 'public, s-maxage=300' });
  const { entry, shows } = loaded;
  if (!availability(entry, now).available) return jsonResponse(503, { ok: false, error: 'unavailable' }, UNAVAILABLE_CACHE_HEADERS);
  const { schemaVersion, slug, name, source, sourceName, attribution, dataUpdatedAt, ...list } = shows;
  return jsonResponse(200, {
    ok: true,
    schemaVersion,
    artist: { slug, name, source, sourceName, attribution, url: `${SITE_URL}${bandPath(slug)}`, fetchedAt: entry.fetchedAt, dataUpdatedAt },
    ...list,
  }, cacheHeaders(entry, now));
}

module.exports = {
  bandPath,
  songPath,
  songsPath,
  renderBand,
  renderSong,
  renderSongIndex,
  relatedFor,
  alsoTrack,
  renderIndex,
  notFound,
  unavailablePage,
  artistJson,
  artistSongJson,
  artistShowsJson,
  artistsIndexJson,
  jsonResponse,
};
