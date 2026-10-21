// netlify/functions/sitemap.js
//
// GET /sitemap.xml — replaces the old static public/sitemap.xml (which only
// ever listed 6 fixed URLs) with a generated one that also lists every
// opted-in public profile. Deliberately does not enumerate every public
// show page — per the Part 4 prompt, "keep the surface small," and a
// per-user show list would risk the 50,000-URL/50MB sitemap limits at
// scale for no real SEO gain over the profile page itself.

const SITE_URL = 'https://mysetlists.net';

const STATIC_URLS = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/roadmap', changefreq: 'weekly', priority: '0.7' },
  { loc: '/privacy', changefreq: 'monthly', priority: '0.3' },
  { loc: '/terms', changefreq: 'monthly', priority: '0.3' },
  { loc: '/cookies', changefreq: 'monthly', priority: '0.2' },
];

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

exports.uniqueHandles = uniqueHandles;

exports.handler = async function () {
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

  const urls = [
    ...STATIC_URLS.map(u => `  <url><loc>${SITE_URL}${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`),
    ...publicHandles.map(h => `  <url><loc>${SITE_URL}/u/${h}/</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    body: xml,
  };
};
