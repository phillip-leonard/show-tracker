// netlify/functions/sitemap.js
//
// Three documents, one function:
//
//   /sitemap.xml          a sitemap index pointing at the two below
//   /sitemap-pages.xml    home, the legal pages, and every opted-in public
//                         profile (/u/<handle>/)
//   /sitemap-artists.xml  /artists/, every public band page and every song
//                         page, from the band-page snapshot index
//                         (lib/publicArtistSnapshot.js)
//
// robots.txt points at /sitemap.xml. Public show pages are deliberately not
// enumerated — "keep the surface small" — since a per-user show list would
// risk the 50,000-URL/50MB sitemap limits at scale for no real SEO gain
// over the profile page itself. The artist sitemap is well inside the
// limit: about 2,000 URLs with every configured artist.

const { openBlobStore, loadIndex } = require('./lib/publicArtistSnapshot');

const SITE_URL = 'https://mysetlists.net';

const STATIC_URLS = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  // No /roadmap: its items come from Firestore and only render for a
  // signed-in user, so a crawler gets "Loading..." there. Put it back (and
  // its index rule in public/_headers) if the page ever renders signed out.
  { loc: '/privacy', changefreq: 'monthly', priority: '0.3' },
  { loc: '/terms', changefreq: 'monthly', priority: '0.3' },
  { loc: '/cookies', changefreq: 'monthly', priority: '0.2' },
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

function url({ loc, lastmod, changefreq, priority }) {
  return `  <url><loc>${escapeXml(`${SITE_URL}${loc}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}${priority ? `<priority>${priority}</priority>` : ''}</url>`;
}

const urlset = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

// lastmod is when the page's data last changed (dataUpdatedAt), not merely
// when it was last fetched: a fetch that found nothing new hasn't changed
// the page, and Google discounts a lastmod that moves on every crawl.
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

/** The artist sitemap's <url> entries, from the snapshot index. */
function artistUrls(index) {
  const urls = [{ loc: '/artists/', lastmod: day(index.updatedAt), changefreq: 'daily', priority: '0.7' }];
  for (const e of index.artists) {
    const lastmod = day(e.dataUpdatedAt || e.fetchedAt);
    urls.push({ loc: `/artist/${e.slug}/`, lastmod, changefreq: 'daily', priority: '0.8' });
    if (e.songPages) {
      for (const song of e.songSlugs || []) urls.push({ loc: `/artist/${e.slug}/song/${song}/`, lastmod, changefreq: 'weekly', priority: '0.5' });
    }
  }
  return urls;
}

function whichDocument(event) {
  const paths = [event?.path || ''];
  try { if (event?.rawUrl) paths.push(new URL(event.rawUrl).pathname); } catch { /* path is enough */ }
  if (paths.some((p) => /sitemap-pages(\.xml)?\/?$|\/sitemap\/pages\/?$/.test(p))) return 'pages';
  if (paths.some((p) => /sitemap-artists(\.xml)?\/?$|\/sitemap\/artists\/?$/.test(p))) return 'artists';
  return 'index';
}

async function pagesSitemap() {
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
    ...publicHandles.map(h => url({ loc: `/u/${h}/`, changefreq: 'weekly', priority: '0.5' })),
  ]);
}

exports.uniqueHandles = uniqueHandles;
exports.artistUrls = artistUrls;
exports.whichDocument = whichDocument;

exports.handler = async function (event) {
  const doc = whichDocument(event);

  if (doc === 'pages') {
    return { statusCode: 200, headers: XML_HEADERS, body: await pagesSitemap() };
  }

  let index = { artists: [] };
  try {
    index = await loadIndex(openBlobStore(event));
  } catch (err) {
    console.error('sitemap: failed to read the artist snapshot index:', err);
  }

  if (doc === 'artists') {
    return { statusCode: 200, headers: XML_HEADERS, body: urlset(artistUrls(index).map(url)) };
  }

  const artistsLastmod = day(index.updatedAt);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_URL}/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>${SITE_URL}/sitemap-artists.xml</loc>${artistsLastmod ? `<lastmod>${artistsLastmod}</lastmod>` : ''}</sitemap>
</sitemapindex>`;
  return { statusCode: 200, headers: XML_HEADERS, body };
};
