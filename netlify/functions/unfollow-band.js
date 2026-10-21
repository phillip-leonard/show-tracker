/**
 * unfollow-band — the "Unfollow <band>" link in every followed-band email
 * (lib/followedBandAlerts.js).
 *
 *   GET  /api/unfollow?token=…   Confirmation page with a button. Does NOT
 *        unfollow, for the same reason a GET of /api/unsubscribe doesn't:
 *        link scanners and mail previewers fetch every link in an email.
 *   POST /api/unfollow?token=…   The page's button. Removes the band from
 *        userProfiles/{uid}.favoriteArtists and says so.
 *
 * Tokens are signed for one uid and one band (lib/unfollowToken.js), so a
 * link can only ever unfollow the band it was sent about, for the person it
 * was sent to. Unfollowing a band already unfollowed is a success.
 */

const { getDb } = require('./lib/firebaseAdmin');
const { verifyUnfollow } = require('./lib/unfollowToken');
const { artistKey } = require('./lib/followedBandAlerts');
const { escapeHtml } = require('./lib/emailLayout');
const { PAGE_HEADERS, page, html } = require('./lib/actionPage');

const PROFILE_URL = 'https://mysetlists.net/profile/';

const invalidPage = () => html(400, 'Link not recognised',
  `<p>This unfollow link isn't valid. You can unfollow bands from your Profile.</p>
   <a class="btn primary" href="${PROFILE_URL}">Open your Profile</a>`, { tone: 'error' });

const errorPage = () => html(500, 'Something went wrong',
  `<p>We couldn't update the bands you follow just now. Please try again in a minute, or unfollow from your Profile.</p>
   <a class="btn secondary" href="${PROFILE_URL}">Open your Profile</a>`, { tone: 'error' });

async function bandName(db, uid, key) {
  const snap = await db.collection('userProfiles').doc(uid).get();
  const follows = snap.exists ? snap.data().favoriteArtists || [] : [];
  return follows.find((f) => artistKey(f?.name) === key)?.name || null;
}

exports.handler = async function (event) {
  const method = event.httpMethod;
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { ...PAGE_HEADERS, Allow: 'GET, POST' }, body: page('Not allowed', '<p>Method not allowed.</p>', { tone: 'error' }) };
  }
  const token = event.queryStringParameters?.token || '';
  const claims = verifyUnfollow(token);
  if (!claims) return invalidPage();

  try {
    const db = getDb();
    const ref = db.collection('userProfiles').doc(claims.uid);

    if (method === 'GET') {
      const name = await bandName(db, claims.uid, claims.artistKey);
      if (!name) {
        return html(200, "You're not following this band",
          `<p>You don't follow this band any more, so there's nothing to do.</p>
           <p class="links"><a href="${PROFILE_URL}">See the bands you follow</a></p>`);
      }
      const n = escapeHtml(name);
      return html(200, `Unfollow ${n}?`,
        `<p>You'll stop getting emails and alerts when ${n} announces new dates.</p>
         <form method="POST" action="/api/unfollow?token=${encodeURIComponent(token)}">
           <button type="submit" class="primary">Unfollow ${n}</button>
           <a class="btn secondary" href="${PROFILE_URL}">Keep following</a>
         </form>`);
    }

    const snap = await ref.get();
    const follows = snap.exists ? snap.data().favoriteArtists || [] : [];
    const removed = follows.find((f) => artistKey(f?.name) === claims.artistKey);
    if (removed) {
      await ref.update({ favoriteArtists: follows.filter((f) => artistKey(f?.name) !== claims.artistKey) });
    }
    const n = escapeHtml(removed?.name || 'this band');
    return html(200, `You've unfollowed ${n}`,
      `<p>You won't hear about ${n}'s new dates any more.</p>
       <p class="links">Changed your mind? Follow them again from any of their shows, or <a href="${PROFILE_URL}">see the bands you follow</a>.</p>`);
  } catch (err) {
    console.error('[unfollow-band] failed:', err.message);
    return errorPage();
  }
};
