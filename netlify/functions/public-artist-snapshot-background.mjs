// netlify/functions/public-artist-snapshot-background.mjs
//
// Does the work of the public band-page snapshot (see
// lib/publicArtistSnapshot.js). A background function because a full run
// takes minutes: setlist.fm's 2 requests/second alone puts a weekly full
// refresh of 16 bands past two minutes, and scheduled functions get 30
// seconds. Netlify answers the caller 202 at once and lets this run for up
// to 15 minutes.
//
// A v2 function (export default), unlike the rest of netlify/functions,
// so Blobs takes its context from the runtime rather than from a Lambda
// event.
//
// ── Who may start it ──────────────────────────────────────────────────
//
// Anyone can POST to a function URL, and every run spends upstream API
// quota, so a run needs a one-shot token: a random nonce whose blob,
// trigger/<nonce>, exists in the site's own Blobs store. Only code running
// on this site (the scheduler, public-artist-snapshot.mjs) or someone with
// Netlify access to it (scripts/run-artist-snapshot.js, via the Netlify
// CLI) can write one. The blob also carries the run's options, so they
// can't be supplied by the caller either. It is deleted before the run
// starts and ignored once 10 minutes old.
//
//   trigger/<nonce> = { createdAt, force: false | true | 'full', only: [slugs] | null, by }

import { getStore } from '@netlify/blobs';
import snapshot from './lib/publicArtistSnapshot.js';

const { STORE_NAME, wrapBlobStore, runSnapshot } = snapshot;
const TOKEN_TTL_MS = 10 * 60 * 1000;

async function readNonce(req) {
  let body = {};
  try { body = JSON.parse((await req.text()) || '{}'); } catch { /* fall through to the query */ }
  const nonce = String(body.nonce || new URL(req.url).searchParams.get('nonce') || '');
  return /^[a-f0-9]{32,64}$/.test(nonce) ? nonce : '';
}

export default async (req) => {
  console.log(`[artist-snapshot] invoked (${req.method})`);

  const nonce = await readNonce(req);
  if (!nonce) {
    console.warn('[artist-snapshot] rejected: no valid nonce');
    return new Response('Unauthorized', { status: 401 });
  }

  // Imported here, not through the lib's require(): a v2 bundle leaves a
  // require() inside a function unresolved ("Cannot find module
  // '@netlify/blobs'" on the first preview run).
  const store = wrapBlobStore(getStore({ name: STORE_NAME, consistency: 'strong' }));
  const token = await store.get(`trigger/${nonce}`);
  if (!token) {
    console.warn('[artist-snapshot] rejected: unknown nonce');
    return new Response('Unauthorized', { status: 401 });
  }
  await store.delete(`trigger/${nonce}`);
  if (!(Date.now() - Date.parse(token.createdAt) < TOKEN_TTL_MS)) {
    console.warn('[artist-snapshot] rejected: expired nonce');
    return new Response('Unauthorized', { status: 401 });
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
  return new Response(null, { status: 202 });
};
