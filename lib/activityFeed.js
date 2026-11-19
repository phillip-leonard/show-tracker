/**
 * The friend activity feed, through the server (5.60.38, Stage 6 call B).
 *
 * Until 5.60.38 the browser wrote `userActivity` entries itself and read
 * its friends' with a `where userId in [...]` listener. The rule let any
 * account read any entry, so "friends only" was only the query this file
 * chose to run, and the native app wrote nothing. Now the server does both
 * (netlify/functions/lib/activityLog.js):
 *
 *   - entries are written by normalize-show (a show added), moderate-content
 *     (a comment, a photo) and friends.js `rated` (a rating), each checking
 *     the actor's own "Show my activity to friends" (userProfiles.shareActivity);
 *   - the feed is friends.js `activity`: mutual friends only, blocks either
 *     way and friends who turned sharing off left out, newest first.
 *
 * An entry, as the server answers it:
 *   { id, userId, userName, action: 'added_show' | 'rated_show' | 'commented' | 'shared_media',
 *     showId, artist, venue, rating?, mediaCategory?, handle, timestamp (ms) }
 *
 * `handle` is set when the actor's public profile was on at the time, so a
 * row can link to their public show page.
 */

import { authedFetch } from '@/lib/api';

async function friendsAction(body) {
  const res = await authedFetch('/.netlify/functions/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't load your friends' activity.");
  return data;
}

/** One page of the feed: { items, next }. `before` (ms) is the last page's `next`. */
export async function fetchFriendActivity({ before = null } = {}) {
  const data = await friendsAction({ action: 'activity', ...(before ? { before } : {}) });
  return { items: Array.isArray(data.items) ? data.items : [], next: data.next || null };
}

/**
 * After a rating is saved: asks the server for the "rated" entry, built
 * from the stored show. Best effort: never surfaces as an error on the
 * rating.
 */
export async function logRating(showId) {
  if (!showId) return;
  try {
    await friendsAction({ action: 'rated', showId });
  } catch (err) {
    console.warn('[activityFeed] rating entry not written:', err.message);
  }
}
