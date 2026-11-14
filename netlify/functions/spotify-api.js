const { withCors } = require('./lib/cors');
const { requireUser } = require('./lib/requestAuth');
const https = require('https');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

// --- Friendly error messages for common Spotify status codes ---

function friendlySpotifyError(statusCode, rawMessage, context) {
  if (statusCode === 403) {
    return `Spotify access denied during "${context}". Ensure your account is added as a test user in the Spotify Developer Dashboard and you have accepted the email invitation.`;
  }
  return `${rawMessage || `Spotify error ${statusCode}`} (during ${context})`;
}

// --- Promisified HTTPS request to Spotify API ---

function spotifyRequest(method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.spotify.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        } catch (e) {
          reject(new Error(`Failed to parse Spotify response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- Handler ---

exports.handler = async function (event) {
  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Signed-in users only (5.59.12, #398 follow-ups). Playlist creation is
  // switched off (PLAYLIST_CREATION_ENABLED in lib/constants.js), so no
  // shipped build calls this; lib/spotify.js sends the token through
  // authedFetch for when it is switched on.
  const user = await requireUser(event, CORS_HEADERS);
  if (user.response) return user.response;

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { action, accessToken } = parsed;

  if (!accessToken) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing accessToken' }),
    };
  }

  try {
    // --- Get current user ---
    if (action === 'getMe') {
      const { statusCode, body } = await spotifyRequest('GET', '/v1/me', accessToken);
      if (statusCode === 401) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Token expired' }) };
      }
      if (statusCode < 200 || statusCode >= 300) {
        const raw = body?.error?.message || body?.error;
        const msg = friendlySpotifyError(statusCode, raw, 'get user');
        return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) };
      }
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ id: body.id, displayName: body.display_name }),
      };
    }

    // --- Search tracks ---
    if (action === 'search') {
      const { query } = parsed;
      if (!query) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing query' }) };
      }
      const encodedQuery = encodeURIComponent(query);
      const { statusCode, headers: resHeaders, body } = await spotifyRequest(
        'GET',
        `/v1/search?q=${encodedQuery}&type=track&limit=5`,
        accessToken,
      );

      if (statusCode === 429) {
        const retryAfter = parseInt(resHeaders['retry-after'] || '5', 10);
        return {
          statusCode: 429,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Rate limited', retryAfter }),
        };
      }
      if (statusCode === 401) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Token expired' }) };
      }
      if (statusCode < 200 || statusCode >= 300) {
        const raw = body?.error?.message || body?.error;
        const msg = friendlySpotifyError(statusCode, raw, 'search');
        return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) };
      }

      const tracks = (body.tracks?.items || []).map(t => ({
        uri: t.uri,
        name: t.name,
        artist: t.artists?.[0]?.name || '',
        album: t.album?.name || '',
        previewUrl: t.preview_url,
        externalUrl: t.external_urls?.spotify,
      }));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ tracks }),
      };
    }

    // --- Create playlist ---
    if (action === 'createPlaylist') {
      const { userId, name, description, isPublic } = parsed;
      if (!userId || !name) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing userId or name' }) };
      }

      const { statusCode, body } = await spotifyRequest(
        'POST',
        `/v1/users/${encodeURIComponent(userId)}/playlists`,
        accessToken,
        {
          name,
          description: description || '',
          public: isPublic !== false,
        },
      );

      if (statusCode === 429) {
        return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Rate limited', retryAfter: 5 }) };
      }
      if (statusCode === 401) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Token expired' }) };
      }
      if (statusCode < 200 || statusCode >= 300) {
        const raw = body?.error?.message || body?.error;
        const msg = friendlySpotifyError(statusCode, raw, 'create playlist');
        return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          id: body.id,
          name: body.name,
          externalUrl: body.external_urls?.spotify,
        }),
      };
    }

    // --- Add tracks to playlist ---
    if (action === 'addTracks') {
      const { playlistId, trackUris } = parsed;
      if (!playlistId || !trackUris?.length) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing playlistId or trackUris' }) };
      }

      // Spotify accepts max 100 tracks per request
      const batches = [];
      for (let i = 0; i < trackUris.length; i += 100) {
        batches.push(trackUris.slice(i, i + 100));
      }

      let snapshotId;
      for (const batch of batches) {
        const { statusCode, body } = await spotifyRequest(
          'POST',
          `/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
          accessToken,
          { uris: batch },
        );

        if (statusCode === 429) {
          return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Rate limited', retryAfter: 5 }) };
        }
        if (statusCode === 401) {
          return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Token expired' }) };
        }
        if (statusCode < 200 || statusCode >= 300) {
          const raw = body?.error?.message || body?.error;
          const msg = friendlySpotifyError(statusCode, raw, 'add tracks');
          return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) };
        }
        snapshotId = body.snapshot_id;
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ snapshotId, tracksAdded: trackUris.length }),
      };
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid action. Use "getMe", "search", "createPlaylist", or "addTracks".' }),
    };
  } catch (err) {
    console.error('spotify-api error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
