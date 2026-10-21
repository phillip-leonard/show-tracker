// netlify/functions/public-artist-snapshot.mjs
//
// Scheduled every 6 hours (netlify.toml). Starts the public band-page
// snapshot by writing a one-shot token to Blobs and handing it to
// public-artist-snapshot-background.mjs, which does the actual fetching:
// a scheduled function only gets 30 seconds. See that file for the token
// and for why both are v2 functions, and lib/publicArtistSnapshot.js for
// which artists a run refreshes (Phish every 6 hours, everyone else daily).
//
// "Run now" on this function in the Netlify UI is the manual trigger for a
// normal run. For a forced or single-artist run, use
// scripts/run-artist-snapshot.js.

import crypto from 'node:crypto';
import snapshot from './lib/publicArtistSnapshot.js';

export default async () => {
  const store = snapshot.openBlobStore(null, { strong: true });
  const nonce = crypto.randomBytes(24).toString('hex');
  await store.set(`trigger/${nonce}`, { createdAt: new Date().toISOString(), force: false, only: null, by: 'schedule' });

  const base = process.env.URL || 'https://mysetlists.net';
  const res = await fetch(`${base}/.netlify/functions/public-artist-snapshot-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  console.log(`[artist-snapshot] background run requested: HTTP ${res.status}`);
  return new Response(null, { status: 200 });
};
