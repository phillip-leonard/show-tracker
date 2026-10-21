#!/usr/bin/env node
'use strict';

/**
 * Seed the Apple App Store review demo account.
 *
 * App Review rejects under Guideline 2.1 when a reviewer signs in and finds
 * empty states. This script creates two accounts — the reviewer's, and one
 * friend so the social half of the app has something to show — and fills
 * them with a believable concert history: shows with real setlists, friend
 * edges in both directions, comments, media, an activity feed, a pending
 * friend tag, a wishlist and a bucket list.
 *
 * It writes with firebase-admin, which bypasses Firestore rules. That is
 * deliberate: `showComments` and `showPhotos` are `allow create: if false`
 * for clients and only reachable through netlify/functions/moderate-content.js,
 * so there is no client path to seed them.
 *
 * Credentials come from the same env vars the Netlify functions use:
 *
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *
 * A .env file in the repo root is read automatically if present (it is
 * gitignored), so the private key never has to survive shell quoting.
 *
 * Usage:
 *   node scripts/seed-review-account.js                 # dry run, prints the plan
 *   node scripts/seed-review-account.js --yes           # write
 *   node scripts/seed-review-account.js --yes --reset   # delete seeded data first
 *
 * Required to write (--yes):
 *   REVIEW_PASSWORD, REVIEW_FRIEND_PASSWORD
 * Optional overrides:
 *   REVIEW_EMAIL, REVIEW_FRIEND_EMAIL
 *
 * There is no default password. One used to live here, in a public
 * repository, which made the review accounts anyone's. Re-running with
 * --yes sets the accounts' passwords to these values, so this is also how
 * to rotate them. The password you set here is what goes in App Store
 * Connect → App Review Information. Keep it simple to type on a phone; a reviewer typing a
 * 24-character password on an iPhone keyboard is a rejection waiting to happen.
 *
 * Idempotent: every document id is deterministic, so re-running overwrites
 * rather than duplicating.
 */

