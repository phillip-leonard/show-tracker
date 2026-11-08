// netlify/functions/sitemap.js
//
// One function, every sitemap:
//
//   /sitemap.xml                  a sitemap index of the ones below
//   /sitemap-pages.xml            home, the legal and comparison pages, the
//                                 Songs I've heard tool (/heard/ and each
//                                 band's page), and every opted-in public
//                                 profile (/u/<handle>/)
//   /sitemap-artists.xml          /artists/ and every public band page
//   /sitemap-artist-<slug>.xml    one per band with song pages: its song
//                                 index (/artist/<slug>/songs/) and every
//                                 indexable song page
//
// robots.txt points at /sitemap.xml. Public show pages are deliberately not
// enumerated — "keep the surface small" — since a per-user show list would
// risk the 50,000-URL/50MB sitemap limits at scale for no real SEO gain
// over the profile page itself.
//
// lastmod is the date the page's content last changed for a reason a
// reader would notice, or left out when there's no honest one:
//
//   song page                    the date the song was last played
//   band page, song index        the band's latest show
//   /artists/                    the latest show of any band
//   a child sitemap (in the      the newest lastmod inside it
//   index)
//
// No priority or changefreq: Google ignores both. Thin song pages (fewer
// than SEO_MIN_PLAYS_FOR_INDEX plays, artistSnapshotStats.js) are noindex
// and left out.

const { openBlobStore, loadIndex, loadArtist, heardArtists } = require('./lib/publicArtistSnapshot');
const { isIndexable } = require('./lib/artistSnapshotStats');

const SITE_URL = 'https://mysetlists.net';

const STATIC_URLS = [
  { loc: '/' },
  // No /roadmap: its items come from Firestore and only render for a
  // signed-in user, so a crawler gets "Loading..." there. Put it back (and
  // its index rule in public/_headers) if the page ever renders signed out.
  { loc: '/privacy' },
  { loc: '/terms' },
  { loc: '/cookies' },
  // The comparison pages (lib/comparePages.js), with the trailing slash the
  // static export serves them at, matching each page's canonical. lastmod
  // is when each page's copy last changed.
  { loc: '/compare/concert-archives/', lastmod: '2026-10-21' },
  { loc: '/compare/setlist-fm/', lastmod: '2026-10-21' },
  { loc: '/switch/concert-archives/', lastmod: '2026-10-29' },
  { loc: '/best-concert-tracker-apps-jam-bands/', lastmod: '2026-10-21' },
];

const XML_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

function getDb() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (!getApps().length) {
    initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
  }
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore();
}

