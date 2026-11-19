/**
 * concertKeys — the keys that hang shared content off a concert rather than
 * anyone's show document (Stage 6, 5.60.38). Comments, photos and meetups
 * are keyed by showMatchKey (lib/showIdentity.js); three keys derive from it
 * and have to come out the same in the web, the server and the native app,
 * or a native user lands in a different thread:
 *
 *   meetupIdFor(concertKey)       meetups/{id}
 *   mediaPathSegment(concertKey)  showPhotos/{segment}/{uid}/{file} in Storage
 *   commentViewId(uid, key)       commentViews/{id} ("new since your last visit")
 *
 * fixtures/concert-keys/keys.json pins all four; lib/__tests__/concertKeysFixtures.test.js
 * and the native ConcertKeysTests both run it.
 *
 * CommonJS (CLAUDE.md, "Show data rules"): netlify/functions/meetups.js and
 * moderate-content require it.
 */

const { showMatchKey } = require('./showIdentity');

/**
 * Firestore-safe meetup id: lowercased, every run of other characters one
 * underscore, none at the ends. Null for an empty key.
 */
function meetupIdFor(concertKey) {
  const cleaned = String(concertKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || null;
}

/** The concert's Storage path segment: lowercased, every run of other characters one hyphen. */
function mediaPathSegment(concertKey) {
  return String(concertKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** commentViews document id for one person and one concert. */
function commentViewId(uid, concertKey) {
  return `${uid}_${mediaPathSegment(concertKey)}`;
}

module.exports = { concertKey: showMatchKey, meetupIdFor, mediaPathSegment, commentViewId };