// Load .env from the repo root if there is one, so the private key does not
// have to survive a trip through shell quoting. Deliberately not a dependency:
// this is the only script that needs it, and the format here is simple.
(function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const WRITE = process.argv.includes('--yes');
const RESET = process.argv.includes('--reset');

const REVIEW = {
  email: process.env.REVIEW_EMAIL || 'appreview@mysetlists.net',
  password: process.env.REVIEW_PASSWORD || '',
  displayName: 'Alex Reviewer',
  handle: 'alexreviewer',
};
const FRIEND = {
  email: process.env.REVIEW_FRIEND_EMAIL || 'reviewfriend@mysetlists.net',
  password: process.env.REVIEW_FRIEND_PASSWORD || '',
  displayName: 'Jordan Mills',
  handle: 'jordanmills',
};

// ── The concert history ──────────────────────────────────────────────────
//
// `shared: true` means both accounts logged it, which is what populates
// Shows Together and the show-suggestion prompt. Cross-user identity is
// `setlistfmId` (see normalizeShowKey in context/AppContext.jsx), so the
// two copies must carry the same one.

const SETS = {
  phish: [
    ['Set I', ['Sample in a Jar', 'Ghost', 'Wolfman’s Brother', 'Rift', 'Bathtub Gin']],
    ['Set II', ['Down with Disease', 'Twist', 'Piper', 'Slave to the Traffic Light']],
    ['Encore', ['Character Zero']],
  ],
  goose: [
    ['Set I', ['Hungersite', 'Arrow', 'Dripfield', 'Elizabeth']],
    ['Set II', ['Madhuvan', 'Hot Tea', 'Rockdale', 'Time to Flee']],
    ['Encore', ['Tumble']],
  ],
  billy: [
    ['Set I', ['Dust in a Baggie', 'Meet Me at the Creek', 'Home of the Red Fox', 'Away from the Mire']],
    ['Set II', ['Turmoil & Tinfoil', 'Red Daisy', 'Thirst Mutilator', 'Fire Line']],
    ['Encore', ['Must Be Seven']],
  ],
  dead: [
    ['Set I', ['Jack Straw', 'Bertha', 'Loser', 'Brown-Eyed Women', 'Cassidy']],
    ['Set II', ['Scarlet Begonias', 'Fire on the Mountain', 'Drums', 'Space', 'Morning Dew']],
    ['Encore', ['Touch of Grey']],
  ],
  wsp: [
    ['Set I', ['Little Kin', 'Pigeons', 'Ribs and Whiskey', 'Blight']],
    ['Set II', ['Chilly Water', 'Papa’s Home', 'Climb to Safety']],
    ['Encore', ['Porch Song']],
  ],
  umphreys: [
    ['Set I', ['The Triple Wide', 'Bridgeless', 'Wizard Burial Ground']],
    ['Set II', ['Hajimemashite', 'Divisions', 'Bad Friday']],
    ['Encore', ['Bright Lights, Big City']],
  ],
};

const SHOWS = [
  { key: 'p1', artist: 'Phish', venue: 'Dick’s Sporting Goods Park', city: 'Commerce City, CO', date: '2025-08-29', tour: 'Summer Tour 2025', sfm: 'rev-sfm-0001', set: 'phish', rating: 10, comment: 'Best Gin in years. Nobody sat down.', shared: true },
  { key: 'p2', artist: 'Phish', venue: 'Madison Square Garden', city: 'New York, NY', date: '2025-12-31', tour: 'New Year’s Run 2025', sfm: 'rev-sfm-0002', set: 'phish', rating: 9, comment: 'The gag was worth the ticket alone.', shared: false },
  { key: 'g1', artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison, CO', date: '2025-06-21', tour: 'Summer 2025', sfm: 'rev-sfm-0003', set: 'goose', rating: 9, comment: 'Rain cleared right before Madhuvan.', shared: true },
  { key: 'g2', artist: 'Goose', venue: 'The Anthem', city: 'Washington, DC', date: '2026-02-14', tour: 'Winter 2026', sfm: 'rev-sfm-0004', set: 'goose', rating: 8, comment: '', shared: false },
  { key: 'b1', artist: 'Billy Strings', venue: 'The Fillmore', city: 'San Francisco, CA', date: '2026-03-07', tour: 'Spring 2026', sfm: 'rev-sfm-0005', set: 'billy', rating: 10, comment: 'Second set never let up.', shared: true },
  { key: 'b2', artist: 'Billy Strings', venue: 'Ryman Auditorium', city: 'Nashville, TN', date: '2025-10-11', tour: 'Fall 2025', sfm: 'rev-sfm-0006', set: 'billy', rating: 9, comment: '', shared: false },
  { key: 'd1', artist: 'Dead & Company', venue: 'Sphere', city: 'Las Vegas, NV', date: '2025-05-17', tour: 'Dead Forever', sfm: 'rev-sfm-0007', set: 'dead', rating: 10, comment: 'Dew closed it. Whole room quiet.', shared: true },
  { key: 'd2', artist: 'Dead & Company', venue: 'Folsom Field', city: 'Boulder, CO', date: '2025-07-04', tour: 'Summer 2025', sfm: 'rev-sfm-0008', set: 'dead', rating: 8, comment: '', shared: false },
  { key: 'w1', artist: 'Widespread Panic', venue: 'Ryman Auditorium', city: 'Nashville, TN', date: '2026-01-24', tour: 'Winter 2026', sfm: 'rev-sfm-0009', set: 'wsp', rating: 8, comment: '', shared: false },
  { key: 'u1', artist: 'Umphrey’s McGee', venue: 'The Riviera Theatre', city: 'Chicago, IL', date: '2025-11-28', tour: 'Fall 2025', sfm: 'rev-sfm-0010', set: 'umphreys', rating: 9, comment: 'Wizard Burial Ground out of nowhere.', shared: false },
  { key: 'u2', artist: 'Umphrey’s McGee', venue: 'Red Rocks Amphitheatre', city: 'Morrison, CO', date: '2026-06-27', tour: 'Summer 2026', sfm: 'rev-sfm-0011', set: 'umphreys', rating: 9, comment: '', shared: true },
  { key: 'p3', artist: 'Phish', venue: 'Hampton Coliseum', city: 'Hampton, VA', date: '2026-04-18', tour: 'Spring Tour 2026', sfm: 'rev-sfm-0012', set: 'phish', rating: 9, comment: 'Mothership. Enough said.', shared: false },
];

// Deterministic show doc ids. The app mints millisecond timestamps; any
// numeric-looking string works, and fixed ones keep the script idempotent.
const showId = (uid, key) => `seed-${key}-${uid.slice(0, 6)}`;

function buildSetlist(setKey) {
  const songs = [];
  let n = 0;
  for (const [set, names] of SETS[setKey]) {
    for (const name of names) {
      songs.push({ id: `seedsong${String(++n).padStart(3, '0')}`, name, set, cover: null, tape: false });
    }
  }
  // A couple of song ratings so the stats and gap pages are not blank.
  if (songs[1]) songs[1].rating = 9;
  if (songs[4]) { songs[4].rating = 10; songs[4].comment = 'Peak of the night.'; }
  return songs;
}

const concertKey = (s) => s.sfm || `${s.artist.trim().toLowerCase()}|${s.venue.trim().toLowerCase()}|${s.date.trim().toLowerCase()}`;

// ── Firebase ─────────────────────────────────────────────────────────────

function init() {
  if (getApps().length) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) {
    console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.');
    process.exit(1);
  }
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

async function ensureUser(auth, { email, password, displayName }) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName, emailVerified: true, disabled: false });
    return existing.uid;
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    return created.uid;
  }
}

