/**
 * aiScan — what analyze-tickets and analyze-screenshot share: who may
 * scan, how often, what an image must look like before it goes to
 * Anthropic, the call itself, and what comes back to the client.
 *
 * WHO MAY SCAN (5.59.6).
 *   - REQUIRE_AUTH_AI=true  → a valid Firebase ID token is required (401
 *     without one). Turned on in Netlify once the iOS build that sends a
 *     token is live; until then the current iOS app (3.13.5 and earlier)
 *     sends none and would lose scanning entirely.
 *   - With a valid token, either way: AI_USER_DAILY_LIMIT scans per user
 *     per UTC day (admins exempt).
 *   - Without a token while enforcement is off: a shared pool of
 *     AI_ANON_DAILY_LIMIT scans a day, and AI_ANON_IP_DAILY_LIMIT per
 *     client IP. That's the interim cap on what an unauthenticated caller
 *     can spend; each tokenless scan logs the pool count so its decline
 *     can be watched before enforcement is turned on.
 *
 * WHAT GOES BACK. Generic messages only: never Anthropic's error body,
 * status code or the model's raw text, and never a configuration detail.
 * Old clients show `data.error` verbatim, so every message is written for
 * a person. Images and results are never logged.
 */

const https = require('https');
const { getDb } = require('./firebaseAdmin');
const { optionalUser } = require('./requestAuth');
const { takeDailyQuota, clientIp, ipHash } = require('./rateLimit');

const AI_USER_DAILY_LIMIT = 20;
const AI_ANON_DAILY_LIMIT = 100;
const AI_ANON_IP_DAILY_LIMIT = 10;
const MAX_TICKET_IMAGES = 10;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // decoded; Anthropic's own cap is 5 MB
const MAX_BODY_CHARS = 6 * 1024 * 1024; // Netlify's synchronous request limit
const ANTHROPIC_TIMEOUT_MS = 24000;

const MESSAGES = {
  signIn: 'Create a free account (or sign in and update the app) to scan tickets.',
  userLimit: `You've scanned ${AI_USER_DAILY_LIMIT} times today. Try again tomorrow.`,
  busy: 'Ticket scanning is busy right now. Try again tomorrow, or sign in to scan.',
  unavailable: 'Scanning isn’t available right now. Please try again in a few minutes.',
  badImage: 'That image couldn’t be read. Try a JPG or PNG photo.',
  tooLarge: 'That image is too large. Try a smaller photo or a screenshot.',
  tooMany: `Scan up to ${MAX_TICKET_IMAGES} tickets at a time.`,
  badRequest: 'Something went wrong sending your image. Please try again.',
};

function authEnforced() {
  return String(process.env.REQUIRE_AUTH_AI || '').toLowerCase() === 'true';
}

// ── Images ───────────────────────────────────────────────────────────

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** What the bytes actually are, from their first few, or null. */
function sniffMediaType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * One image as the client sent it → { image } ready for Anthropic, or
 * { error } (a MESSAGES key). Nothing that isn't a real image of an
 * allowed type, under the size cap, gets through.
 */
function checkImage(base64, mediaType) {
  if (typeof base64 !== 'string' || typeof mediaType !== 'string') return { error: 'badImage' };
  const type = mediaType.toLowerCase().trim();
  if (!MEDIA_TYPES.includes(type)) return { error: 'badImage' };
  const data = base64.replace(/\s+/g, '');
  if (!data || !BASE64.test(data)) return { error: 'badImage' };
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) return { error: 'tooLarge' };
  const head = Buffer.from(data.slice(0, 24), 'base64');
  if (sniffMediaType(head) !== type) return { error: 'badImage' };
  return { image: { type: 'image', source: { type: 'base64', media_type: type, data } } };
}

// ── Who may scan ─────────────────────────────────────────────────────

/**
 * gate(event, headers) → { response } to send now, or { ok: true, user }.
 * Counts this scan against whichever limit applies.
 */
async function gate(event, headers, { now = Date.now() } = {}) {
  const reply = (statusCode, error, code) => ({ response: { statusCode, headers, body: JSON.stringify({ error, code }) } });
  const user = await optionalUser(event);
  if (!user && authEnforced()) return reply(401, MESSAGES.signIn, 'auth_required');

  try {
    const db = getDb();
    if (user) {
      if (user.isAdmin) return { ok: true, user };
      const q = await takeDailyQuota(db, `ai_${user.uid}`, AI_USER_DAILY_LIMIT, { now, uid: user.uid });
      return q.allowed ? { ok: true, user } : reply(429, MESSAGES.userLimit, 'daily_limit');
    }
    const perIp = await takeDailyQuota(db, `ai_anon_ip_${ipHash(clientIp(event))}`, AI_ANON_IP_DAILY_LIMIT, { now });
    if (!perIp.allowed) return reply(429, MESSAGES.busy, 'anon_limit');
    const pool = await takeDailyQuota(db, 'ai_anon_global', AI_ANON_DAILY_LIMIT, { now });
    // Counts only: this line is how the decline of tokenless (old iOS)
    // scans gets watched before REQUIRE_AUTH_AI is turned on.
    console.log(`[ai-scan] tokenless scan ${pool.allowed ? 'allowed' : 'refused'}: ${pool.count}/${AI_ANON_DAILY_LIMIT} today`);
    return pool.allowed ? { ok: true, user: null } : reply(429, MESSAGES.busy, 'anon_limit');
  } catch (e) {
    // Fail closed: if the counter can't be read, nobody spends.
    console.error('[ai-scan] rate limit unavailable:', e.message);
    return reply(503, MESSAGES.unavailable, 'unavailable');
  }
}

