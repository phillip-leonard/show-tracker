const https = require('https');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

function fetchJSON(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.setlist.fm',
      path,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        'Accept': 'application/json',
        'User-Agent': 'ShowTrackerApp/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function(event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artistName } = event.queryStringParameters || {};
  if (!artistName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'artistName is required' }) };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // 1. Search for artists matching the name
    const artistParams = new URLSearchParams({ artistName, sort: 'relevance' });
    const artistResult = await fetchJSON(`/rest/1.0/search/artists?${artistParams}`);

    if (artistResult.status !== 200 || !artistResult.data?.artist?.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No artists found', groups: [] }) };
    }

    // Take top 5 matching artists
    const artists = artistResult.data.artist.slice(0, 5);

    // 2. For each artist, fetch their latest setlists (page 1)
    const groups = await Promise.all(artists.map(async (artist) => {
      try {
        const params = new URLSearchParams({ p: '1' });
        const result = await fetchJSON(`/rest/1.0/artist/${artist.mbid}/setlists?${params}`);
        if (result.status !== 200 || !result.data?.setlist) {
          return { artist, setlists: [], total: 0 };
        }
        return {
          artist: {
            name: artist.name,
            mbid: artist.mbid,
            disambiguation: artist.disambiguation || '',
            sortName: artist.sortName || artist.name,
          },
          setlists: result.data.setlist.slice(0, 10),
          total: result.data.total || 0,
        };
      } catch {
        return { artist, setlists: [], total: 0 };
      }
    }));

    // Filter out artists with no setlists and sort by most recent show
    const nonEmpty = groups.filter(g => g.setlists.length > 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ groups: nonEmpty })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal error', details: err.message })
    };
  }
};