async function writeProfile(db, uid, who, counts) {
  await db.doc(`userProfiles/${uid}`).set({
    // NOTE: `odubleserId` is not a typo here — it is the field name the app
    // actually writes and reads (context/AppContext.jsx, CommunityStatsView).
    // It looks like a botched find/replace of `userId` in production code.
    // Seeding the real field name keeps this account behaving like any other;
    // fixing the misspelling is a separate change, and this line moves with it.
    odubleserId: uid,
    email: who.email,
    displayName: who.displayName,
    firstName: who.displayName.split(' ')[0],
    photoURL: '',
    handle: who.handle,
    handleLower: who.handle.toLowerCase(),
    publicProfile: true,
    shareActivity: true,
    favoriteArtists: ['Phish', 'Goose', 'Billy Strings'],
    lastLogin: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    ...counts,
  }, { merge: true });
  await db.doc(`handles/${who.handle.toLowerCase()}`).set({ uid, createdAt: FieldValue.serverTimestamp() });
}

async function writeShows(db, uid, shows) {
  for (const s of shows) {
    const setlist = buildSetlist(s.set);
    await db.doc(`users/${uid}/shows/${showId(uid, s.key)}`).set({
      id: showId(uid, s.key),
      artist: s.artist,
      venue: s.venue,
      city: s.city,
      country: 'United States',
      date: s.date,
      tour: s.tour,
      setlistfmId: s.sfm,
      setlist,
      isManual: false,
      rating: s.rating,
      comment: s.comment,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

async function befriend(db, a, aWho, b, bWho) {
  await db.doc(`users/${a}/friends/${b}`).set({
    friendUid: b, friendName: bWho.displayName, friendEmail: bWho.email,
    friendPhotoURL: '', addedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${b}/friends/${a}`).set({
    friendUid: a, friendName: aWho.displayName, friendEmail: aWho.email,
    friendPhotoURL: '', addedAt: FieldValue.serverTimestamp(),
  });
}

async function writeComments(db, reviewUid, friendUid) {
  const lines = [
    { s: SHOWS[0], uid: reviewUid, name: REVIEW.displayName, text: 'Bathtub Gin here was the whole weekend in one song.' },
    // The friend's comment on SHOWS[0] is what App Review flags in the
    // screen recording. Keep it, and keep it on the same show as their
    // media item in writeMedia() below.
    { s: SHOWS[0], uid: friendUid, name: FRIEND.displayName, text: 'Agreed. Still thinking about the Down with Disease opener.' },
    { s: SHOWS[2], uid: friendUid, name: FRIEND.displayName, text: 'Rain stopped about thirty seconds into Madhuvan. Unreal timing.' },
    { s: SHOWS[6], uid: reviewUid, name: REVIEW.displayName, text: 'Morning Dew in that room is something I will not forget.' },
  ];
  let i = 0;
  for (const c of lines) {
    await db.doc(`showComments/seed-comment-${String(++i).padStart(3, '0')}`).set({
      concertKey: concertKey(c.s), parentId: null,
      authorUid: c.uid, authorName: c.name,
      text: c.text, likedBy: [], createdAt: FieldValue.serverTimestamp(),
    });
  }
}

async function writeMedia(db, reviewUid, friendUid) {
  // YouTube-type records need no Storage upload and render in the gallery.
  //
  // SHOWS[0] (Phish, Dick's, 2025-08-29) deliberately carries BOTH a
  // comment and a media item from the FRIEND account, because that is the
  // one show App Review is walked to: the reviewer needs something of
  // another user's to flag on the screen they are already looking at, and
  // before this the friend's comment was on SHOWS[0] while their only
  // media was on SHOWS[4]. Finding the flag control meant finding a
  // second show first.
  const items = [
    { s: SHOWS[0], uid: reviewUid, name: REVIEW.displayName, caption: 'Set II opener from the rail', vid: 'dQw4w9WgXcQ' },
    { s: SHOWS[0], uid: friendUid, name: FRIEND.displayName, caption: 'Bathtub Gin from the rail — whole crowd singing', vid: '5N1C6WgMEPo' },
    { s: SHOWS[4], uid: friendUid, name: FRIEND.displayName, caption: 'Full second set', vid: 'aqz-KE-bpKQ' },
  ];
  let i = 0;
  for (const m of items) {
    await db.doc(`showPhotos/seed-media-${String(++i).padStart(3, '0')}`).set({
      concertKey: concertKey(m.s), category: 'photo',
      artist: m.s.artist, venue: m.s.venue, date: m.s.date,
      uploadedBy: m.uid, uploaderName: m.name,
      type: 'youtube', url: `https://www.youtube.com/watch?v=${m.vid}`,
      storagePath: null, fileSize: null,
      caption: m.caption, likedBy: [], createdAt: FieldValue.serverTimestamp(),
    });
  }
}

async function writeActivity(db, friendUid) {
  // The feed shows friends' activity only, never your own — so these are
  // written under the friend's uid.
  const acts = [
    { action: 'added_show', s: SHOWS[10] },
    { action: 'rated_show', s: SHOWS[4], rating: 10 },
    { action: 'commented', s: SHOWS[2] },
    { action: 'shared_media', s: SHOWS[4], mediaCategory: 'photo' },
  ];
  let i = 0;
  for (const a of acts) {
    await db.doc(`userActivity/seed-activity-${String(++i).padStart(3, '0')}`).set({
      userId: friendUid, userName: FRIEND.displayName, handle: FRIEND.handle,
      action: a.action, showId: showId(friendUid, a.s.key),
      artist: a.s.artist, venue: a.s.venue,
      ...(a.rating ? { rating: a.rating } : {}),
      ...(a.mediaCategory ? { mediaCategory: a.mediaCategory } : {}),
      timestamp: FieldValue.serverTimestamp(),
    });
  }
}

async function writePendingTag(db, reviewUid, friendUid) {
  const s = SHOWS[8]; // Widespread Panic — not in the reviewer's history yet
  await db.doc('showTags/seed-tag-001').set({
    fromUid: friendUid, fromName: FRIEND.displayName,
    toUid: reviewUid, status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    showData: {
      artist: s.artist, venue: s.venue, date: s.date, city: s.city,
      tour: s.tour, setlistfmId: s.sfm, isManual: false,
      setlist: buildSetlist(s.set).map(({ id, name }) => ({ id, name })),
    },
  });
}

async function writeLists(db, uid) {
  await db.doc(`wishlists/${uid}_phish`).set({
    userId: uid, artistKey: 'phish', artistName: 'Phish', artistMbid: null,
    songs: {
      'harpua': { title: 'Harpua', addedAt: new Date().toISOString() },
      'icculus': { title: 'Icculus', addedAt: new Date().toISOString() },
      'destiny unbound': { title: 'Destiny Unbound', addedAt: new Date().toISOString() },
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  const bucket = [
    { artist: 'Goose', venue: 'Red Rocks Amphitheatre', city: 'Morrison', state: 'CO', date: '2026-09-19' },
    { artist: 'Billy Strings', venue: 'The Gorge Amphitheatre', city: 'George', state: 'WA', date: '2026-08-15' },
  ];
  for (const b of bucket) {
    const itemKey = [b.artist, b.venue, b.date].map(v => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')).join('_');
    await db.doc(`bucketList/${uid}_${itemKey}`).set({
      userId: uid, ...b, source: 'manual', ticketUrl: null, addedAt: FieldValue.serverTimestamp(),
    });
  }
  await db.doc(`userBlocks/${uid}`).set({ userId: uid, blockedUserIds: [], updatedAt: FieldValue.serverTimestamp() });
}

async function reset(db, auth, uids) {
  for (const [col, field] of [['showComments', 'authorUid'], ['showPhotos', 'uploadedBy'], ['userActivity', 'userId']]) {
    for (const uid of uids) {
      const snap = await db.collection(col).where(field, '==', uid).get();
      for (const d of snap.docs) await d.ref.delete();
    }
  }
  for (const uid of uids) {
    for (const sub of ['shows', 'friends']) {
      const snap = await db.collection(`users/${uid}/${sub}`).get();
      for (const d of snap.docs) await d.ref.delete();
    }
  }
  const tags = await db.collection('showTags').where('toUid', 'in', uids).get();
  for (const d of tags.docs) await d.ref.delete();

  // Moderation state from a previous App Review walkthrough.
  //
  // This is the one that bites on a resubmission. The reviewer is asked
  // to block the friend account as part of the demo — and a block is
  // permanent until undone, so on the NEXT round the friend's comment and
  // photo are invisible to the review account and there is nothing to
  // flag. The reviewer then reports that the feature does not work,
  // correctly, because for them it does not.
  //
  // Reports are cleared for the same reason: a flagged item is hidden
  // from the reporter immediately, so last round's flag would hide this
  // round's demo content.
  for (const uid of uids) {
    await db.doc(`userBlocks/${uid}`).delete().catch(() => {});
  }
  for (const uid of uids) {
    for (const field of ['reporterId', 'reportedUserId']) {
      const snap = await db.collection('reports').where(field, '==', uid).get();
      for (const d of snap.docs) await d.ref.delete();
    }
  }

  // Anything a previous round's flag pulled out of circulation, and the
  // counters behind the auto-hide threshold.
  for (const uid of uids) {
    const hidden = await db.collection('moderationHidden').where('authorUid', '==', uid).get();
    for (const d of hidden.docs) await d.ref.delete();
  }

  // A suspension from testing the eject flow would otherwise leave the
  // demo account showing the "account suspended" screen at sign-in.
  for (const uid of uids) {
    await db.doc(`userProfiles/${uid}`)
      .set({ banned: false }, { merge: true })
      .catch(() => {});
    try {
      await auth.updateUser(uid, { disabled: false });
    } catch {
      // The account may not exist yet on a first run.
    }
  }

  console.log('  reset: cleared seeded content, blocks, reports and suspensions');
}

/** Where a password comes from, for log lines. Never the value itself. */
function passwordSource(envVar) {
  return process.env[envVar] ? `from ${envVar}` : `${envVar} not set (required for --yes)`;
}

async function main() {
  if (!WRITE) {
    console.log('DRY RUN — nothing will be written. Re-run with --yes to apply.\n');
    // Never print a password, set or not: terminal scrollback, CI logs and
    // pasted output are all places one would leak from.
    console.log(`  review account : ${REVIEW.email}  (@${REVIEW.handle})  password: ${passwordSource('REVIEW_PASSWORD')}`);
    console.log(`  friend account : ${FRIEND.email}  (@${FRIEND.handle})  password: ${passwordSource('REVIEW_FRIEND_PASSWORD')}`);
    console.log(`  shows          : ${SHOWS.length} for the reviewer, ${SHOWS.filter(s => s.shared).length} of them shared with the friend`);
    console.log('  plus           : comments, media, activity feed, one pending tag, wishlist, bucket list');
    console.log('\nPut the review credentials in App Store Connect → App Review Information.');
    return;
  }

  // No fallback, ever (see the header): stop before touching Auth.
  const missing = [
    !REVIEW.password && 'REVIEW_PASSWORD',
    !FRIEND.password && 'REVIEW_FRIEND_PASSWORD',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing ${missing.join(' and ')}. Set them (in .env or the shell) to the passwords these accounts should have; re-running sets them.`);
    process.exit(1);
  }

  init();
  const db = getFirestore();
  const auth = getAuth();

  const reviewUid = await ensureUser(auth, REVIEW);
  const friendUid = await ensureUser(auth, FRIEND);
  console.log(`  reviewer uid: ${reviewUid}`);
  console.log(`  friend uid  : ${friendUid}`);

  if (RESET) await reset(db, auth, [reviewUid, friendUid]);

  const sharedShows = SHOWS.filter(s => s.shared);
  const songTotal = SHOWS.reduce((n, s) => n + buildSetlist(s.set).length, 0);

  await writeProfile(db, reviewUid, REVIEW, {
    showCount: SHOWS.length, songCount: songTotal, ratedSongCount: SHOWS.length * 2,
    venueCount: new Set(SHOWS.map(s => s.venue)).size,
  });
  await writeProfile(db, friendUid, FRIEND, {
    showCount: sharedShows.length, songCount: sharedShows.reduce((n, s) => n + buildSetlist(s.set).length, 0),
    ratedSongCount: sharedShows.length * 2, venueCount: new Set(sharedShows.map(s => s.venue)).size,
  });

  await writeShows(db, reviewUid, SHOWS);
  await writeShows(db, friendUid, sharedShows);
  await befriend(db, reviewUid, REVIEW, friendUid, FRIEND);
  await writeComments(db, reviewUid, friendUid);
  await writeMedia(db, reviewUid, friendUid);
  await writeActivity(db, friendUid);
  await writePendingTag(db, reviewUid, friendUid);
  await writeLists(db, reviewUid);

  console.log('\nSeeded.');
  console.log(`  App Review sign-in: ${REVIEW.email}  password: ${passwordSource('REVIEW_PASSWORD')}`);
  console.log('  Walk every tab once on a device before submitting — this script');
  console.log('  fills the data, it does not prove the screens render.');
}

main().catch(e => { console.error(e); process.exit(1); });
