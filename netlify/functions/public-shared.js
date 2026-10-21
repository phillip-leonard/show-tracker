// netlify/functions/public-shared.js
//
// GET /shared/{id} — a shared collection snapshot, server-rendered as
// complete HTML. Resurrects the old client-side-fetch /shared page (deleted
// in the Capacitor migration, commit 3de824b) using this feature's
// server-rendered-HTML pattern instead, since the old version fetched its
// data and injected its JSON-LD client-side and was therefore never
// actually indexable.
//
// No privacy gate beyond what already existed: create-shared-collection.js
// only ever writes a pre-sanitized snapshot (artist/venue/city/date/rating
// and per-song name/rating) — there is no comment, photo, or friend-tag
// data in a sharedCollections doc at all, so nothing further needs to be
// stripped here.

const { escapeHtml, page, notFoundPage, CACHE_HEADERS, SITE_URL } = require('./lib/publicPageHtml');
const { routeParams } = require('./lib/publicRouteParams');

function getDb() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (!getApps().length) {
    initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
  }
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore();
}

function formatDate(dateStr) {
  const m = (dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

exports.handler = async function (event) {
  const db = getDb();
  if (!db) {
    return { statusCode: 503, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('This page is temporarily unavailable.') };
  }

  const { id } = routeParams(event, 'shared');
  if (!id) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Collection not found.') };
  }

  try {
    const snap = await db.collection('sharedCollections').doc(id).get();
    if (!snap.exists) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('This shared collection was not found.') };
    }
    const data = snap.data();
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      return { statusCode: 410, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('This shared collection has expired.') };
    }

    const ownerName = data.ownerName || 'A Fan';
    const shows = (data.shows || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stats = data.stats || {};

    const title = `${ownerName}'s Concert Collection — MySetlists`;
    const description = `${ownerName} has logged ${stats.totalShows || shows.length} shows and ${stats.totalSongs || 0} songs on MySetlists.`;

    const showRows = shows.map(s => `
      <div class="show">
        <div class="artist">${escapeHtml(s.artist)}</div>
        <div class="meta">${formatDate(s.date)} · ${escapeHtml(s.venue)}${s.city ? `, ${escapeHtml(s.city)}` : ''}${s.rating ? ` · ${s.rating}/10` : ''}</div>
      </div>
    `).join('');

    const bodyHtml = `
      <h1>${escapeHtml(ownerName)}'s Concert Collection</h1>
      <p class="sub">Shared from MySetlists</p>
      <div class="stats">
        <div class="stat"><div class="n">${stats.totalShows || shows.length}</div><div class="l">Shows</div></div>
        <div class="stat"><div class="n">${stats.totalSongs || 0}</div><div class="l">Songs</div></div>
        ${stats.avgRating ? `<div class="stat"><div class="n">${stats.avgRating}</div><div class="l">Avg Rating</div></div>` : ''}
      </div>
      ${showRows || '<p class="sub">No shows in this collection.</p>'}
      <div class="cta">
        <p style="margin:0 0 10px;">Track your own concert history on MySetlists.</p>
        <a href="${SITE_URL}/">Get started free</a>
      </div>
    `;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...CACHE_HEADERS },
      body: page({ title, description, canonicalPath: `/shared/${id}/`, bodyHtml }),
    };
  } catch (err) {
    console.error('public-shared error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
