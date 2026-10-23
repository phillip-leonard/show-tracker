// netlify/functions/setlistfm-links.js
//
// GET /.netlify/functions/setlistfm-links?ids=63de4613,b99ed86
//
// The setlist.fm attribution link for each setlist id: the `url` setlist.fm
// returns for that setlist, which its API terms require us to link
// wherever its data is shown. Show documents store `setlistfmId` but not
// the url, so the show page asks here (lib/setlistfmAttribution.js).
//
// Response: { links: { [id]: { url, artist } }, notFound: [ids], pending: [ids] }
// `pending` ids were not fetched this time (time budget or rate limit); the
// client links to setlist.fm's home page for those and asks again later.
// Cached for 24 hours per setlist, shared by everyone who logged that show
// (lib/setlistCache.js).

const { missingSetlistfmKey } = require('./lib/setlistfmKey');
const { getSetlists, linkFrom } = require('./lib/setlistfmSetlist');

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const MAX_IDS = 20;

function getDb() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;
  try {
    const { getApps, initializeApp, cert } = require('firebase-admin/app');
    if (!getApps().length) {
      initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
    }
    return require('firebase-admin/firestore').getFirestore();
  } catch (e) {
    console.warn('[CACHE] Firebase init failed:', e.message);
    return null;
  }
}

exports.handler = async function (event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ids = String(event.queryStringParameters?.ids || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'ids is required' }) };
  }
  if (ids.length > MAX_IDS) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `At most ${MAX_IDS} ids per request` }) };
  }

  const { setlists, notFound, pending } = await getSetlists(getDb(), ids);
  const links = {};
  for (const [id, setlist] of Object.entries(setlists)) links[id] = linkFrom(setlist);

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
    body: JSON.stringify({ links, notFound, pending }),
  };
};
