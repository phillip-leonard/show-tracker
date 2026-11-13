const { withCors } = require('./lib/cors');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * Generate an Apple Music Developer Token (JWT) signed with ES256.
 * Uses Node.js crypto module — no external JWT library needed.
 */
function generateDeveloperToken() {
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  let privateKeyPem = (process.env.APPLE_MUSIC_PRIVATE_KEY || '');

  if (!keyId || !teamId || !privateKeyPem) {
    throw new Error('Apple Music credentials not configured');
  }

  // Handle both literal \n strings and actual newlines in env var
  privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');

  // Some env var UIs store as a single line with spaces instead of newlines
  // Apple .p8 files use "-----BEGIN PRIVATE KEY-----" header
  // Try to detect and fix common formatting issues:

  // 1. If key has no newlines and no headers, it's raw base64
  // 2. If key has headers but no newlines between them and the body, fix that
  // 3. If key uses EC PRIVATE KEY header instead of PRIVATE KEY, convert

  // Strip any surrounding quotes that might have been included
  privateKeyPem = privateKeyPem.replace(/^["']|["']$/g, '');

  // Handle the case where the entire PEM is on one line with spaces
  if (!privateKeyPem.includes('\n') && privateKeyPem.includes('-----BEGIN')) {
    // Replace spaces between PEM sections with newlines
    privateKeyPem = privateKeyPem
      .replace(/-----BEGIN (EC )?PRIVATE KEY----- ?/, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/ ?-----END (EC )?PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----');
    // The base64 body might have spaces — remove them
    const lines = privateKeyPem.split('\n');
    if (lines.length === 3) {
      lines[1] = lines[1].replace(/ /g, '');
      privateKeyPem = lines.join('\n');
    }
  }

  // Normalize EC PRIVATE KEY to PRIVATE KEY (Apple .p8 files are PKCS#8)
  privateKeyPem = privateKeyPem.replace('-----BEGIN EC PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----');
  privateKeyPem = privateKeyPem.replace('-----END EC PRIVATE KEY-----', '-----END PRIVATE KEY-----');

  // Ensure PEM headers are present (raw base64 without headers)
  if (!privateKeyPem.includes('-----BEGIN')) {
    // Clean any whitespace/newlines from the raw base64
    const cleanBase64 = privateKeyPem.replace(/\s+/g, '');
    privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${cleanBase64}\n-----END PRIVATE KEY-----`;
  }

  // Ensure there are newlines after header and before footer
  privateKeyPem = privateKeyPem
    .replace(/(-----BEGIN PRIVATE KEY-----)([^\n])/, '$1\n$2')
    .replace(/([^\n])(-----END PRIVATE KEY-----)/, '$1\n$2');

  // JWT Header
  const header = {
    alg: 'ES256',
    kid: keyId,
  };

  // JWT Payload — valid for 30 days (max 180)
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + (30 * 24 * 60 * 60), // 30 days
  };

  // Base64url encode
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64 = b64url(header);
  const payloadB64 = b64url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Parse the private key as PKCS#8 PEM
  const privateKey = crypto.createPrivateKey({
    key: privateKeyPem,
    format: 'pem',
  });

  // Sign with ES256 (ECDSA using P-256 and SHA-256)
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  sign.end();

  const derSignature = sign.sign(privateKey);

  // Convert DER-encoded signature to raw r||s format (64 bytes) for JWT
  const rawSignature = derToRaw(derSignature);

  const signatureB64 = rawSignature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signatureB64}`;
}

/**
 * Convert DER-encoded ECDSA signature to raw r||s format.
 * DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
 */
function derToRaw(derSig) {
  let offset = 2; // skip 0x30 and total length byte
  if (derSig[offset] === 0x02) {
    const rLen = derSig[offset + 1];
    const rStart = offset + 2;
    const r = derSig.slice(rStart, rStart + rLen);

    offset = rStart + rLen;
    const sLen = derSig[offset + 1];
    const sStart = offset + 2;
    const s = derSig.slice(sStart, sStart + sLen);

    // Pad or trim r and s to exactly 32 bytes each
    const rPadded = padOrTrim(r, 32);
    const sPadded = padOrTrim(s, 32);

    return Buffer.concat([rPadded, sPadded]);
  }
  throw new Error('Invalid DER signature format');
}

function padOrTrim(buf, len) {
  if (buf.length === len) return buf;
  if (buf.length > len) {
    // Remove leading zero padding
    return buf.slice(buf.length - len);
  }
  // Pad with leading zeros
  const padded = Buffer.alloc(len, 0);
  buf.copy(padded, len - buf.length);
  return padded;
}

// --- Optional Firestore caching ---

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
    const { getFirestore } = require('firebase-admin/firestore');
    return getFirestore();
  } catch (e) {
    console.warn('[APPLE MUSIC] Firebase init failed:', e.message);
    return null;
  }
}

// --- Handler ---

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Check Firestore cache first
    const db = getDb();
    if (db) {
      try {
        const snap = await db.collection('appleMusicTokens').doc('developer').get();
        if (snap.exists) {
          const cached = snap.data();
          if (cached.expiresAt > Date.now()) {
            return {
              statusCode: 200,
              headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' },
              body: JSON.stringify({ token: cached.token, expiresAt: cached.expiresAt }),
            };
          }
        }
      } catch (_) {
        // Cache read failed — continue
      }
    }

    // Generate fresh token
    const token = generateDeveloperToken();
    const expiresAt = Date.now() + (29 * 24 * 60 * 60 * 1000); // 29 days (1 day buffer)

    // Cache it (fire-and-forget)
    if (db) {
      db.collection('appleMusicTokens').doc('developer').set({
        token,
        expiresAt,
        generatedAt: Date.now(),
      }).catch(() => {});
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' },
      body: JSON.stringify({ token, expiresAt }),
    };
  } catch (err) {
    console.error('apple-music-token error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || 'Failed to generate Apple Music token' }),
    };
  }
};

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
