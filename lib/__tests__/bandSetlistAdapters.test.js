/**
 * Unit tests for the band-source adapters —
 * netlify/functions/lib/songfishAdapter.js and phishnetAdapter.js — and the
 * shape logic they share in bandSetlistShape.js.
 *
 * These exercise the mapping and grouping logic against fixture responses
 * WITHOUT going near the network: readEnvelope, groupRowsByShow and mapShow
 * are all pure, and fetchSetlists is the only function that opens a socket.
 *
 * The EL GOOSE fixtures now use the archive's REAL key names, read back off
 * a live response via ?debug=1, so these tests do check the mapping rather
 * than merely confirming the guess it was written from. Four keys were
 * wrong before that check and are asserted here explicitly: jamchart_notes
 * (not jamchart_description), song_id as distinct from uniqueid,
 * original_artist for covers, and shownotes for show notes — plus the
 * absence of any gap field, asserted as an absence so nobody re-adds a
 * mapping that cannot resolve.
 *
 * The PHISH.NET fixtures are still constructed from documentation and have
 * never met a live response; phish.net is parked. Its `gap` mapping in
 * particular is unverified. See the provenance note in
 * fixtures/bandSetlistFixtures.js.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/bandSetlistAdapters.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const songfish = require('../../netlify/functions/lib/songfishAdapter.js');
const songfishSites = require('../../netlify/functions/lib/songfishSites.js');
const ELGOOSE_SITE = songfishSites.siteById('elgoose');
// The Songfish adapter, bound to the El Goose site the way band-setlist.js
// binds it, so these tests read the same as the phish.net ones.
const elgoose = {
  readEnvelope: (payload) => songfish.readEnvelope(payload, ELGOOSE_SITE.hostname),
  describeUpstream: songfish.describeUpstream,
  groupRowsByShow: songfish.groupRowsByShow,
  mapShow: (rows) => songfish.mapShow(rows, ELGOOSE_SITE),
  rowsForArtist: songfish.rowsForArtist,
};
const phishnet = require('../../netlify/functions/lib/phishnetAdapter.js');
const shape = require('../../netlify/functions/lib/bandSetlistShape.js');
const bandSetlist = require('../../netlify/functions/band-setlist.js');
const fx = require('./fixtures/bandSetlistFixtures.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

// Runs an adapter's pure pipeline — envelope, group, map — the way
// fetchSetlists does once the HTTP response is in hand.
function mapAll(adapter, payload) {
  const envelope = adapter.readEnvelope(payload);
  if (!envelope.ok) return { ok: false, message: envelope.message, shows: [] };
  const shows = adapter.groupRowsByShow(envelope.rows).map(adapter.mapShow);
  return { ok: true, message: '', shows };
}

const titles = (songs) => songs.map(s => s.name);
const labels = (songs) => songs.map(s => s.set);
const byName = (songs, name) => songs.find(s => s.name === name);

// ── The envelope: 0 vs false ──────────────────────────────────────────
// The one documented difference between the two APIs, and the reason each
// adapter tests its own error node rather than sharing one check.

test('elgoose: error 0 is success', () => {
  assert.strictEqual(elgoose.readEnvelope(fx.ELGOOSE_RADIO_CITY).ok, true);
});

test('elgoose: error 1 is a failure, carrying error_message', () => {
  const e = elgoose.readEnvelope(fx.ELGOOSE_ERROR);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.message, 'No results found');
});

test('phishnet: error false (a boolean, not 0) is success', () => {
  assert.strictEqual(fx.PHISHNET_HAMPTON.error, false, 'fixture must use a boolean');
  assert.strictEqual(phishnet.readEnvelope(fx.PHISHNET_HAMPTON).ok, true);
});

test('phishnet: error true is a failure, carrying error_message', () => {
  const e = phishnet.readEnvelope(fx.PHISHNET_ERROR);
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.message, 'Invalid API key');
});

test('phishnet: a STRING "true" error is still a failure — not tested truthily', () => {
  // The trap: "true" is a truthy string but `0`/`false` are both falsy, so
  // a truthy check happens to work for the documented values and silently
  // breaks the day either API quotes them.
  const e = phishnet.readEnvelope(fx.PHISHNET_ERROR_STRING);
  assert.strictEqual(e.ok, false);
});

test('both adapters reject a non-object payload rather than throwing', () => {
  assert.strictEqual(elgoose.readEnvelope(null).ok, false);
  assert.strictEqual(phishnet.readEnvelope(undefined).ok, false);
  assert.strictEqual(elgoose.readEnvelope('nope').ok, false);
});

test('a payload with a non-array data node yields no rows, not a crash', () => {
  assert.deepStrictEqual(elgoose.readEnvelope({ error: 0, data: 'x' }).rows, []);
});

// ── El Goose: flat rows to a normalized setlist ───────────────────────

test('elgoose: one date, one show, flat rows grouped into it', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(shows.length, 1);
  assert.strictEqual(shows[0].venue, 'Ascend Amphitheater');
  assert.strictEqual(shows[0].source, 'elgoose');
  assert.strictEqual(shows[0].sourceShowId, '1719248440');
});

test('elgoose: a relative permalink is resolved to an absolute URL', () => {
  // The archive sends a bare filename. Rendered as-is that is a relative
  // href and the attribution link 404s on our own site.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(
    shows[0].sourcePermalink,
    'https://elgoose.net/setlists/goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html'
  );
});

test('elgoose: settype/setnumber map onto the app canonical labels', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.deepStrictEqual(labels(shows[0].songs), ['Set I', 'Set I', 'Set I', 'Set II', 'Encore']);
});

test('elgoose: the soundcheck row is dropped and counted, not stored', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(shows[0].droppedSoundcheckCount, 1);
  assert.ok(!titles(shows[0].songs).includes('Arcadia'), 'soundcheck song must not be in the setlist');
});

test('elgoose: transition marks — > and -> segue, comma and empty do not', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  const songs = shows[0].songs;

  // '->' is preserved rather than collapsed to '>': the two mean
  // different things to the people who maintain these archives.
  assert.strictEqual(byName(songs, 'Echo of a Rose').tape, true);
  assert.strictEqual(byName(songs, 'Echo of a Rose').transitionMark, '->');

  assert.strictEqual(byName(songs, 'Green River').tape, true);
  assert.strictEqual(byName(songs, 'Green River').transitionMark, '>');

  // A comma is not a segue.
  assert.strictEqual(byName(songs, 'Madhuvan').tape, false);
  assert.strictEqual(byName(songs, 'Madhuvan').transitionMark, undefined);

  assert.strictEqual(byName(songs, 'Dripfield').tape, false);
});

test('elgoose: footnotes, jam chart flag and note land on the right songs', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  const songs = shows[0].songs;

  assert.strictEqual(byName(songs, 'Echo of a Rose').footnote, 'Fast version.');
  assert.strictEqual(byName(songs, 'Dripfield').footnote, 'Guest: Marcus King on guitar');

  // jamchart_notes, NOT jamchart_description. The guessed key meant a
  // flagged song got a badge with nothing behind it.
  assert.strictEqual(byName(songs, 'Into the Myst').jamchart, true);
  assert.strictEqual(
    byName(songs, 'Into the Myst').jamchartNote,
    'Exploratory, patient build into a full-band peak.'
  );

  // Not flagged means the key is absent entirely, not `false` — a
  // setlist.fm-sourced song has no such key and the two must look alike.
  assert.strictEqual('jamchart' in byName(songs, 'Echo of a Rose'), false);
  assert.strictEqual('footnote' in byName(songs, 'Madhuvan'), false);
});

test('elgoose: NO sourceGap — the showdate endpoint has no gap field', () => {
  // Confirmed by reading every key the archive sends. The old `gap: 'gap'`
  // entry mapped a key that has never existed, so sourceGap was silently
  // absent from every song while the mapping looked complete. Asserted as
  // an absence so nobody re-adds a mapping that cannot resolve.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  shows[0].songs.forEach((song) => {
    assert.strictEqual('sourceGap' in song, false, `${song.name} should carry no sourceGap`);
  });
});

test('elgoose: the covered artist comes from original_artist', () => {
  // This adapter used to hardcode cover: null and claim the archive did
  // not provide it. It does.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  const songs = shows[0].songs;
  assert.strictEqual(byName(songs, 'Green River').cover, 'Creedence Clearwater Revival');
  // An original is never labelled a cover of itself.
  assert.strictEqual(byName(songs, 'Echo of a Rose').cover, null);
  assert.strictEqual(byName(songs, 'Into the Myst').cover, null);
});

test('sourceGap still works where a source genuinely sends gap (phish.net)', () => {
  // The shared machinery is intact; only elgoose lacks the field. NOTE:
  // phish.net's `gap` mapping is itself unverified — it is parked.
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const songs = shows[0].songs;
  assert.strictEqual(byName(songs, 'Mikes Song').sourceGap, 4);
  assert.strictEqual(byName(songs, 'Simple').sourceGap, 7);
});
test('elgoose: songId is song_id (stable), not uniqueid (one rendition)', () => {
  // uniqueid differs per performance — the same song twice in a set has
  // two of them — so it cannot address a song page. song_id can.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  const song = byName(shows[0].songs, 'Green River');
  assert.strictEqual(song.songId, '812');
  assert.notStrictEqual(song.songId, '56313', 'must not be the uniqueid');
  assert.strictEqual(song.songSlug, 'green-river');
});

test('elgoose: shownotes becomes setlistNotes, with HTML stripped', () => {
  // This adapter used to hardcode '' and call show notes phish.net-only.
  // The archive does send them, as HTML.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(
    shows[0].setlistNotes,
    'Night two in Nashville.\nFirst Green River since 2022.'
  );
});

test('stripHtml turns markup into readable text, keeping paragraph breaks', () => {
  assert.strictEqual(shape.stripHtml('a<br>b'), 'a\nb');
  assert.strictEqual(shape.stripHtml('<p>one</p><p>two</p>'), 'one\ntwo');
  assert.strictEqual(shape.stripHtml('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.strictEqual(shape.stripHtml('<a href="/x">link</a>'), 'link');
  assert.strictEqual(shape.stripHtml(null), '');
});

test('elgoose: tour name is read off the show', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(shows[0].tour, 'Fall Tour 2024');
});

test('elgoose: two shows on one date come back as two shows', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_TWO_SHOWS_ONE_DATE);
  assert.strictEqual(shows.length, 2);
  assert.deepStrictEqual(shows.map(s => s.venue).sort(), ['Bonnaroo', 'The Gorge Amphitheatre']);
});

// ── Phish.net ─────────────────────────────────────────────────────────

test('phishnet: the single `set` code maps onto canonical labels', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  assert.deepStrictEqual(labels(shows[0].songs), ['Set I', 'Set I', 'Set II', 'Encore', 'Encore II']);
});

test('phishnet: a second encore is "Encore II", which CANONICAL_ORDER sorts', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const rocky = byName(shows[0].songs, 'Rocky Top');
  assert.strictEqual(rocky.set, 'Encore II');
});

test('phishnet: splitSetCode handles set numbers, e, e2 and soundcheck', () => {
  assert.deepStrictEqual(phishnet.splitSetCode('1'), { setType: 'set', setNumber: 1 });
  assert.deepStrictEqual(phishnet.splitSetCode('3'), { setType: 'set', setNumber: 3 });
  assert.deepStrictEqual(phishnet.splitSetCode('e'), { setType: 'encore', setNumber: 1 });
  assert.deepStrictEqual(phishnet.splitSetCode('e2'), { setType: 'encore', setNumber: 2 });
  assert.deepStrictEqual(phishnet.splitSetCode('E3'), { setType: 'encore', setNumber: 3 });
  assert.deepStrictEqual(phishnet.splitSetCode('soundcheck'), { setType: 'soundcheck', setNumber: 1 });
  // An empty or unparseable code is a regular first set rather than a throw.
  assert.deepStrictEqual(phishnet.splitSetCode(''), { setType: 'set', setNumber: 1 });
  assert.deepStrictEqual(phishnet.splitSetCode(null), { setType: 'set', setNumber: 1 });
});

test('phishnet: transmark parses the same way elgoose transition does', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const songs = shows[0].songs;
  assert.strictEqual(byName(songs, 'Mikes Song').transitionMark, '>');
  assert.strictEqual(byName(songs, 'Mikes Song').tape, true);
  assert.strictEqual(byName(songs, 'Simple').transitionMark, '->');
  assert.strictEqual(byName(songs, 'Halleys Comet').tape, false);
  assert.strictEqual(byName(songs, 'Rocky Top').tape, false);
});

test('phishnet: setlistnotes becomes the show-level setlistNotes', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  assert.strictEqual(shows[0].setlistNotes, 'This show was officially released as Hampton Comes Alive.');
});

test('phishnet: show-level fields — permalink, showid, venue, tour', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const s = shows[0];
  assert.strictEqual(s.source, 'phishnet');
  assert.strictEqual(s.venue, 'Hampton Coliseum');
  assert.strictEqual(s.city, 'Hampton');
  assert.strictEqual(s.tour, '1997 Fall Tour');
  assert.strictEqual(s.sourceShowId, '1252344800');
  assert.ok(s.sourcePermalink.startsWith('https://phish.net/setlists/'));
});

test('phishnet: jam chart flag and its description', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const simple = byName(shows[0].songs, 'Simple');
  assert.strictEqual(simple.jamchart, true);
  assert.strictEqual(simple.jamchartNote, 'Uncommonly patient Simple.');
  assert.strictEqual(simple.footnote, 'Unfinished.');
});

// Awaited here rather than inside test(), whose runner is synchronous — an
// async callback would resolve after the summary printed and a failure
// would go unreported.
const noKeyResult = await phishnet.fetchSetlists('1997-11-22', {});
test('phishnet: fetchSetlists refuses to open a socket without an API key', () => {
  assert.strictEqual(noKeyResult.ok, false);
  assert.match(noKeyResult.message, /API key/i);
  assert.deepStrictEqual(noKeyResult.shows, []);
});

// ── The shared shape logic ────────────────────────────────────────────

test('pickSetLabel: regular sets get roman numerals', () => {
  assert.strictEqual(shape.pickSetLabel('Set', 1), 'Set I');
  assert.strictEqual(shape.pickSetLabel('Set', 2), 'Set II');
  assert.strictEqual(shape.pickSetLabel('set', 3), 'Set III');
  assert.strictEqual(shape.pickSetLabel('', 1), 'Set I');
});

test('pickSetLabel: encore 1 is "Encore", not "Encore I"', () => {
  // Matches extractSongsFromSetlist exactly, which is what makes
  // groupSongsBySet's CANONICAL_ORDER keep working.
  assert.strictEqual(shape.pickSetLabel('Encore', 1), 'Encore');
  assert.strictEqual(shape.pickSetLabel('Encore', 2), 'Encore II');
  assert.strictEqual(shape.pickSetLabel('encore', 3), 'Encore III');
});

test('pickSetLabel: a soundcheck returns null so the caller can drop it', () => {
  assert.strictEqual(shape.pickSetLabel('Soundcheck', 1), null);
});

test('setSortKey: every encore sorts after every regular set', () => {
  assert.ok(shape.setSortKey('Set', 4) < shape.setSortKey('Encore', 1));
  assert.ok(shape.setSortKey('Encore', 1) < shape.setSortKey('Encore', 2));
  assert.ok(shape.setSortKey('Soundcheck', 1) < shape.setSortKey('Set', 1));
});

test('buildSetlist: rows arriving out of order come out in performance order', () => {
  const rows = [
    { set: 'Encore', setSortKey: shape.setSortKey('Encore', 1), position: 1, name: 'Encore Song' },
    { set: 'Set II', setSortKey: shape.setSortKey('Set', 2), position: 2, name: 'Second Second' },
    { set: 'Set I', setSortKey: shape.setSortKey('Set', 1), position: 1, name: 'Opener' },
    { set: 'Set II', setSortKey: shape.setSortKey('Set', 2), position: 1, name: 'First Second' },
  ];
  const { songs } = shape.buildSetlist(rows);
  assert.deepStrictEqual(titles(songs), ['Opener', 'First Second', 'Second Second', 'Encore Song']);
});

test('parseTransition: only marks containing > are segues', () => {
  assert.deepStrictEqual(shape.parseTransition(' > '), { transitionMark: '>', tape: true });
  assert.deepStrictEqual(shape.parseTransition('->'), { transitionMark: '->', tape: true });
  assert.deepStrictEqual(shape.parseTransition(','), { transitionMark: '', tape: false });
  assert.deepStrictEqual(shape.parseTransition(''), { transitionMark: '', tape: false });
  assert.deepStrictEqual(shape.parseTransition(null), { transitionMark: '', tape: false });
});

test('toBool accepts the 0/1, "0"/"1" and true/false these APIs mix', () => {
  assert.strictEqual(shape.toBool(1), true);
  assert.strictEqual(shape.toBool('1'), true);
  assert.strictEqual(shape.toBool(true), true);
  assert.strictEqual(shape.toBool('true'), true);
  assert.strictEqual(shape.toBool(0), false);
  assert.strictEqual(shape.toBool('0'), false);
  assert.strictEqual(shape.toBool(''), false);
  assert.strictEqual(shape.toBool(null), false);
});

test('every song gets a distinct id', () => {
  const { shows } = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  const ids = shows[0].songs.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ids.forEach(id => assert.ok(id && typeof id === 'string'));
});

// ── A mis-transcribed title key must not produce nameless songs ───────
// The whole point of the untitled-row drop. See buildSetlist in
// bandSetlistShape.js, and the merge-side half in bandSetlistMerge.test.js.

test('a mis-transcribed song-title key yields NO songs, not nameless ones', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_MISTRANSCRIBED_TITLE_KEY);
  assert.strictEqual(shows.length, 1, 'the show still comes through so the counts are visible');
  assert.deepStrictEqual(shows[0].songs, [], 'no songs at all — never blank-named ones');
  assert.strictEqual(shows[0].droppedUntitledCount, 2);
});

test('droppedUntitledCount is 0 on a correctly mapped response', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(shows[0].droppedUntitledCount, 0);
  const p = mapAll(phishnet, fx.PHISHNET_HAMPTON);
  assert.strictEqual(p.shows[0].droppedUntitledCount, 0);
});

test('selectShow on an all-untitled show returns an empty setlist', () => {
  // Which is what makes the merge rules leave the existing setlist alone.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_MISTRANSCRIBED_TITLE_KEY);
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2023-12-30', venue: '' });
  assert.deepStrictEqual(picked.songs, []);
  assert.strictEqual(picked.droppedUntitledCount, 2);
});

test('buildSetlist drops a blank, whitespace-only or missing title', () => {
  const rows = [
    { set: 'Set I', setSortKey: 1, position: 1, name: 'Real Song' },
    { set: 'Set I', setSortKey: 1, position: 2, name: '' },
    { set: 'Set I', setSortKey: 1, position: 3, name: '   ' },
    { set: 'Set I', setSortKey: 1, position: 4, name: null },
    { set: 'Set I', setSortKey: 1, position: 5 },
  ];
  const { songs, droppedUntitledCount } = shape.buildSetlist(rows);
  assert.deepStrictEqual(titles(songs), ['Real Song']);
  assert.strictEqual(droppedUntitledCount, 4);
});

// ── Telling "no show" apart from "wrong field mapping" ───────────────
// A 200 with no usable rows used to look identical either way, which is
// exactly the ambiguity that matters while the FIELDS maps are unverified.

test('a 200 with data as an object is a shape failure, not an empty result', () => {
  const e = elgoose.readEnvelope({ error: 0, error_message: null, data: { showdate: '2023-12-30' } });
  assert.strictEqual(e.ok, false, 'must not be mistaken for "no show on that date"');
  assert.match(e.message, /Unexpected response shape/);
  assert.strictEqual(e.diagnostics.dataType, 'object');
});

test('a 200 with data absent or null is likewise a shape failure', () => {
  assert.strictEqual(elgoose.readEnvelope({ error: 0 }).ok, false);
  assert.strictEqual(elgoose.readEnvelope({ error: 0, data: null }).ok, false);
  assert.strictEqual(phishnet.readEnvelope({ error: false, data: 'nope' }).ok, false);
});

test('an empty data ARRAY stays a legitimate empty result', () => {
  // The archive genuinely having no show that date is not an error.
  const e = elgoose.readEnvelope({ error: 0, error_message: null, data: [] });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(e.rows, []);
  assert.strictEqual(e.diagnostics.rowCount, 0);
});

test('describeUpstream names the real row keys, which is what identifies a bad FIELDS map', () => {
  const d = elgoose.describeUpstream(fx.ELGOOSE_MISTRANSCRIBED_TITLE_KEY);
  assert.strictEqual(d.dataType, 'array');
  assert.strictEqual(d.rowCount, 2);
  // The payoff: the row carries song_name, and FIELDS.songName reads
  // 'songname'. The diagnostic names the spelling that is actually there.
  assert.ok(d.firstRowKeys.includes('song_name'));
  assert.ok(!d.firstRowKeys.includes('songname'));
});

test('describeUpstream reports the envelope values and top-level keys', () => {
  const d = elgoose.describeUpstream(fx.ELGOOSE_RADIO_CITY);
  assert.deepStrictEqual(d.topLevelKeys.sort(), ['data', 'error', 'error_message']);
  // The live archive sends a BOOLEAN false here, not the numeric 0 the
  // docs implied — which is why the envelope check tests both.
  assert.strictEqual(d.errorValue, 'false');
  const p = phishnet.describeUpstream(fx.PHISHNET_ERROR);
  assert.strictEqual(p.errorValue, 'true');
  assert.strictEqual(p.errorMessage, 'Invalid API key');
});

test('describeUpstream survives junk without throwing', () => {
  [null, undefined, 'string', 42].forEach((v) => {
    const d = elgoose.describeUpstream(v);
    assert.strictEqual(d.rowCount, 0);
  });
});

test('a correctly mapped response still carries diagnostics for logging', () => {
  const e = elgoose.readEnvelope(fx.ELGOOSE_RADIO_CITY);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.diagnostics.rowCount, 6);
  assert.ok(e.diagnostics.firstRowKeys.includes('songname'));
});

// ── The function's TTL ceiling and disambiguation ─────────────────────

test('TTL is capped at 24h, honouring phish.net\'s caching policy', () => {
  assert.strictEqual(bandSetlist.MAX_TTL_HOURS, 24);
  // A 1997 show would get search-setlists.js's 7-day (168h) tier. Here the
  // ceiling holds, so a corrected setlist reaches the app the next day
  // rather than the next week.
  assert.strictEqual(bandSetlist.determineTtlHours('1997-11-22'), 24);
});

test('TTL is 1h for a show that has not happened yet', () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(bandSetlist.determineTtlHours(future), 1);
});

test('TTL is 6h for a show in the last month, while corrections land', () => {
  const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(bandSetlist.determineTtlHours(recent), 6);
});

test('TTL of an unparseable date falls back to 1h rather than the ceiling', () => {
  assert.strictEqual(bandSetlist.determineTtlHours('not-a-date'), 1);
});

test('cache keys separate source, artist and date', () => {
  const a = bandSetlist.buildCacheKey('elgoose', 'Goose', '2024-06-22', '');
  const b = bandSetlist.buildCacheKey('phishnet', 'Goose', '2024-06-22', '');
  const c = bandSetlist.buildCacheKey('elgoose', 'Goose', '2024-06-23', '');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
  // Case and padding in the artist name must not fragment the cache.
  assert.strictEqual(a, bandSetlist.buildCacheKey('elgoose', '  goose ', '2024-06-22', ''));
});

// ── One date, two acts in the same archive ────────────────────────────

test('rowsForArtist keeps only the requested artist_id', () => {
  const rows = fx.ELGOOSE_TWO_ARTISTS_ONE_DATE.data;
  const { rows: kept, droppedOtherArtistCount } = elgoose.rowsForArtist(rows, '1');

  assert.strictEqual(kept.length, 2, 'the two Goose rows survive');
  assert.strictEqual(droppedOtherArtistCount, 1, 'the Orebolo row is dropped');
  assert.ok(kept.every((r) => r.artist === 'Goose'));
});

test('rowsForArtist takes the id as a number or a string', () => {
  const rows = fx.ELGOOSE_TWO_ARTISTS_ONE_DATE.data;
  assert.strictEqual(elgoose.rowsForArtist(rows, 7).rows[0].artist, 'Orebolo');
  assert.strictEqual(elgoose.rowsForArtist(rows, '7').rows[0].artist, 'Orebolo');
});

test('rowsForArtist is STRICT: no matching artist_id means no rows', () => {
  // It used to keep every row when it matched none, so a Goose lookup on a
  // date only Orebolo played (2024-02-08) came back as Orebolo's setlist,
  // labelled Goose. An empty result is the safe answer: the merge rules
  // write nothing and the app falls back to setlist.fm.
  const orebolo = fx.ELGOOSE_TWO_ARTISTS_ONE_DATE.data.filter((r) => r.artist === 'Orebolo');
  const { rows: kept, droppedOtherArtistCount } = elgoose.rowsForArtist(orebolo, '1');
  assert.strictEqual(kept.length, 0);
  assert.strictEqual(droppedOtherArtistCount, orebolo.length);
});

test('rowsForArtist with no usable artist id keeps nothing', () => {
  const rows = fx.ELGOOSE_TWO_ARTISTS_ONE_DATE.data;
  ['', null, undefined, 'goose', '1.5'].forEach((id) => {
    assert.strictEqual(elgoose.rowsForArtist(rows, id).rows.length, 0, `artistId ${String(id)}`);
  });
});

// ── Real Songfish encodings, from live responses ──────────────────────

test("songfish: setnumber 'e' is the encore, whatever the settype says", () => {
  // elgoose.net 2024-10-24: Mr. Action is settype 'Set', setnumber 'e',
  // position 16. It used to come out as the last song of Set I.
  const { shows } = mapAll(elgoose, fx.ELGOOSE_REAL_ENCORE);
  assert.deepStrictEqual(
    shows[0].songs.map((s) => `${s.set}: ${s.name}`),
    ['Set I: Echo of a Rose', 'Set I: Same Old Shenanigans', 'Set II: So Ready', 'Set II: Dripfield', 'Encore: Mr. Action'],
  );
});

test('songfish: setParts maps every encore spelling and leaves sets alone', () => {
  const { setParts } = songfish;
  assert.deepStrictEqual(setParts('Set', 'e'), { type: 'Encore', number: '1' });
  assert.deepStrictEqual(setParts('One Set', 'E'), { type: 'Encore', number: '1' });
  assert.deepStrictEqual(setParts('Set', 'e2'), { type: 'Encore', number: '2' });
  assert.deepStrictEqual(setParts('Set', '2'), { type: 'Set', number: '2' });
  assert.deepStrictEqual(setParts('Soundcheck', '1'), { type: 'Soundcheck', number: '1' });
  assert.strictEqual(shape.pickSetLabel('Encore', '2'), 'Encore II');
});

test('songfish: every footnote is kept, not just the first', () => {
  // ttbase.net 2024: footnote 'w/ Jeff Fielder', footnotes
  // '["w\\/ Jeff Fielder","Dedicated to Bill Walton"]'.
  const row = { footnote: 'w/ Jeff Fielder', footnotes: '["w\\/ Jeff Fielder","Dedicated to Bill Walton"]' };
  assert.strictEqual(songfish.footnoteText(row), 'w/ Jeff Fielder; Dedicated to Bill Walton');
});

test('songfish: a single footnote reads the same from either field', () => {
  assert.strictEqual(songfish.footnoteText({ footnote: 'Fast version.', footnotes: '["Fast version."]' }), 'Fast version.');
  assert.strictEqual(songfish.footnoteText({ footnote: 'Fast version.' }), 'Fast version.');
  assert.strictEqual(songfish.footnoteText({ footnote: '', footnotes: '[]' }), '');
  assert.strictEqual(songfish.footnoteText({ footnote: 'Kept', footnotes: 'not json' }), 'Kept');
});

test("songfish: error false is success, error true is failure (elgoose.net's real spelling)", () => {
  assert.strictEqual(elgoose.readEnvelope({ error: false, error_message: '', data: [] }).ok, true);
  assert.strictEqual(elgoose.readEnvelope({ error: true, error_message: 'nope', data: [] }).ok, false);
});

test('songfish: the permalink resolves against the site it came from', () => {
  const site = { id: 'kglw', hostname: 'kglw.net', permalinkBase: 'https://kglw.net/setlists/' };
  const show = songfish.mapShow(fx.ELGOOSE_REAL_ENCORE.data, site);
  assert.strictEqual(show.source, 'kglw');
  assert.match(show.sourcePermalink, /^https:\/\/kglw\.net\/setlists\//);
});

// ── Venue spellings that are not differences ──────────────────────────

test('venueKey folds the spellings that used to cost a match', () => {
  const { venueKey } = bandSetlist;
  const same = (a, b) => assert.strictEqual(venueKey(a), venueKey(b), `${a} should key the same as ${b}`);

  same('Ascend Amphitheater', 'Ascend Amphitheatre');
  same('The Capitol Theatre', 'Capitol Theater');
  same('Brooklyn Bowl, Nashville', 'Brooklyn Bowl Nashville');
  same('Barclays Center', 'Barclays Centre');
  same('Hot Tuna & Friends Hall', 'Hot Tuna and Friends Hall');

  assert.notStrictEqual(venueKey('Ryman Auditorium'), venueKey('Brooklyn Bowl'),
    'two genuinely different venues must still differ');
});

test('selectShow: a venue matches across a theatre/theater spelling', () => {
  const shows = [
    { venue: 'The Gorge Amphitheatre', songs: [{ name: 'Dripfield' }], city: '', state: '' },
    { venue: 'Capitol Theatre', songs: [{ name: 'Arrow' }], city: '', state: '' },
  ];
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: 'Capitol Theater' });

  assert.strictEqual(picked.venue, 'Capitol Theatre');
  assert.match(picked.message, /matched on venue/);
});

test('selectShow: with no venue match it returns the fullest setlist, not the first', () => {
  // A festival day is usually one full set plus a sit-in. Returning the
  // three-song guest spot over the sixteen-song set because it happened to
  // be first in the array is the worse of the two wrong answers.
  const shows = [
    { venue: 'Side Stage', songs: [{ name: 'One' }, { name: 'Two' }], city: '', state: '' },
    { venue: 'Main Stage', songs: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], city: '', state: '' },
  ];
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: 'Nowhere In Particular' });

  assert.strictEqual(picked.venue, 'Main Stage');
  assert.strictEqual(picked.ambiguous, true, 'it is still a guess and must say so');
  assert.strictEqual(picked.candidates.length, 2, 'both candidates are reported');
  assert.match(picked.message, /fullest setlist/);
});

test('selectShow: two shows at the matched venue are a venue-tie, contested with their songs', () => {
  // BottleRock 2025-05-25: El Goose lists two Goose sets, both at "Napa
  // Valley Expo". The venue cannot choose; the caller's existing setlist
  // does (chooseCandidate in lib/bandSetlistMerge.js).
  const shows = [
    { venue: 'Napa Valley Expo', songs: [{ name: 'Rockdale' }], sourceShowId: 'a', city: 'Napa', state: 'CA' },
    { venue: 'Napa Valley Expo', songs: [{ name: 'Animal' }, { name: 'Hungersite' }], sourceShowId: 'b', city: 'Napa', state: 'CA' },
    { venue: 'JaM Cellars Stage', songs: [{ name: 'Tumble' }], sourceShowId: 'c', city: 'Napa', state: 'CA' },
  ];
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2025-05-25', venue: 'Napa Valley Expo' });
  assert.strictEqual(picked.selection, 'venue-tie');
  assert.strictEqual(picked.ambiguous, true);
  assert.deepStrictEqual(picked.contested.map(c => c.sourceShowId), ['a', 'b'], 'only the shows at that venue');
  assert.deepStrictEqual(picked.contested[1].songs.map(s => s.name), ['Animal', 'Hungersite']);
});

test('selectShow: a unique venue match is not contested', () => {
  const shows = [
    { venue: 'Napa Valley Expo', songs: [{ name: 'Rockdale' }], city: '', state: '' },
    { venue: 'JaM Cellars Stage', songs: [{ name: 'Tumble' }], city: '', state: '' },
  ];
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2025-05-25', venue: 'JaM Cellars Stage' });
  assert.strictEqual(picked.selection, 'venue');
  assert.deepStrictEqual(picked.contested, []);
});

test('selectShow: no venue match contests every show; one show is uncontested', () => {
  const shows = [
    { venue: 'Side Stage', songs: [{ name: 'One' }], city: '', state: '' },
    { venue: 'Main Stage', songs: [{ name: 'A' }, { name: 'B' }], city: '', state: '' },
  ];
  const guessed = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: 'Elsewhere' });
  assert.strictEqual(guessed.selection, 'fullest');
  assert.strictEqual(guessed.contested.length, 2);
  const only = bandSetlist.selectShow([shows[0]], { source: 'elgoose', date: '2024-06-22', venue: '' });
  assert.strictEqual(only.selection, 'only');
  assert.deepStrictEqual(only.contested, []);
});

// ── Dates, in both spellings a show document might carry ──────────────

test('the function accepts setlist.fm\'s DD-MM-YYYY and works in ISO', () => {
  const { toIsoDate } = bandSetlist;
  assert.strictEqual(toIsoDate('28-05-2025'), '2025-05-28');
  assert.strictEqual(toIsoDate('2025-05-28'), '2025-05-28');
  assert.strictEqual(toIsoDate('15-08-2026'), '2026-08-15');
  // Normalizing rather than rejecting means every already-deployed client
  // is fixed too, including an installed app version we cannot update.
  assert.strictEqual(toIsoDate(''), '');
  assert.strictEqual(toIsoDate('sometime in May'), '');
  assert.strictEqual(toIsoDate(null), '');
});

test('a DD-MM-YYYY and its ISO spelling share one cache entry', () => {
  // They are the same night, so they must not be fetched or stored twice.
  const { toIsoDate, buildCacheKey } = bandSetlist;
  const a = buildCacheKey('elgoose', 'Goose', toIsoDate('28-05-2025'), '', 'goose');
  const b = buildCacheKey('elgoose', 'Goose', toIsoDate('2025-05-28'), '', 'goose');
  assert.strictEqual(a, b);
});

// ── The cache key ─────────────────────────────────────────────────────

test('the cache key carries a version, so an adapter fix is not served stale', () => {
  // A cached response is a snapshot of what the ADAPTER produced, so a
  // corrected field mapping changes the meaning of every stored entry.
  // Without the version in the key those entries keep being served for up
  // to 24 hours after the fix ships — which reads as "it works on some
  // shows and not others", since staleness depends on which dates someone
  // happened to ask for before the deploy.
  assert.strictEqual(typeof bandSetlist.CACHE_VERSION, 'number');
  assert.ok(bandSetlist.CACHE_VERSION >= 2, 'bumped when the adapters changed meaning');
});

test('the cache key separates two artists asking about the same date', () => {
  const goose = bandSetlist.buildCacheKey('elgoose', 'Goose', '2025-02-14', '', 'goose');
  const orebolo = bandSetlist.buildCacheKey('elgoose', 'Goose', '2025-02-14', '', 'orebolo');
  assert.notStrictEqual(goose, orebolo, 'the artist filter is part of what the response contains');
});

test('selectShow: one show on the date is unambiguous', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_RADIO_CITY);
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-10-24', venue: '' });
  assert.strictEqual(picked.ambiguous, false);
  assert.strictEqual(picked.venue, 'Ascend Amphitheater');
});

test('selectShow: two shows on a date disambiguate on venue and say so', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_TWO_SHOWS_ONE_DATE);
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: 'Bonnaroo' });
  assert.strictEqual(picked.ambiguous, true, 'must report the date was ambiguous even when it matched');
  assert.strictEqual(picked.venue, 'Bonnaroo');
  assert.deepStrictEqual(titles(picked.songs), ['Red Bird']);
  assert.match(picked.message, /matched on venue/i);
  assert.strictEqual(picked.candidates.length, 2);
});

test('selectShow: two shows and no venue is reported, not picked silently', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_TWO_SHOWS_ONE_DATE);
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: '' });
  assert.strictEqual(picked.ambiguous, true);
  assert.match(picked.message, /no venue was supplied/i);
  assert.strictEqual(picked.candidates.length, 2);
});

test('selectShow: a venue that matches nothing still reports the candidates', () => {
  const { shows } = mapAll(elgoose, fx.ELGOOSE_TWO_SHOWS_ONE_DATE);
  const picked = bandSetlist.selectShow(shows, { source: 'elgoose', date: '2024-06-22', venue: 'Red Rocks' });
  assert.strictEqual(picked.ambiguous, true);
  assert.match(picked.message, /none matched venue/i);
});

test('selectShow: no shows yields an empty setlist, not a throw', () => {
  const picked = bandSetlist.selectShow([], { source: 'elgoose', date: '1999-01-01', venue: '' });
  assert.deepStrictEqual(picked.songs, []);
  assert.match(picked.message, /No show on/);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
