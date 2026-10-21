// netlify/functions/heard-share.js
//
//   POST /api/heard-share  { slug, code }  ->  { ok, id }
//   GET  /api/heard-share?slug=&id=        ->  { ok, code }
//
// Stores a "Songs I've heard" selection too long to put in a link (see
// lib/heardShares.js) and hands it back by id: the GET is for the app's
// sign-up handoff, which needs the code itself. A code is only show dates,
// so nothing stored here is personal.

const { findArtist, hasShowList } = require('./lib/publicArtistSnapshot');
const { openShareStore, storeCode, resolveCode, STORED_CODE, STORED_ID } = require('./lib/heardShares');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, body, cache = 'no-store') => ({ statusCode, headers: { ...JSON_HEADERS, 'Cache-Control': cache }, body: JSON.stringify(body) });

const knownBand = (slug) => {
  const artist = /^[a-z0-9-]+$/.test(slug) && findArtist(slug);
  return !!artist && hasShowList(artist);
};

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { ok: false, error: 'bad_request' }); }
      const slug = String(body.slug || '');
      const code = String(body.code || '');
      if (!knownBand(slug) || !STORED_CODE.test(code)) return reply(400, { ok: false, error: 'bad_request' });
      const id = await storeCode(openShareStore(event), slug, code);
      return reply(200, { ok: true, id });
    }

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const slug = String(q.slug || '');
      const id = String(q.id || '');
      if (!knownBand(slug) || !STORED_ID.test(id)) return reply(404, { ok: false, error: 'not_found' });
      const code = await resolveCode(() => openShareStore(event), slug, id);
      if (!code) return reply(404, { ok: false, error: 'not_found' });
      // A stored code never changes.
      return reply(200, { ok: true, code }, 'public, max-age=86400, immutable');
    }

    return reply(405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('heard-share error:', err);
    return reply(500, { ok: false, error: 'server_error' });
  }
};