// One URL per handle. More than one userProfiles doc can carry the same
// handleLower: the live sitemap listed /u/alexreviewer/ twice. Only
// handles/{handleLower} decides which account a URL resolves to, so a
// repeat adds nothing.
function uniqueHandles(handles) {
  const seen = new Set();
  for (const h of handles) {
    const handle = typeof h === 'string' ? h.trim().toLowerCase() : '';
    if (handle) seen.add(handle);
  }
  return [...seen];
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function url({ loc, lastmod }) {
  return `  <url><loc>${escapeXml(`${SITE_URL}${loc}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
}

const urlset = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
// The newest of a list of YYYY-MM-DD lastmods, '' if none has one.
const newest = (urls) => urls.map((u) => u.lastmod || '').filter(Boolean).sort().pop() || '';

/**
 * The Songs I've heard pages: /heard/ and each band whose show list is
 * published (its index entry has a showsHash), lastmod when that list last
 * changed. Share links (/heard/<slug>/r/…) are personal and noindex.
 */
function heardUrls(index) {
  const published = heardArtists()
    .map((a) => index.artists.find((e) => e.slug === a.slug && e.showsHash))
    .filter(Boolean);
  if (!published.length) return [];
  const urls = published.map((e) => ({ loc: `/heard/${e.slug}/`, lastmod: day(e.showsUpdatedAt || e.fetchedAt) }));
  return [{ loc: '/heard/', lastmod: newest(urls) }, ...urls];
}

/** /sitemap-artists.xml: /artists/ and every band page. */
function artistUrls(index) {
  const bands = index.artists.map((e) => ({ loc: `/artist/${e.slug}/`, lastmod: day(e.lastShowDate) }));
  return [{ loc: '/artists/', lastmod: newest(bands) }, ...bands];
}

/** The bands that get a /sitemap-artist-<slug>.xml. */
const songSitemapBands = (index) => index.artists.filter((e) => e.songPages && e.songCount > 0);

/**
 * /sitemap-artist-<slug>.xml: the band's song index and each song page
 * with at least SEO_MIN_PLAYS_FOR_INDEX plays. `snapshot` is the band's
 * published artists/<slug>.json.
 */
function bandSongUrls(snapshot) {
  if (!snapshot?.songPages || !snapshot.songs?.length) return [];
  return [
    { loc: `/artist/${snapshot.slug}/songs/`, lastmod: day(snapshot.band?.lastShow?.date) },
    ...snapshot.songs.filter(isIndexable).map((s) => ({ loc: `/artist/${snapshot.slug}/song/${s.slug}/`, lastmod: day(s.lastPlayed?.date) })),
  ];
}

function eventPaths(event) {
  const paths = [event?.path || ''];
  try { if (event?.rawUrl) paths.push(new URL(event.rawUrl).pathname); } catch { /* path is enough */ }
  return paths;
}

function whichDocument(event) {
  const paths = eventPaths(event);
  if (paths.some((p) => /sitemap-pages(\.xml)?\/?$|\/sitemap\/pages\/?$/.test(p))) return 'pages';
  if (paths.some((p) => /sitemap-artists(\.xml)?\/?$|\/sitemap\/artists\/?$/.test(p))) return 'artists';
  if (bandSitemapSlug(event)) return 'band';
  return 'index';
}

/** The slug of a /sitemap-artist-<slug>.xml request, else ''. */
function bandSitemapSlug(event) {
  for (const p of eventPaths(event)) {
    const m = p.match(/sitemap-artist-([a-z0-9-]+?)(?:\.xml)?\/?$/) || p.match(/\/sitemap\/artist\/([a-z0-9-]+)\/?$/);
    if (m) return m[1];
  }
  return '';
}

/** The sitemap index's <sitemap> entries. */
function indexEntries(index) {
  const pagesLastmod = newest([...STATIC_URLS, ...heardUrls(index)]);
  return [
    { loc: '/sitemap-pages.xml', lastmod: pagesLastmod },
    { loc: '/sitemap-artists.xml', lastmod: newest(artistUrls(index)) },
    // A band's songs are last played no later than its latest show, which
    // is also its song index's lastmod: the newest inside.
    ...songSitemapBands(index).map((e) => ({ loc: `/sitemap-artist-${e.slug}.xml`, lastmod: day(e.lastShowDate) })),
  ];
}

const sitemapIndex = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <sitemap><loc>${escapeXml(`${SITE_URL}${e.loc}`)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</sitemap>`).join('\n')}
</sitemapindex>`;

async function pagesSitemap(index) {
  const db = getDb();
  let publicHandles = [];
  if (db) {
    try {
      const snap = await db.collection('userProfiles').where('publicProfile', '==', true).get();
      publicHandles = uniqueHandles(snap.docs.map(d => d.data().handleLower));
    } catch (err) {
      console.error('sitemap: failed to list public profiles:', err);
      // Degrade to the static URL set rather than failing the whole sitemap.
    }
  }
  return urlset([
    ...STATIC_URLS.map(url),
    ...heardUrls(index).map(url),
    ...publicHandles.map(h => url({ loc: `/u/${h}/` })),
  ]);
}

exports.uniqueHandles = uniqueHandles;
exports.artistUrls = artistUrls;
exports.bandSongUrls = bandSongUrls;
exports.heardUrls = heardUrls;
exports.indexEntries = indexEntries;
exports.whichDocument = whichDocument;
exports.bandSitemapSlug = bandSitemapSlug;
exports.urlset = urlset;
exports.url = url;
exports.sitemapIndex = sitemapIndex;
exports.STATIC_URLS = STATIC_URLS;

exports.handler = async function (event) {
  const doc = whichDocument(event);
  let store = null;
  let index = { artists: [] };
  try {
    store = openBlobStore(event);
    index = await loadIndex(store);
  } catch (err) {
    console.error('sitemap: failed to read the artist snapshot index:', err);
  }

  if (doc === 'pages') {
    return { statusCode: 200, headers: XML_HEADERS, body: await pagesSitemap(index) };
  }

  if (doc === 'artists') {
    return { statusCode: 200, headers: XML_HEADERS, body: urlset(artistUrls(index).map(url)) };
  }

  if (doc === 'band') {
    const slug = bandSitemapSlug(event);
    let loaded = null;
    try {
      if (store && songSitemapBands(index).some((e) => e.slug === slug)) loaded = await loadArtist(store, slug);
    } catch (err) {
      console.error(`sitemap: failed to read the ${slug} snapshot:`, err);
    }
    const urls = loaded ? bandSongUrls(loaded.snapshot) : [];
    if (!urls.length) return { statusCode: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: 'No sitemap at this address.' };
    return { statusCode: 200, headers: XML_HEADERS, body: urlset(urls.map(url)) };
  }

  return { statusCode: 200, headers: XML_HEADERS, body: sitemapIndex(indexEntries(index)) };
};
