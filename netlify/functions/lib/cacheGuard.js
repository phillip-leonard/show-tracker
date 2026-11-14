/**
 * cacheGuard — what the public cache-writing functions accept and store
 * (5.59.12, #398 follow-ups). Used by enrich-artist, get-entity-info and
 * archival-audio-lookup, whose callers are anonymous (the iOS app sends no
 * token to them).
 *
 * The rules:
 *   - inputs are validated here before they become part of a cache key
 *     (cacheName, isoDay); the key itself is always built by the function,
 *     never taken from the request, and the cached content always comes
 *     from the upstream service, never from the request
 *   - only a successful, validated upstream answer is written, and only
 *     when it is at most MAX_CACHED_BYTES (cacheable)
 *   - every cache miss that reaches the upstream counts against the
 *     `metadata` network limit (lib/proxyLimit.js checkProxyLimit), so a
 *     script can neither stuff the cache nor get Netlify's shared IP
 *     blocked by MusicBrainz or Wikipedia
 */

const MAX_NAME = 200;
const MAX_CACHED_BYTES = 100 * 1024;

/** A trimmed, single-spaced name of 1–200 printable characters, or null. */
function cacheName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s || s.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** 'YYYY-MM-DD' that is a real calendar day, or null. */
function isoDay(raw) {
  const s = String(raw == null ? '' : raw);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
}

/** Whether a response body is small enough to cache. */
function cacheable(body) {
  return typeof body === 'string' && Buffer.byteLength(body, 'utf8') <= MAX_CACHED_BYTES;
}

module.exports = { cacheName, isoDay, cacheable, MAX_NAME, MAX_CACHED_BYTES };
