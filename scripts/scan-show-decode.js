#!/usr/bin/env node
/**
 * scan-show-decode — would every production document decode in the native
 * app? (5.60.15, native app Part 4.) Read-only; prints counts only, never
 * an id, a name, an address or any text from a document.
 *
 *   node scripts/scan-show-decode.js
 *
 * The rules below mirror the Swift models in
 * ios-native/Packages/Core/Sources/Core/Models, field for field: which
 * fields are required, which accept null or '', which numbers must be whole,
 * where a string or a Timestamp is fine. Change them together. The Swift
 * side's own tests (ProductionVariantTests, ShowFixtureTests) check the
 * models against the same variants; tests/native/decodeScan.test.js checks
 * this checker.
 *
 * For each collection: documents, documents that would fail to decode (by
 * field and reason), and notes that aren't failures: fields the model
 * doesn't read, show dates that decode but don't read as a day, ISO
 * strings that don't parse as a moment.
 *
 * Collections: users/{uid}/shows (every one), users/{uid}/upcomingShows,
 * users/{uid}/friends, userProfiles, userStats, publicUserStats,
 * communityStats/global, yearInReviews, config/app, showTags,
 * pendingEmailTags, showSuggestions.
 */

const path = require('path');
const { toIsoDate } = require('../lib/showDate');

// ── Field rules (the Swift decoding helpers) ──────────────────────────

const isTimestamp = (v) => !!v && typeof v === 'object' && typeof v.toDate === 'function' && typeof v.seconds === 'number';
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !isTimestamp(v);
const absentOrNull = (v) => v === undefined || v === null;
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Each rule: (value) → null when it decodes, or a short reason. A rule's
 * `note` (optional) returns a non-failing remark.
 */
