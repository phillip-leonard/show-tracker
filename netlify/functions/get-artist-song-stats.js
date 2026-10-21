const https = require('https');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

const PAGES_TO_FETCH = 10; // up to 200 setlists

function fetchSetlistsPage(mbid, page) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/artist/${mbid}/setlists?p=${page}`,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        'Accept': 'application/json',
        'User-Agent': 'ShowTrackerApp/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ setlist: [], total: 0, itemsPerPage: 20 }); }
      });
    });

    req.on('error', () => resolve({ setlist: [], total: 0, itemsPerPage: 20 }));
    req.end();
  });
}

function aggregateSongs(setlists) {
  const songMap = {};

  for (const sl of setlists) {
    const date = sl.eventDate; // dd-MM-yyyy
    const venue = sl.venue?.name || '';
    const city = sl.venue?.city?.name || '';
    const country = sl.venue?.city?.country?.code || '';
    const setlistUrl = sl.url || '';

    for (const set of (sl.sets?.set || [])) {
      for (const song of (set.song || [])) {
        const name = song.name?.trim();
        if (!name) continue;

        if (!songMap[name]) {
          songMap[name] = { name, count: 0, plays: [] };
        }
        songMap[name].count++;
        songMap[name].plays.push({ date, venue, city, country, setlistUrl });
      }
    }
  }

  // Sort by play count desc, then alphabetically
  return Object.values(songMap).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { mbid } = event.queryStringParameters || {};
  if (!mbid) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'mbid is required' }) };
  }

  try {
    // Fetch page 1 first to get total count
    const firstPage = await fetchSetlistsPage(mbid, 1);
    const total = firstPage.total || 0;
    const itemsPerPage = firstPage.itemsPerPage || 20;
    const totalPages = Math.ceil(total / itemsPerPage);
    const pagesToFetch = Math.min(PAGES_TO_FETCH, totalPages);

    // Fetch remaining pages in parallel
    const extraPages = [];
    for (let p = 2; p <= pagesToFetch; p++) {
      extraPages.push(fetchSetlistsPage(mbid, p));
    }
    const rest = await Promise.all(extraPages);

    const allSetlists = [
      ...(firstPage.setlist || []),
      ...rest.flatMap(p => p.setlist || []),
    ];

    const songs = aggregateSongs(allSetlists);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        songs,
        totalSetlistsFetched: allSetlists.length,
        totalSetlistsAvailable: total,
        artistName: firstPage.setlist?.[0]?.artist?.name || '',
        mbid,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('get-artist-song-stats error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to fetch song stats', details: err.message }),
    };
  }
};
