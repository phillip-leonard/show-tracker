const { withCors } = require('./lib/cors');
const https = require('https');
const querystring = require('querystring');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;

// --- Promisified POST to Spotify token endpoint ---

function postSpotifyToken(formData) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(formData);
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse Spotify token response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
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

  if (!SPOTIFY_CLIENT_ID) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Spotify client ID not configured' }),
    };
  }

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

  const { action } = parsed;

  try {
    if (action === 'exchange') {
      // Exchange auth code for tokens (PKCE flow)
      const { code, codeVerifier, redirectUri } = parsed;
      if (!code || !codeVerifier || !redirectUri) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing code, codeVerifier, or redirectUri' }),
        };
      }

      const { statusCode, body } = await postSpotifyToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: codeVerifier,
      });

      if (statusCode !== 200) {
        console.error('Spotify token exchange failed:', body);
        return {
          statusCode: statusCode === 400 ? 400 : 502,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: body.error_description || body.error || 'Token exchange failed',
          }),
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_in: body.expires_in,
          token_type: body.token_type,
          scope: body.scope,
        }),
      };
    }

    if (action === 'refresh') {
      // Refresh an expired access token
      const { refreshToken } = parsed;
      if (!refreshToken) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing refreshToken' }),
        };
      }

      const { statusCode, body } = await postSpotifyToken({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: SPOTIFY_CLIENT_ID,
      });

      if (statusCode !== 200) {
        console.error('Spotify token refresh failed:', body);
        return {
          statusCode: statusCode === 400 ? 400 : 502,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: body.error_description || body.error || 'Token refresh failed',
          }),
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          access_token: body.access_token,
          refresh_token: body.refresh_token || refreshToken,
          expires_in: body.expires_in,
          token_type: body.token_type,
        }),
      };
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid action. Use "exchange" or "refresh".' }),
    };
  } catch (err) {
    console.error('spotify-token error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
