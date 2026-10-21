#!/usr/bin/env node
'use strict';

/**
 * Every Firestore collection the app writes to must be a decision in
 * netlify/functions/lib/userDataPurge.js.
 *
 * The failure this catches is the one that actually happened: a feature adds
 * a collection, nobody thinks about deletion, and a year later the
 * self-service delete leaves a user's photos and comments in production. The
 * completeness test proves the map is executed correctly; this one proves the
 * map is not missing anything.
 *
 * If this fails, you have two honest options and one dishonest one. Add the
 * collection to the purge map, or add it to NOT_USER_OWNED below with a
 * reason. Do not delete the test.
 *
 *   node tests/deletion/collection-coverage.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const {
  OWNED_DOCUMENTS, ARRAY_MEMBERSHIPS, TOMBSTONES,
} = require(path.join(ROOT, 'netlify/functions/lib/userDataPurge.js'));

/**
 * Collections that hold nothing belonging to an individual user, with the
 * reason. Each of these was checked by hand; if one of them grows a uid
 * field, move it into the purge map.
 */
const NOT_USER_OWNED = {
  adminAuditLog: 'The record that a deletion happened. Must outlive the user.',
  communityStats: 'A single aggregate doc (id "global") across all users. No uid anywhere.',
  friends: 'Subcollection name. The user\'s own is removed with the subtree; inbound edges are removed by collectionGroup.',
  shows: 'Subcollection name under users/{uid}; removed with the subtree.',
  upcomingShows: 'Subcollection name under users/{uid} (5.43.0); removed with the subtree.',
  ticketCache: 'Cache of Ticketmaster/SeatGeek events, keyed by artist slug. No uid anywhere. (Its reads moved from components/UpcomingShows.jsx to lib/ticketEvents.js in 5.43.0, which is when this scan first saw it.)',
  appleMusicTokens: 'One app-level developer token (doc id "developer"). No per-user token is ever stored server-side.',
  archivalAudioArtistMap: 'Static artist-to-archive mapping.',
  archivalAudioShowCache: 'Cache of third-party audio lookups.',
  artistEnrichCache: 'Cache of artist metadata from Wikipedia/MusicBrainz/Discogs.',
  guestSessions: 'Anonymous session stats; the link to a converted account is tombstoned, not deleted.',
  handles: 'Handled explicitly in purgeUserData — the handle is released, not deleted as an owned document.',
  moderationCounters: 'Keyed by reported content id, holds only a count. Follows its content.',
  publicArtistStats: 'Aggregate stats across all users.',
  setlistCache: 'Cache of setlist.fm responses.',
  showSuggestions: 'Handled explicitly in purgeUserData (participants array-contains).',
  userBlocks: 'Handled explicitly — the user\'s own doc is deleted, and they are removed from everyone else\'s.',
  users: 'The parent of the per-user subtree; removed with recursiveDelete.',
  userProfiles: 'Deleted explicitly, last, after everything that reads it.',
  venues: 'Shared venue records. Only verifiedOwnerUid is user-linked, and it is tombstoned.',
  voters: 'Subcollection of roadmapItems, keyed by uid. Handled explicitly.',
  wikiCache: 'Cache of Wikipedia lookups.',
  venueAnnouncements: 'Venue-authored, not user-authored.',
  festivals: 'Shared canonical festival records; createdBy is tombstoned. firestore.rules forbids deleting them.',
  roadmapItems: 'Shared roadmap; submitterUid is tombstoned and votes are removed.',
  meetups: 'Shared per-show meetup; the user is removed from attendeeUids and createdBy is tombstoned.',
  bandAnnouncementLedger: 'Per band, the Ticketmaster event ids already seen by the followed-band job (5.46.0). Keyed by a hash of the band name. No uid anywhere.',
  jobTriggers: 'One-shot nonces that start a background job, deleted when used. No uid anywhere.',
  reports: 'Moderation records outlive the reporter and the reported. Tombstoned, not deleted.',
  emailSuppressions: 'Keyed by address, not account: a request not to be emailed. Deleting it on account deletion would start mailing that address again, so it must outlive the account (suppression lists are exactly what data-protection law lets you keep).',
  unsubscribeEvents: 'Append-only record of opt-out and opt-in requests — the evidence that an unsubscribe was honoured. Like adminAuditLog, it must outlive the user.',
  announcements: 'Admin-authored announcements. The recipients subcollection is the per-address send record that stops anyone being emailed twice; it is not user content.',
};

const SEARCH_DIRS = ['lib', 'netlify/functions', 'context', 'hooks'];
const PATTERNS = [
  /collection\(\s*db\s*,\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,
  /db\.collection\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,
  /doc\(\s*db\s*,\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,
  /db\.doc\(\s*[`'"]([A-Za-z][A-Za-z0-9_]*)\//g,
  /collectionGroup\(\s*(?:db\s*,\s*)?['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !/__tests__/.test(full)) out.push(full);
  }
  return out;
}

const found = new Map(); // collection -> Set(file)
for (const dir of SEARCH_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const name = m[1];
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(path.relative(ROOT, file));
      }
    }
  }
}

const covered = new Set([
  ...OWNED_DOCUMENTS.map(s => s.collection),
  ...ARRAY_MEMBERSHIPS.map(s => s.collection),
  ...TOMBSTONES.map(s => s.collection),
  ...Object.keys(NOT_USER_OWNED),
]);

const uncovered = [...found.keys()].filter(c => !covered.has(c)).sort();

if (uncovered.length) {
  console.error('\nFirestore collections with no deletion decision:\n');
  for (const c of uncovered) {
    console.error(`  ${c}`);
    for (const f of found.get(c)) console.error(`      used in ${f}`);
  }
  console.error(`
Each of these is written by the app but appears neither in the purge map in
netlify/functions/lib/userDataPurge.js nor in NOT_USER_OWNED in this file.

If the collection stores anything keyed to a user, add it to the map — a user
who deletes their account is entitled to have it go. If it genuinely holds
nothing personal, add it to NOT_USER_OWNED with the reason you checked.
`);
  process.exit(1);
}

// The reverse check: an entry in the map for a collection nobody writes to any
// more is dead weight that makes the map harder to trust.
const stale = [...covered].filter(c => !found.has(c) && !NOT_USER_OWNED[c]).sort();
if (stale.length) {
  console.error(`\nPurge map references collections the app no longer writes: ${stale.join(', ')}`);
  console.error('Remove them from the map, or fix the collection name.\n');
  process.exit(1);
}

console.log(`collection-coverage: ${found.size} collections found, all accounted for.`);
