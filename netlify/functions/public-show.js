// netlify/functions/public-show.js
//
// GET /u/{handle}/shows/{showId} — a single public show page. Same privacy
// gate as public-profile.js (handle must resolve to a uid whose
// userProfiles.publicProfile is exactly true), plus the show itself must
// belong to that uid.
//
// Field allow-list is deliberate and explicit below (`publicShowFields`) —
// show.comment and song.comment are never read into the response, and
// show.taggedFriendUids is only resolved to a name+link for a tagged uid
// whose OWN profile is independently public (see resolveTaggedFriends).
// Venue ratings/comments, wishlists, and friend lists live in entirely
// separate Firestore collections this function never queries.
//
// setBreakToLabel/groupSongsBySet below are a small CJS port of
// lib/setlistGrouping.js's logic — that file uses ESM `export` syntax,
// which a plain `require()` here can't parse (same reason
// lib/__tests__/popupManager.test.js re-implements logic inline instead
// of importing its ES module target directly).

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

const CANONICAL_ORDER = ['Set I', 'Set II', 'Set III', 'Set IV', 'Encore', 'Encore II', 'Encore III'];

function setBreakToLabel(setBreak) {
  if (!setBreak) return null;
  if (setBreak === 'Main Set') return 'Set I';
  if (setBreak === 'Encore') return 'Encore';
  if (setBreak === 'Encore 2') return 'Encore II';
  const m = setBreak.match(/^Set (\d+)$/);
  if (m) {
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    return `Set ${ROMAN[parseInt(m[1]) - 1] || m[1]}`;
  }
  return setBreak;
}

function groupSongsBySet(setlist = []) {
  if (!setlist.length) return [];
  const groups = {};
  const order = [];
  const hasSetField = setlist.some(s => s.set);
  let currentLabel = 'Set I';
  if (hasSetField) {
    setlist.forEach(song => {
      if (song.set) currentLabel = song.set;
      if (!groups[currentLabel]) { groups[currentLabel] = []; order.push(currentLabel); }
      groups[currentLabel].push(song);
    });
  } else {
    setlist.forEach(song => {
      if (song.setBreak) currentLabel = setBreakToLabel(song.setBreak) || currentLabel;
      if (!groups[currentLabel]) { groups[currentLabel] = []; order.push(currentLabel); }
      groups[currentLabel].push(song);
    });
  }
  const keys = [
    ...CANONICAL_ORDER.filter(k => groups[k]),
    ...order.filter(k => !CANONICAL_ORDER.includes(k) && groups[k]),
  ];
  return keys.map(label => ({ label, songs: groups[label] }));
}

const formatDate = (dateStr) => formatShowDate(dateStr, 'long');

// A tagged friend is only ever named on a public page if THEY have
// independently opted their own profile public — attendance is other
// people's data, not the show owner's to publish on someone else's behalf.
async function resolveTaggedFriends(db, taggedFriendUids) {
  if (!Array.isArray(taggedFriendUids) || taggedFriendUids.length === 0) return [];
  const snaps = await Promise.all(
    taggedFriendUids.map(uid => db.collection('userProfiles').doc(uid).get().catch(() => null))
  );
  return snaps
    .filter(s => s && s.exists && s.data().publicProfile === true && s.data().handle)
    .map(s => ({ name: s.data().displayName || s.data().handle, handle: s.data().handleLower || s.data().handle }));
}

exports.handler = async function (event) {
  const db = getDb();
  if (!db) {
    return { statusCode: 503, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('This page is temporarily unavailable.') };
  }

  const handleLower = (event.queryStringParameters?.handle || '').toLowerCase().trim();
  const showId = event.queryStringParameters?.showId || '';

  if (!handleLower || !showId) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Show not found.') };
  }

  try {
    const handleSnap = await db.collection('handles').doc(handleLower).get();
    if (!handleSnap.exists) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Show not found.') };
    }
    const uid = handleSnap.data().uid;

    const profileSnap = await db.collection('userProfiles').doc(uid).get();
    if (!profileSnap.exists || profileSnap.data().publicProfile !== true) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Show not found.') };
    }
    const profile = profileSnap.data();
    const displayName = profile.displayName || profile.handle || handleLower;

    const showSnap = await db.collection('users').doc(uid).collection('shows').doc(showId).get();
    if (!showSnap.exists) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Show not found.') };
    }
    const show = showSnap.data();

    const taggedFriends = await resolveTaggedFriends(db, show.taggedFriendUids);

    const sets = groupSongsBySet((show.setlist || []).map(s => ({
      // Explicit allow-list — comment is never carried through.
      id: s.id, name: s.name, set: s.set, setBreak: s.setBreak, rating: s.rating,
    })));

    const setlistHtml = sets.length ? sets.map(set => `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#b7b6c9;margin:20px 0 6px;">${escapeHtml(set.label)}</h3>
      <ul class="setlist">
        ${set.songs.map(s => `<li><span>${escapeHtml(s.name)}</span>${s.rating ? `<span>${s.rating}/10</span>` : ''}</li>`).join('')}
      </ul>
    `).join('') : '<p class="sub">No setlist logged.</p>';

    const title = `${show.artist} at ${show.venue} — ${formatDate(show.date)} — MySetlists`;
    const description = `Setlist for ${show.artist} at ${show.venue}${show.city ? `, ${show.city}` : ''} on ${formatDate(show.date)}, logged by ${displayName} on MySetlists.`;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: `${show.artist} at ${show.venue}`,
      startDate: isoDate(show.date) || show.date,
      performer: { '@type': 'MusicGroup', name: show.artist },
      location: {
        '@type': 'Place',
        name: show.venue,
        address: show.city || undefined,
      },
    };

    const taggedHtml = taggedFriends.length ? `
      <p class="sub">With ${taggedFriends.map(f => `<a href="${SITE_URL}/u/${f.handle}/">${escapeHtml(f.name)}</a>`).join(', ')}</p>
    ` : '';

    const bodyHtml = `
      <h1>${escapeHtml(show.artist)}</h1>
      <p class="sub">${formatDate(show.date)} · ${escapeHtml(show.venue)}${show.city ? `, ${escapeHtml(show.city)}` : ''}</p>
      ${show.rating ? `<div class="stats"><div class="stat"><div class="n">${show.rating}/10</div><div class="l">Rating</div></div></div>` : ''}
      ${taggedHtml}
      ${setlistHtml}
      <div class="cta">
        <p style="margin:0 0 10px;">See ${escapeHtml(displayName)}'s full show history, or track your own.</p>
        <a href="${SITE_URL}/u/${handleLower}/">View full profile</a>
      </div>
    `;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...CACHE_HEADERS },
      body: page({ title, description, canonicalPath: `/u/${handleLower}/shows/${showId}/`, jsonLd, bodyHtml }),
    };
  } catch (err) {
    console.error('public-show error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: notFoundPage('Something went wrong loading this page.') };
  }
};
