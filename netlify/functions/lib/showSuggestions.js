// netlify/functions/lib/showSuggestions.js — "were you there together?"
// suggestions, made on the server (5.60.11): by friends.js suggestionScan
// for a new show, and by scripts/backfill-show-suggestions.js once for the
// shared nights the app never managed to suggest (its existence check was
// a read the rules refuse for a missing document).
//
// A suggestion is one showSuggestions document per pair of friends per
// night, keyed by the two uids sorted and the night's match key
// (lib/showIdentity.js showMatchKey), the id the app always used. Nothing
// is suggested for a night the two are already tagged together on: one
// tagged the other (taggedFriendUids), or one accepted the other's tag
// (taggedByUid).

const { showMatchKey } = require('../../../lib/showIdentity');

function suggestionDocId(a, b, key) {
  const [uid1, uid2] = [a, b].sort();
  return `${uid1}_${uid2}_${String(key).replace(/[^a-z0-9]/g, '_').slice(0, 80)}`;
}

/** True when either show already records the other person as there. */
function taggedTogether(myShow, theirShow, myUid, theirUid) {
  const tagged = (show, uid) => !!show && (
    (Array.isArray(show.taggedFriendUids) && show.taggedFriendUids.includes(uid)) || show.taggedByUid === uid
  );
  return tagged(myShow, theirUid) || tagged(theirShow, myUid);
}

/**
 * The document, for two friends and one night. `backfill` marks the ones
 * the one-off backfill made: no email is ever sent for them
 * (lib/emailAuthorization.js suggestionNudge), and nothing pushes one.
 */
function suggestionDoc({ a, b, names, show, key, now = new Date(), backfill = false }) {
  const [uid1, uid2] = [a, b].sort();
  return {
    participants: [uid1, uid2],
    names: { [uid1]: names[uid1] || 'Friend', [uid2]: names[uid2] || 'Friend' },
    showKey: key,
    showData: { artist: show.artist || '', venue: show.venue || '', date: show.date || '', city: show.city || '', setlistfmId: show.setlistfmId || null },
    responses: { [uid1]: 'pending', [uid2]: 'pending' },
    overallStatus: 'pending',
    emailSentToUid: null,
    emailSentAt: null,
    lastViewedAt: { [uid1]: null, [uid2]: null },
    createdAt: now,
    updatedAt: now,
    ...(backfill ? { backfill: true } : {}),
  };
}

/**
 * planSuggestions({ myUid, myShows, friendUid, friendShows, existingIds })
 *   -> [{ docId, key, show, skipped? }]
 * The nights the two share that have no suggestion yet; a night they are
 * already tagged together on is returned with skipped: 'tagged-together'.
 */
function planSuggestions({ myUid, myShows, friendUid, friendShows, existingIds = new Set() }) {
  const theirs = new Map((friendShows || []).map((s) => [showMatchKey(s), s]));
  const out = [];
  const seen = new Set();
  for (const show of myShows || []) {
    const key = showMatchKey(show);
    const theirShow = theirs.get(key);
    if (!theirShow) continue;
    const docId = suggestionDocId(myUid, friendUid, key);
    if (seen.has(docId) || existingIds.has(docId)) continue;
    seen.add(docId);
    out.push(taggedTogether(show, theirShow, myUid, friendUid)
      ? { docId, key, show, skipped: 'tagged-together' }
      : { docId, key, show });
  }
  return out;
}

module.exports = { suggestionDocId, taggedTogether, suggestionDoc, planSuggestions };
