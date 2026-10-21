const https = require('https');
const { setlistfmKey, missingSetlistfmKey } = require('./lib/setlistfmKey');

exports.handler = async function(event) {
  const missingKey = missingSetlistfmKey();
  if (missingKey) return missingKey;

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { artistName } = event.queryStringParameters || {};
  if (!artistName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'artistName is required' }) };
  }

  const params = new URLSearchParams({ artistName, sort: 'relevance' });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.setlist.fm',
      path: `/rest/1.0/search/artists?${params.toString()}`,
      method: 'GET',
      headers: {
        'x-api-key': setlistfmKey(),
        'Accept': 'application/json',
        'User-Agent': 'ShowTrackerApp/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Return the first matching artist with mbid
          const artist = parsed.artist?.[0] || null;
          resolve({
            statusCode: artist ? 200 : 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(artist || { error: 'Artist not found' })
          });
        } catch (error) {
          resolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Failed to parse response', details: error.message })
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Request failed', details: error.message })
      });
    });

    req.end();
  });
};