const R = {
  // c.text / c.optionalText / decodeIfPresent(String): a string, null or absent
  text: (v) => (absentOrNull(v) || typeof v === 'string' ? null : `not a string (${kind(v)})`),
  // a String that must be there (synthesized non-optional)
  string: (v) => (typeof v === 'string' ? null : v === undefined ? 'missing' : `not a string (${kind(v)})`),
  flag: (v) => (absentOrNull(v) || typeof v === 'boolean' ? null : `not a bool (${kind(v)})`),
  // c.rating: any number
  rating: (v) => (absentOrNull(v) || typeof v === 'number' ? null : `not a number (${kind(v)})`),
  // decodeIfPresent(Int): a whole number
  int: (v) => (absentOrNull(v) || Number.isInteger(v) ? null : `not a whole number (${kind(v)})`),
  intRequired: (v) => (Number.isInteger(v) ? null : v === undefined ? 'missing' : `not a whole number (${kind(v)})`),
  number: (v) => (absentOrNull(v) || typeof v === 'number' ? null : `not a number (${kind(v)})`),
  numberRequired: (v) => (typeof v === 'number' ? null : v === undefined ? 'missing' : `not a number (${kind(v)})`),
  // c.numberOrNumericString
  numberOrNumericString: (v) => (absentOrNull(v) || typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) ? null : `not a number or numeric string (${kind(v)})`),
  // FlexibleDate: Timestamp, ISO string (unparseable → nil, a note), null, absent
  moment: Object.assign(
    (v) => (absentOrNull(v) || isTimestamp(v) || typeof v === 'string' ? null : `not a Timestamp or string (${kind(v)})`),
    { note: (v) => (typeof v === 'string' && !ISO_MOMENT.test(v) ? 'string that is not an ISO moment (reads as no date)' : null) },
  ),
  stringList: (v) => (absentOrNull(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? null : `not a list of strings`),
  // a [String] that must be there (synthesized non-optional)
  stringListRequired: (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : v === undefined ? 'missing' : 'not a list of strings'),
  stringMap: (v) => (absentOrNull(v) || (isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string')) ? null : 'not a map of strings'),
  intMap: (v) => (absentOrNull(v) || (isPlainObject(v) && Object.values(v).every((x) => Number.isInteger(x))) ? null : 'not a map of whole numbers'),
  // FollowedBand: an object with a name, or a plain name
  followedBand: (v) => (typeof v === 'string' ? null : isPlainObject(v) ? null : `neither a name nor an object (${kind(v)})`),
};

function kind(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (isTimestamp(v)) return 'Timestamp';
  return typeof v;
}

// Nested shapes: { fields, required?: bool, list?: bool, ignore?: [...] }
const obj = (fields, opts = {}) => ({ obj: fields, ...opts });
const list = (fields, opts = {}) => ({ list: fields, ...opts });

// ── Schemas (one per Swift model) ─────────────────────────────────────

const REVIEW_REASON = obj({ with: R.string, overlap: R.number });

const SONG = {
  id: R.text, name: R.text, set: R.text, setBreak: R.text, cover: R.text, tape: R.flag, rating: R.rating,
  comment: R.text, manuallyAdded: R.flag, transitionMark: R.text, footnote: R.text, jamchart: R.flag,
  jamchartNote: R.text, sourceGap: R.int, debut: R.flag, songId: R.text, songSlug: R.text,
  sourceOpener: R.flag, notInSource: R.flag,
};

const SHOW = {
  id: R.text, artist: R.text, venue: R.text, city: R.text, country: R.text, state: R.text, date: R.text,
  tour: R.text, setlist: list(SONG), setlistfmId: R.text, setlistfmUrl: R.text, artistMbid: R.text,
  isManual: R.flag, createdAt: R.moment, rating: R.rating, comment: R.text, venueRating: R.rating,
  festivalId: R.text, festivalName: R.text, isFestival: R.flag, taggedBy: R.text, taggedByUid: R.text,
  taggedFriendUids: R.stringList, archivalAudioPick: R.text, migratedFromLocal: R.flag,
  setlistSource: R.text, sourceShowId: R.text, sourcePermalink: R.text, setlistNotes: R.text,
  setlistFetchedAt: R.text, sourceLicenseUrl: R.text, needsReview: R.flag, needsReviewReason: REVIEW_REASON,
  setlistProposal: obj({
    source: R.text, songs: list(SONG), sourceShowId: R.text, sourcePermalink: R.text, setlistNotes: R.text,
    licenseUrl: R.text, needsReview: R.flag, disagreement: REVIEW_REASON, confidence: R.text, partial: R.flag,
    status: R.text, decidedAt: R.text,
  }),
  setlistSourceChange: obj({ from: R.text, to: R.text, songsChanged: R.flag }),
  normalizedVersion: R.int, needsNormalization: R.flag,
};
// Show.ignoredFields: carried by documents, not read by the app.
const SHOW_IGNORED = ['artistImage', 'posterCheckedQuick', 'posterCheckedDeep', 'posterUrl', 'posterSource', 'posterSourceUrl',
  'importedByAdmin', 'dateNormalizedFrom', 'setlistScanAt', 'setlistFetchAttempted', 'populatedAt', 'populatedFrom'];

const TAG_SHOW = obj({
  artist: R.text, venue: R.text, city: R.text, date: R.text, tour: R.text, setlistfmId: R.text, setlistfmUrl: R.text,
  isManual: R.flag, setlist: list({ id: R.string, name: R.string }), upcoming: R.flag, time: R.text, ticketUrl: R.text,
}, { required: true });

const NAME_COUNT = { name: R.string, count: R.intRequired };

const SCHEMAS = {
  shows: { fields: SHOW, ignore: SHOW_IGNORED, dates: true },
  upcomingShows: {
    fields: {
      artist: R.text, venue: R.text, city: R.text, date: R.text, time: R.text, notes: R.text, source: R.text,
      sourceEventId: R.text, ticketUrl: R.text, taggedFriendUids: R.stringList, taggedBy: R.text, taggedByUid: R.text,
      originUpcomingId: R.text, createdAt: R.moment, updatedAt: R.moment,
    },
  },
  friends: { fields: { friendUid: R.text, friendName: R.text, friendPhotoURL: R.text, addedAt: R.moment }, ignore: ['friendEmail'] },
  userProfiles: {
    fields: {
      displayName: R.text, firstName: R.text, handle: R.text, photoURL: R.text,
      favoriteArtists: { each: R.followedBand, objectFields: { name: R.text, mbid: R.text, addedAt: R.text } },
      termsAcceptedVersion: R.int, termsAcceptedAt: R.moment, banned: R.flag, isTestUser: R.flag,
      shareActivity: R.flag, publicProfile: R.flag, showOnLeaderboard: R.flag, convertedFromGuest: R.flag, createdAt: R.moment,
    },
    // Read by nothing in the app (the counts are never trusted; CLAUDE.md).
    ignore: ['showCount', 'songCount', 'ratedSongCount', 'venueCount', 'odubleserId', 'userId', 'lastLogin', 'updatedAt',
      'notificationPrefs', 'welcomeEmail', 'emailOptOut', 'emailOptOutAt', 'emailOptOutMethod', 'emailOptOutSource',
      'guestSessionId', 'guestConvertedAt', 'guestShowsAdded', 'handleLower', 'invitedByUid', 'invitedByName',
      'inviteAcceptedAt', 'bustOutSensitivity'],
  },
  userStats: {
    fields: {
      statsVersion: R.int, showCount: R.int, songCount: R.int, ratedSongCount: R.int, uniqueSongCount: R.int,
      bandCount: R.int, venueCount: R.int, yearsActive: R.int, showsByYear: R.intMap, firstShowDate: R.text,
      lastShowDate: R.text, avgShowRating: R.numberOrNumericString, ratedShowCount: R.int,
      topBands: list(NAME_COUNT), topVenues: list(NAME_COUNT), ranked: R.flag, rank: R.int, rankedOf: R.int, computedAt: R.moment,
    },
  },
  publicUserStats: {
    fields: {
      statsVersion: R.int, showCount: R.intRequired, songCount: R.intRequired, ratedSongCount: R.intRequired,
      venueCount: R.intRequired, rank: R.int, rankedOf: R.int, computedAt: R.moment,
    },
  },
  communityStats: {
    fields: {
      totalUsers: R.int, totalShows: R.int, totalSongs: R.int, rankedCount: R.int,
      topShowsAttended: list({ userId: R.text, odubleserId: R.text, firstName: R.text, photoURL: R.text, count: R.int }),
      topSongsRated: list({ userId: R.text, odubleserId: R.text, firstName: R.text, photoURL: R.text, count: R.int }),
      topVenuesVisited: list({ userId: R.text, odubleserId: R.text, firstName: R.text, photoURL: R.text, count: R.int }),
      topSongsBySightings: list({ songName: R.string, userCount: R.intRequired, artists: R.stringListRequired }),
      topSongsByRating: list({ songName: R.text, avgRating: R.numberOrNumericString, ratingCount: R.int, artists: R.stringList }),
      topVenues: list({ venueName: R.string, showCount: R.intRequired, artistCount: R.intRequired }),
      updatedAt: R.moment,
    },
  },
  yearInReviews: {
    fields: {
      userId: R.text, year: R.intRequired, privacy: R.text, generatedDate: R.moment, statsComputedAt: R.moment,
      stats: obj({
        year: R.intRequired, totalShows: R.intRequired, totalArtists: R.intRequired, totalVenues: R.intRequired,
        countriesVisited: R.stringListRequired, statesVisited: R.stringListRequired,
        topArtist: obj({ name: R.string, showCount: R.intRequired, avgRating: R.number }),
        topRatedShows: list({ showId: R.string, artist: R.string, venue: R.string, city: R.text, date: R.string, rating: R.intRequired }),
        favoriteVenue: obj({ name: R.string, city: R.text, frequency: R.intRequired }),
        mostSeenSong: obj({ name: R.string, count: R.intRequired }),
        highestRatedArtist: obj({ name: R.string, avgRating: R.numberRequired }),
        longestConsecutiveStreak: R.intRequired,
        achievements: list({ title: R.string, description: R.string }),
        shareableQuote: R.string,
      }),
      // The 2026 recap (5.60.16), YearRecap in Swift: every field required.
      recap: obj({
        year: R.intRequired, totalShows: R.intRequired, totalBands: R.intRequired, totalVenues: R.intRequired,
        totalCities: R.intRequired, songsHeard: R.intRequired, newBands: R.intRequired,
        newBandNames: R.stringListRequired, newVenues: R.intRequired,
        topBands: list({ name: R.string, shows: R.intRequired }),
        topSongs: list({ name: R.string, artist: R.string, count: R.intRequired }),
        noSetlist: list({ id: R.string, artist: R.string, venue: R.string, city: R.string, date: R.string }),
        showsWithSetlist: R.intRequired,
        highlights: obj({
          firstShow: obj({ id: R.string, artist: R.string, venue: R.string, city: R.string, date: R.string }, { required: true }),
          latestShow: obj({ id: R.string, artist: R.string, venue: R.string, city: R.string, date: R.string }, { required: true }),
          busiestMonth: obj({ month: R.intRequired, name: R.string, shows: R.intRequired }, { required: true }),
          longestRun: obj({ key: R.string, artist: R.string, venue: R.string, city: R.string, nights: R.intRequired, start: R.string, end: R.string }),
        }, { required: true }),
        updatedThrough: R.string,
      }),
    },
    requiredLists: { 'stats.topRatedShows': true, 'stats.achievements': true, 'recap.topBands': true, 'recap.topSongs': true, 'recap.noSetlist': true },
  },
  config: {
    fields: { minSupportedIosVersion: R.text, latestIosVersion: R.text, reason: R.text, iosPushOfferEnabled: R.flag, updatedAt: R.moment },
    ignore: ['updatedBy'],
  },
  showTags: {
    fields: { fromUid: R.text, fromName: R.text, toUid: R.text, showData: TAG_SHOW, status: R.text, createdAt: R.moment, upcomingShowId: R.text },
    ignore: ['revokedAt'],
    tagDates: true,
  },
  pendingEmailTags: {
    fields: { fromUid: R.text, fromName: R.text, toName: R.text, showData: TAG_SHOW, personalMessage: R.text, status: R.text, createdAt: R.moment },
    ignore: ['fromEmail', 'toEmail'],
    tagDates: true,
  },
  showSuggestions: {
    fields: {
      participants: R.stringList, names: R.stringMap, showKey: R.text,
      showData: obj({ artist: R.string, venue: R.string, date: R.string, city: R.string, setlistfmId: R.text }, { required: true }),
      responses: R.stringMap, overallStatus: R.text, createdAt: R.moment, updatedAt: R.moment, backfill: R.flag,
    },
    ignore: ['emailSentToUid', 'emailSentAt', 'lastViewedAt'],
  },
};

// ── The checker ───────────────────────────────────────────────────────

/**
 * checkDocument(schema, data) → { failures: [reason], notes: [note], unknown: [field] }
 * Reasons and notes name the field path and the rule, never a value.
 */
function checkDocument(schema, data, requiredLists = {}) {
  const out = { failures: [], notes: [], unknown: [] };
  if (!isPlainObject(data)) { out.failures.push('$: not a document'); return out; }
  walk(schema.fields, data, '', out, requiredLists);
  for (const key of Object.keys(data)) {
    if (!(key in schema.fields) && !(schema.ignore || []).includes(key)) out.unknown.push(key);
  }
  if (schema.dates && typeof data.date === 'string' && data.date !== '' && !toIsoDate(data.date)) out.notes.push('date: does not read as a day');
  if (schema.tagDates && isPlainObject(data.showData) && typeof data.showData.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(data.showData.date)) {
    out.notes.push(toIsoDate(data.showData.date) ? 'showData.date: legacy format (reads)' : 'showData.date: does not read as a day');
  }
  return out;
}

function walk(fields, data, prefix, out, requiredLists) {
  for (const [key, rule] of Object.entries(fields)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const v = data[key];
    if (typeof rule === 'function') {
      const reason = rule(v);
      if (reason) out.failures.push(`${p}: ${reason}`);
      else if (rule.note) { const n = rule.note(v); if (n) out.notes.push(`${p}: ${n}`); }
      continue;
    }
    if (rule.each) {
      if (absentOrNull(v)) continue;
      if (!Array.isArray(v)) { out.failures.push(`${p}: not a list`); continue; }
      v.forEach((item) => {
        const reason = rule.each(item);
        if (reason) out.failures.push(`${p}[]: ${reason}`);
        else if (isPlainObject(item) && rule.objectFields) walk(rule.objectFields, item, `${p}[]`, out, requiredLists);
      });
      continue;
    }
    if (rule.list) {
      if (absentOrNull(v)) { if (requiredLists[p]) out.failures.push(`${p}: missing`); continue; }
      if (!Array.isArray(v)) { out.failures.push(`${p}: not a list (${kind(v)})`); continue; }
      v.forEach((item) => {
        if (!isPlainObject(item)) out.failures.push(`${p}[]: not an object (${kind(item)})`);
        else walk(rule.list, item, `${p}[]`, out, requiredLists);
      });
      continue;
    }
    if (rule.obj) {
      if (absentOrNull(v)) { if (rule.required) out.failures.push(`${p}: missing`); continue; }
      if (!isPlainObject(v)) { out.failures.push(`${p}: not an object (${kind(v)})`); continue; }
      walk(rule.obj, v, p, out, requiredLists);
    }
  }
}

// ── The run ───────────────────────────────────────────────────────────

function tally() {
  return { docs: 0, failing: 0, failures: {}, notes: {}, unknown: {} };
}

function record(t, result) {
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  t.docs++;
  if (result.failures.length) t.failing++;
  new Set(result.failures).forEach((f) => inc(t.failures, f));
  new Set(result.notes).forEach((n) => inc(t.notes, n));
  result.unknown.forEach((u) => inc(t.unknown, u));
}

(function loadDotEnv() {
  const fs = require('fs');
  for (const name of ['.env', '.env.local']) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = raw.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}());

async function main() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!privateKey || !clientEmail || !projectId) {
      console.error('FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID must be set (in .env or the environment).');
      process.exit(1);
    }
    initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
  }
  const db = getFirestore();

  const sources = [
    ['shows', async () => (await db.collectionGroup('shows').get()).docs.filter((d) => /^users\/[^/]+\/shows\/[^/]+$/.test(d.ref.path))],
    ['upcomingShows', async () => (await db.collectionGroup('upcomingShows').get()).docs.filter((d) => /^users\/[^/]+\/upcomingShows\//.test(d.ref.path))],
    ['friends', async () => (await db.collectionGroup('friends').get()).docs.filter((d) => /^users\/[^/]+\/friends\//.test(d.ref.path))],
    ['userProfiles', async () => (await db.collection('userProfiles').get()).docs],
    ['userStats', async () => (await db.collection('userStats').get()).docs],
    ['publicUserStats', async () => (await db.collection('publicUserStats').get()).docs],
    ['communityStats', async () => [await db.doc('communityStats/global').get()].filter((d) => d.exists)],
    ['yearInReviews', async () => (await db.collection('yearInReviews').get()).docs],
    ['config', async () => [await db.doc('config/app').get()].filter((d) => d.exists)],
    ['showTags', async () => (await db.collection('showTags').get()).docs],
    ['pendingEmailTags', async () => (await db.collection('pendingEmailTags').get()).docs],
    ['showSuggestions', async () => (await db.collection('showSuggestions').get()).docs],
  ];

  console.log('Read-only. Counts only: no ids, names, addresses or document text.\n');
  let totalFailing = 0;
  for (const [name, read] of sources) {
    const schema = SCHEMAS[name];
    const t = tally();
    for (const d of await read()) record(t, checkDocument(schema, d.data(), schema.requiredLists));
    totalFailing += t.failing;
    console.log(`${name}: ${t.docs} documents, ${t.failing} would fail to decode`);
    for (const [k, n] of Object.entries(t.failures).sort()) console.log(`  FAIL  ${k}: ${n}`);
    for (const [k, n] of Object.entries(t.notes).sort()) console.log(`  note  ${k}: ${n}`);
    const unknown = Object.entries(t.unknown).sort();
    if (unknown.length) console.log(`  not read by the app: ${unknown.map(([k, n]) => `${k} (${n})`).join(', ')}`);
  }
  console.log(`\n${totalFailing === 0 ? 'Every document decodes.' : `${totalFailing} documents would fail to decode.`}`);
  process.exit(0);
}

module.exports = { checkDocument, SCHEMAS };

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
