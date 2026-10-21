// netlify/functions/lib/heardShares.js
//
// Share codes for "Songs I've heard" (heardRecord.js) normally travel whole
// in the URL: /heard/<slug>/r/a<code>/. A selection too long for a sane URL
// (about 900 shows) is stored instead, in Netlify Blobs store
// "heard-shares", and the URL carries 'b' + a short id.
//
//   heard-shares/<slug>/<id> = { code, createdAt }
//
// The id is a hash of the band and the code, so saving the same selection
// twice stores it once, and nothing in it identifies anyone: the code is a
// list of show dates. heard-share.js writes; the share page, its images and
// the app's sign-up handoff read through resolveCode().

const crypto = require('crypto');

const STORE_NAME = 'heard-shares';
const INLINE_CODE = /^a[A-Za-z0-9_-]{1,2000}$/;
const STORED_ID = /^b[A-Za-z0-9_-]{16}$/;
// About 10,000 shows: far past any real record, small enough that the store
// can't be used as a file host.
const MAX_STORED_CODE = 16000;
const STORED_CODE = new RegExp(`^a[A-Za-z0-9_-]{1,${MAX_STORED_CODE}}$`);

function openShareStore(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  connectLambda(event);
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: (key, value) => store.setJSON(key, value),
  };
}

function shareId(slug, code) {
  return `b${crypto.createHash('sha256').update(`${slug}\n${code}`).digest('base64url').slice(0, 16)}`;
}

const shareKey = (slug, id) => `${slug}/${id}`;

/** Stores a long code; resolves its id. */
async function storeCode(store, slug, code, now = Date.now()) {
  const id = shareId(slug, code);
  const existing = await store.get(shareKey(slug, id));
  if (!existing) await store.set(shareKey(slug, id), { code, createdAt: new Date(now).toISOString() });
  return id;
}

/**
 * The share code a URL segment stands for: itself for an inline code, the
 * stored code for an id, '' for anything else or an id nobody stored.
 * `openStore` is called only when a store is needed.
 */
async function resolveCode(openStore, slug, segment) {
  const value = String(segment || '');
  if (INLINE_CODE.test(value)) return value;
  if (!STORED_ID.test(value)) return '';
  const saved = await openStore().get(shareKey(slug, value));
  return saved && typeof saved.code === 'string' && STORED_CODE.test(saved.code) ? saved.code : '';
}

module.exports = { STORE_NAME, INLINE_CODE, STORED_ID, STORED_CODE, MAX_STORED_CODE, openShareStore, shareId, storeCode, resolveCode };
