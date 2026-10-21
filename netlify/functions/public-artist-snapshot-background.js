// netlify/functions/public-artist-snapshot-background.js
//
// Does the work of the public band-page snapshot (see
// lib/publicArtistSnapshot.js). A background function because a full run
// takes minutes: setlist.fm's 2 requests/second alone puts a weekly full
// refresh of 16 bands past two minutes, and scheduled functions get 30
// seconds. Netlify answers the caller 202 at once and lets this run for up
// to 15 minutes.
//
// ── Who may start it ──────────────────────────────────────────────────
//
// Anyone can POST to a function URL, and every run spends upstream API
// quota, so a run needs a one-shot token: a random nonce whose blob,
// trigger/<nonce>, exists in the site's own Blobs store. Only code running
// on this site (the scheduler, public-artist-snapshot.js) or someone with
// Netlify access to it (scripts/run-artist-snapshot.js, via the Netlify
// CLI) can write one. The blob also carries the run's options, so they
// can't be supplied by the caller either. It is deleted before the run
// starts and ignored once 10 minutes old.
//
//   trigger/<nonce> = { createdAt, force: false | true | 'full', only: [slugs] | null, by }

const { openBlobStore, runSnapshot } = require('./lib/publicArtistSnapshot');

const TOKEN_TTL_MS = 10 * 60 * 1000;

function readNonce(event) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* fall through to the query */ }
  const nonce = String(body.nonce || event.queryStringParameters?.nonce || '');
  return /^[a-f0-9]{32,64}$/.test(nonce) ? nonce : '';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const nonce = readNonce(event);
  if (!nonce) {
    console.warn('[artist-snapshot] rejected: no valid nonce');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const store = openBlobStore(event, { strong: true });
  const token = await store.get(`trigger/${nonce}`);
  if (!token) {
    console.warn('[artist-snapshot] rejected: unknown nonce');
    return { statusCode: 401, body: 'Unauthorized' };
  }
  await store.delete(`trigger/${nonce}`);
  if (!(Date.now() - Date.parse(token.createdAt) < TOKEN_TTL_MS)) {
    console.warn('[artist-snapshot] rejected: expired nonce');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const force = token.force === 'full' ? 'full' : token.force === true;
  const only = Array.isArray(token.only) && token.only.length ? token.only.map(String) : null;
  console.log(`[artist-snapshot] run started by ${token.by || 'unknown'} force=${force} only=${only ? only.join(',') : 'all'}`);

  try {
    const report = await runSnapshot({ store, force, only });
    const summary = report.artists.map((a) => `${a.slug}:${a.status}`).join(' ');
    console.log(`[artist-snapshot] done in ${Math.round(report.durationMs / 1000)}s, ${report.writes} writes, calls ${JSON.stringify(report.calls)} — ${summary}`);
  } catch (err) {
    // runSnapshot already keeps per-artist failures to itself; reaching
    // here means the store or the index itself failed. Nothing was
    // published in a half-written state: artist blobs are whole objects,
    // and the index is written last.
    console.error('[artist-snapshot] run failed:', err);
  }
  return { statusCode: 202, body: '' };
};