// ── Anthropic ────────────────────────────────────────────────────────

/** POST /v1/messages → { ok: true, text } or { ok: false } (details logged, not returned). */
function callClaude(content) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[ai-scan] ANTHROPIC_API_KEY is not set');
    return Promise.resolve({ ok: false });
  }
  const requestBody = JSON.stringify({
    model: 'claude-sonnet-5-5',
    // Thinking counts toward max_tokens, and this model thinks by default.
    max_tokens: 16000,
    // Plain extraction, and this function has to answer inside Netlify's
    // synchronous limit. The model's default effort is high.
    output_config: { effort: 'low' },
    fallbacks: 'default',
    messages: [{ role: 'user', content }],
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // The error type only — never the request, which holds the image.
          let type = '';
          try { type = JSON.parse(data).error?.type || ''; } catch { /* not JSON */ }
          console.error('[ai-scan] Anthropic error', res.statusCode, type);
          resolve({ ok: false });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
          resolve({ ok: true, text });
        } catch {
          console.error('[ai-scan] Anthropic response was not JSON');
          resolve({ ok: false });
        }
      });
    });
    req.setTimeout(ANTHROPIC_TIMEOUT_MS, () => { req.destroy(new Error('timeout')); });
    req.on('error', (error) => {
      console.error('[ai-scan] request to Anthropic failed:', error.message);
      resolve({ ok: false });
    });
    req.write(requestBody);
    req.end();
  });
}

/** The model's text → a clean array of { artist, venue, date, city } (null when there's no array). */
function parseShows(text) {
  const match = String(text || '').match(/\[[\s\S]*\]/);
  if (!match) return null;
  let rows;
  try { rows = JSON.parse(match[0]); } catch { return null; }
  if (!Array.isArray(rows)) return [];
  const field = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  return rows
    .filter((r) => r && typeof r === 'object')
    .slice(0, 100)
    .map((r) => ({ artist: field(r.artist), venue: field(r.venue), date: field(r.date), city: field(r.city) }));
}

// ── The shared handler ───────────────────────────────────────────────

let testClaude = null; // unit tests swap the network call out

/**
 * handleScan(event, { headers, readImages, prompt, failMessage, noShowsMessage })
 *   readImages(body) → { images: [{ base64, mediaType }] } | { error }
 */
async function handleScan(event, { headers, readImages, prompt, failMessage, noShowsMessage }) {
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  // Shape and size first: a bad request costs nothing, not even a counter.
  if (typeof event.body !== 'string' || event.body.length > MAX_BODY_CHARS) {
    return reply(event.body ? 413 : 400, { error: event.body ? MESSAGES.tooLarge : MESSAGES.badRequest });
  }
  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: MESSAGES.badRequest }); }
  if (!body || typeof body !== 'object') return reply(400, { error: MESSAGES.badRequest });

  const read = readImages(body);
  if (read.error) return reply(read.error === 'tooLarge' ? 413 : 400, { error: MESSAGES[read.error] || MESSAGES.badRequest });
  const content = [];
  for (const img of read.images) {
    const checked = checkImage(img && img.base64, img && img.mediaType);
    if (checked.error) return reply(checked.error === 'tooLarge' ? 413 : 400, { error: MESSAGES[checked.error] });
    content.push(checked.image);
  }

  const allowed = await gate(event, headers);
  if (allowed.response) return allowed.response;

  content.push({ type: 'text', text: prompt });
  const result = await (testClaude || callClaude)(content);
  if (!result.ok) return reply(502, { error: failMessage });
  const shows = parseShows(result.text);
  if (shows === null) return reply(422, { error: noShowsMessage });
  return reply(200, { shows });
}

/** analyze-tickets: { images: [{ base64, mediaType }, …] }, 1 to MAX_TICKET_IMAGES. */
function readTicketImages(body) {
  const { images } = body;
  if (!Array.isArray(images) || images.length === 0) return { error: 'badRequest' };
  if (images.length > MAX_TICKET_IMAGES) return { error: 'tooMany' };
  return { images };
}

/** analyze-screenshot: { image, mediaType }, exactly one. */
function readScreenshotImage(body) {
  if (!body.image || !body.mediaType) return { error: 'badRequest' };
  return { images: [{ base64: body.image, mediaType: body.mediaType }] };
}

module.exports = {
  handleScan, readTicketImages, readScreenshotImage,
  checkImage, sniffMediaType, parseShows, gate, authEnforced,
  MESSAGES, AI_USER_DAILY_LIMIT, AI_ANON_DAILY_LIMIT, AI_ANON_IP_DAILY_LIMIT, MAX_TICKET_IMAGES, MAX_IMAGE_BYTES,
  __setTestClaude: (fn) => { testClaude = fn; },
};
