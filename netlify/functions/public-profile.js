// netlify/functions/public-profile.js
//
// GET /u/{handle} — a public profile page, server-rendered as complete
// HTML so crawlers see real content without executing JavaScript. Reads
// Firestore directly via firebase-admin (never exposed to the client).
//
// Privacy gate: only rendered when userProfiles/{uid}.publicProfile is
// exactly true. A handle that exists but is private returns the same
// "not found" response as a handle that doesn't exist at all — the two
// cases are deliberately indistinguishable from the outside.
//
// Only ever reads: displayName, the shows subcollection's artist/date/
// venue/city/setlist/rating fields. Never reads or renders: show.comment,
// song.comment, taggedFriendUids (resolved separately, see
// resolvePublicTaggedFriends), wishlists, venueRatings, or friends — none
// of which this function's Firestore reads even touch.

const { escapeHtml, page, notFoundPage, CACHE_HEADERS, SITE_URL, isoDate, formatShowDate } = require('./lib/publicPageHtml');

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

const PAGE_SIZE = 30;

const formatDate = (dateStr) => formatShowDate(dateStr, 'short');

exports.handler = async function (event) {
  const db = getDb();
  if (!db) {
    return { statusCode: 503, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('This page is temporarily unavailable.') };
  }

  const handleLower = (event.queryStringParameters?.handle || '').toLowerCase().trim();
  const pageNum = Math.max(1, parseInt(event.queryStringParameters?.page, 10) || 1);

  if (!handleLower) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('No profile handle given.') };
  }

  try {
    const handleSnap = await db.collection('handles').doc(handleLower).get();
    if (!handleSnap.exists) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('No profile at this address.') };
    }
    const uid = handleSnap.data().uid;

    const profileSnap = await db.collection('userProfiles').doc(uid).get();
    if (!profileSnap.exists || profileSnap.data().publicProfile !== true) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('No profile at this address.') };
    }
    const profile = profileSnap.data();
    const displayName = profile.displayName || profile.handle || handleLower;

    const showsSnap = await db.collection('users').doc(uid).collection('shows').get();
    const shows = showsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      // Sort on the normalized date: a DD-MM-YYYY show sorted as a raw
      // string would land in the wrong place.
      .sort((a, b) => (isoDate(b.date) || b.date || '').localeCompare(isoDate(a.date) || a.date || ''));

    const artistCount = new Set(shows.map(s => s.artist)).size;
    const venueCount = new Set(shows.map(s => s.venue)).size;
    const years = new Set(shows.map(s => isoDate(s.date).slice(0, 4)).filter(Boolean));

    const totalPages = Math.max(1, Math.ceil(shows.length / PAGE_SIZE));
    const pageShows = shows.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

    const title = `${displayName} — Show History — MySetlists`;
    const description = `${displayName} has logged ${shows.length} show${shows.length !== 1 ? 's' : ''} across ${artistCount} artist${artistCount !== 1 ? 's' : ''} on MySetlists.`;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      dateCreated: profile.createdAt?.toDate ? profile.createdAt.toDate().toISOString() : undefined,
      mainEntity: {
        '@type': 'Person',
        name: displayName,
        url: `${SITE_URL}/u/${handleLower}/`,
      },
    };

    const showRows = pageShows.map(s => `
      <a class="show" href="${SITE_URL}/u/${handleLower}/shows/${encodeURIComponent(s.id)}/">
        <div class="artist">${escapeHtml(s.artist)}</div>
        <div class="meta">${formatDate(s.date)} · ${escapeHtml(s.venue)}${s.city ? `, ${escapeHtml(s.city)}` : ''}</div>
      </a>
    `).join('');

    const pagination = totalPages > 1 ? `
      <div class="sub" style="margin-top:16px;">
        ${pageNum > 1 ? `<a href="?page=${pageNum - 1}">&larr; Newer</a>` : ''}
        ${pageNum > 1 && pageNum < totalPages ? ' &middot; ' : ''}
        ${pageNum < totalPages ? `<a href="?page=${pageNum + 1}">Older &rarr;</a>` : ''}
      </div>
    ` : '';

    const bodyHtml = `
      <h1>${escapeHtml(displayName)}</h1>
      <p class="sub">Show history on MySetlists</p>
      <div class="stats">
        <div class="stat"><div class="n">${shows.length}</div><div class="l">Shows</div></div>
        <div class="stat"><div class="n">${artistCount}</div><div class="l">Artists</div></div>
        <div class="stat"><div class="n">${venueCount}</div><div class="l">Venues</div></div>
        <div class="stat"><div class="n">${years.size}</div><div class="l">Years</div></div>
      </div>
      ${showRows || '<p class="sub">No shows logged yet.</p>'}
      ${pagination}
      <div class="cta">
        <p style="margin:0 0 10px;">Track your own concert history on MySetlists.</p>
        <a href="${SITE_URL}/">Get started free</a>
      </div>
    `;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...CACHE_HEADERS },
      body: page({ title, description, canonicalPath: `/u/${handleLower}/${pageNum > 1 ? `?page=${pageNum}` : ''}`, jsonLd, bodyHtml }),
    };
  } catch (err) {
    console.error('public-profile error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
