/**
 * The Internet Archive for Live Music Archive bands (5.50.0) —
 * config/internet-archive.json `artists`, read by
 * netlify/functions/lib/archiveAdapter.js and resolved by
 * lib/setlistSources.js.
 *
 * No network. Each fixture under fixtures/internet-archive/<artistId>/ is
 * what archive.org sent the adapter for one date on 2026-10-29 (trimmed to
 * the fields the adapter reads), replayed through a stubbed https.request.
 * Five dates per band, the same five checked by hand against the tapes
 * when the band was added (docs/setlist-sources/internet-archive.md).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/archiveBands.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { resolveSource, archiveArtistFor, SETLISTFM_SOURCE_ID } from '@/lib/setlistSources';
import { mergeSourceSetlist, canAutoApply } from '@/lib/bandSetlist';

const require = createRequire(import.meta.url);
const https = require('https');
const archive = require('../../netlify/functions/lib/archiveAdapter.js');
const adminResync = require('../../netlify/functions/admin-resync-setlists.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'internet-archive');

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── Replaying archive.org ─────────────────────────────────────────────

let served = {};
let asked = [];
const realRequest = https.request;
function serve(responses) {
  served = responses;
  asked = [];
  https.request = (opts, ...rest) => {
    const cb = rest.find((x) => typeof x === 'function');
    const p = opts.path || opts.pathname;
    asked.push(p);
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.end = () => {
      const hit = served[p];
      const res = new EventEmitter();
      res.setEncoding = () => {};
      res.resume = () => {};
      res.statusCode = hit ? hit.status : 404;
      res.headers = {};
      process.nextTick(() => { cb(res); res.emit('data', hit ? hit.body : '{}'); res.emit('end'); });
    };
    return req;
  };
}
function restore() { https.request = realRequest; }

function fixture(artistId, date) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, artistId, `${date}.json`), 'utf8'));
}

async function lookup(artistId, date) {
  serve(fixture(artistId, date).responses);
  try {
    return await archive.fetchSetlists(date, { artistId });
  } finally { restore(); }
}

function setShape(songs) {
  const runs = [];
  songs.forEach((s) => {
    const last = runs[runs.length - 1];
    if (last && last[0] === s.set) last[1]++;
    else runs.push([s.set, 1]);
  });
  return runs.map((r) => r.join(':')).join(', ');
}

// ── Five dates per band, against the tape ─────────────────────────────
//
// [artistId, date, item read, confidence, partial, sets, first song, last song]

const EXPECTED = [
  ['keller-williams', '2002-09-08', 'kw2002-09-08.flac16.sbd', 'tracks-only', false, 'Set I:18, Encore:1', 'Instrumental', 'Freakshow'],
  ['keller-williams', '2003-07-03', 'kw2003-07-03.shnf', 'explicit-sets', false, 'Set I:21, Encore:1', 'Thin Mint', 'We Want the Funk'],
  ['keller-williams', '2003-07-04', 'kw2003-07-04.shnf', 'tracks-only', false, 'Set I:33', 'Molly Maloy', 'Redemption Song'],
  ['keller-williams', '2005-01-29', 'kw2005-01-29.flac', 'explicit-sets', false, 'Set I:16, Set II:14, Encore:1', 'Sheebs', 'Tumbleweed (Afroman)'],
  ['keller-williams', '2009-07-09', 'kw2009-07-09.U89i_24bit', 'tracks-only', false, 'Set I:17', 'Art', 'Best Feeling'],

  ['karl-densons-tiny-universe', '2001-04-11', 'kdtu2001-04-11.akg481', 'tracks-only', true, 'Set I:2, Encore:1', 'The Rump Winder', 'Tar Baby'],
  ['karl-densons-tiny-universe', '2003-10-25', 'kdtu2003-10-25.neumann.flac16', 'explicit-sets', true, 'Set I:6, Set II:7, Encore:1', 'How Fine Is That', "Walt's First Trip"],
  ['karl-densons-tiny-universe', '2009-03-26', 'kdtu2009-03-26.flac16.4ch', 'explicit-sets', false, 'Set I:8, Set II:8, Encore:1', 'Sister Janie', 'New York City'],
  ['karl-densons-tiny-universe', '2010-04-17', 'kdtu2010-04-17.skm140.flac16', 'explicit-sets', false, 'Set I:8, Set II:6, Encore:1', 'Funky Song', 'Mighty Mouse'],
  ['karl-densons-tiny-universe', '2018-10-31', 'kdtu2018-10-31', 'tracks-only', false, 'Set I:14', 'Game of Thrones Theme', 'Bitch'],

  ['tea-leaf-green', '2003-07-03', 'tlg2003-07-03.shnf', 'tracks-only', false, 'Set I:10', 'The Garden (Part I)', 'The Garden (Part II)'],
  ['tea-leaf-green', '2005-02-21', 'tlg2005-02-21.flac16', 'explicit-sets', false, 'Set I:9, Set II:15, Encore:1', 'Asphalt Funk', "Willin'"],
  ['tea-leaf-green', '2006-03-05', 'tlg2006-03-05.flac1644mk21', 'explicit-sets', false, 'Set I:12, Set II:11, Encore:1', 'Garden 1', 'TTBP'],
  ['tea-leaf-green', '2006-12-09', 'tlg2006-12-09.flac16', 'explicit-sets', false, 'Set I:10, Set II:10, Encore:3', 'Moonshine', "I've Got a Feeling"],
  ['tea-leaf-green', '2008-06-27', 'tlg2008-06-27.flac1644', 'explicit-sets', false, 'Set I:9, Set II:8, Encore:1', 'These Two Chairs', "I've Got a Truck"],

  ['galactic', '1999-06-25', 'galactic1999-06-25', 'tracks-only', true, 'Set I:13, Encore:1', 'Charlie Dozen', 'Cissy Strut'],
  ['galactic', '2001-04-03', 'galactic2001-04-03.akg481.flac1644', 'explicit-sets', true, 'Set I:9, Set II:11, Encore:3', 'Black Eyed Pea', 'Sweet Leaf'],
  ['galactic', '2005-11-18', 'galactic2005-11-18.akg-c1000.flac16', 'explicit-sets', false, 'Set I:11, Set II:9, Encore:2', 'Funkybird', "We're All Gonna Go"],
  ['galactic', '2007-06-08', 'galactic2007-06-08.mg210.flac16', 'tracks-only', false, 'Set I:18', 'Bongo the Dog', 'Black Eyed Pea'],
  ['galactic', '2010-02-23', 'galactic2010-02-23.aud.flac16.44', 'tracks-only', false, 'Set I:19', 'Who Took The Happiness', 'Two Clowns'],

  ['moe', '1996-08-24', 'moe1996-08-24.early.flac16', 'tracks-only', false, 'Set I:6', 'Defrost', 'Buster'],
  ['moe', '1997-06-22', 'moe.1997-06-22', 'tracks-only', false, 'Set I:5', 'Timmy Tucker', 'Spine of A Dog'],
  ['moe', '1998-07-10', 'moe1998-07-10.flac16', 'explicit-sets', false, 'Set I:6, Set II:8, Encore:2', 'Brent Black', 'Blister In The Sun'],
  ['moe', '1999-08-05', 'moe1999-08-05.shnf', 'tracks-only', false, 'Set I:6', 'Stranger Than Fiction', 'Spaz Medicine'],
  ['moe', '1999-08-21', 'moe1999-08-21.flac16', 'tracks-only', false, 'Set I:5', 'Plane Crash', 'Recreational Chemistry'],
];

for (const [artistId, date, item, confidence, partial, sets, first, last] of EXPECTED) {
  test(`${artistId} ${date}: ${item}`, async () => {
    const r = await lookup(artistId, date);
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.shows.length, 1);
    const show = r.shows[0];
    assert.strictEqual(show.source, 'archive');
    assert.strictEqual(show.sourceShowId, item);
    // The credit links the tape the setlist was read from.
    assert.strictEqual(show.sourcePermalink, `https://archive.org/details/${item}`);
    assert.strictEqual(show.confidence, confidence);
    assert.strictEqual(show.partial, partial);
    assert.strictEqual(setShape(show.songs), sets);
    assert.strictEqual(show.songs[0].name, first);
    assert.strictEqual(show.songs[show.songs.length - 1].name, last);
    // The search named the band's creator, and the only file downloaded was
    // an info .txt: no audio.
    assert.match(decodeURIComponent(asked[0].replace(/\+/g, ' ')), /creator:"/);
    asked.filter((p) => p.startsWith('/download/')).forEach((p) => assert.match(p, /\.txt$/i, p));
  });
}

test('the tapes the bands were added for: tape setlists for the dates users logged', async () => {
  // Shows in production with no setlist on 2026-10-29.
  const kw = await lookup('keller-williams', '2003-07-03');
  assert.ok(kw.shows[0].songs.some((s) => s.name === 'Standing on the Moon'));
  const tlg = await lookup('tea-leaf-green', '2003-07-03');
  assert.ok(tlg.shows[0].songs.some((s) => s.name === 'Gasaholic'));
});

test('segues on a track list keep their marks; the last song has none', async () => {
  const r = await lookup('keller-williams', '2003-07-04');
  const songs = r.shows[0].songs;
  assert.strictEqual(songs.find((s) => s.name === 'Molly Maloy').transitionMark, '>');
  assert.strictEqual(songs[songs.length - 1].transitionMark || '', '');
});

test('a soundboard tape is read before a more-downloaded audience tape', async () => {
  const r = await lookup('keller-williams', '2003-07-04');
  assert.strictEqual(r.shows[0].sourceType, 'sbd');
});

// ── Picking the band's tapes and nobody else's ────────────────────────

test('only items whose creator is exactly the band are read', () => {
  const kw = archive.artistFor('keller-williams');
  assert.ok(archive.isBandItem({ creator: 'Keller Williams' }, kw));
  assert.ok(archive.isBandItem({ creator: ['Keller Williams', 'The Keels'] }, kw));
  assert.ok(!archive.isBandItem({ creator: 'Keller Williams Incident' }, kw));
  assert.ok(!archive.isBandItem({ creator: 'Rosebud (Jerry Garcia Band Tribute)' }, { creators: ['Jerry Garcia Band'] }));
  // Grateful Dead reads its whole collection.
  assert.ok(archive.isBandItem({ creator: 'anything' }, archive.artistFor('GratefulDead')));
});

test('a Live Music Archive band is searched in etree by creator; Grateful Dead by collection', () => {
  assert.strictEqual(archive.searchQuery('2003-07-04', archive.artistFor('keller-williams')),
    'collection:etree AND (creator:"Keller Williams") AND date:2003-07-04');
  assert.strictEqual(archive.searchQuery('1977-05-08', archive.artistFor('GratefulDead')),
    'collection:GratefulDead AND date:1977-05-08');
});

test('an artistId the config does not list gets no request', async () => {
  serve({});
  try {
    const r = await archive.fetchSetlists('2003-07-04', { artistId: 'ozomatli' });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.shows, []);
    assert.strictEqual(asked.length, 0);
  } finally { restore(); }
});

// ── The registry ──────────────────────────────────────────────────────

test('each added band resolves to the Archive with its own artistId', () => {
  const cases = [
    ['Keller Williams', 'keller-williams'],
    ['Karl Denson’s Tiny Universe', 'karl-densons-tiny-universe'], // as stored, curly apostrophe
    ["Karl Denson's Tiny Universe", 'karl-densons-tiny-universe'],
    ['Tea Leaf Green', 'tea-leaf-green'],
    ['Galactic', 'galactic'],
    ['moe.', 'moe'],
    ['Grateful Dead', 'GratefulDead'],
  ];
  for (const [name, artistId] of cases) {
    const r = resolveSource(name);
    assert.strictEqual(r.id, 'archive', name);
    assert.strictEqual(r.sourceArtistFilter, artistId, name);
    assert.strictEqual(r.requiresReview, true, name);
  }
});

test('bands not in the config stay on setlist.fm, untouched', () => {
  ['Widespread Panic', 'Dark Star Orchestra', 'Ozomatli', 'Soulive', 'Melvin Seals & JGB', 'Karl Denson', 'Keller Williams Incident', 'Phil Lesh & Friends']
    .forEach((name) => assert.strictEqual(resolveSource(name).id, SETLISTFM_SOURCE_ID, name));
});

test('the admin re-sync resolves the same bands, each with its artistId', () => {
  const kw = adminResync.resolveBandSource('Keller Williams', adminResync.bandSourceNameKeys(true));
  assert.strictEqual(kw.source, 'archive');
  assert.strictEqual(kw.artistId, 'keller-williams');
  assert.strictEqual(adminResync.resolveBandSource('Keller Williams', adminResync.bandSourceNameKeys(false)), null);
  assert.strictEqual(adminResync.resolveBandSource('Widespread Panic', adminResync.bandSourceNameKeys(true)), null);
});

test('protected titles and title aliases are per band', () => {
  assert.deepStrictEqual(archiveArtistFor('grateful-dead').protectedGroup, ['Drums', 'Space', 'Jam']);
  assert.strictEqual(archiveArtistFor('keller-williams').protectedGroup, undefined);
  // "Saturday Night" is One More Saturday Night only at a Dead show.
  assert.strictEqual(archive.cleanTitle('Saturday Night'), 'One More Saturday Night');
  assert.strictEqual(archive.cleanTitle('Saturday Night', {}), 'Saturday Night');
});

// ── Merge rules ───────────────────────────────────────────────────────

test('a refresh keeps the user\'s ratings, notes and added songs', async () => {
  const r = await lookup('tea-leaf-green', '2008-06-27');
  const show = r.shows[0];
  const existing = [
    { id: 'a', name: 'These Two Chairs', set: 'Set I', rating: 9, comment: 'opener!' },
    { id: 'b', name: 'Reservoir', set: 'Set II', rating: 7 },
    { id: 'c', name: 'A song I added myself', set: 'Set II', rating: 8 },
  ];
  const merged = mergeSourceSetlist(existing, { source: 'archive', bandKey: 'tea-leaf-green', songs: show.songs, confidence: show.confidence });
  const byName = Object.fromEntries(merged.setlist.map((s) => [s.name, s]));
  assert.strictEqual(byName['These Two Chairs'].rating, 9);
  assert.strictEqual(byName['These Two Chairs'].comment, 'opener!');
  assert.strictEqual(byName.Reservoir.rating, 7);
  assert.ok(byName['A song I added myself'], 'a rated song the tape lacks is kept');
});

test('a partial or track-list tape is never written without the user seeing it', async () => {
  const tracks = (await lookup('keller-williams', '2003-07-04')).shows[0];
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: tracks.confidence, partial: tracks.partial }), false);
  const gappy = (await lookup('karl-densons-tiny-universe', '2003-10-25')).shows[0];
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: gappy.confidence, partial: gappy.partial }), false);
});

// ── Title cleaning, each on the text that needed it ───────────────────

const names = (p) => p.sets.flatMap((s) => s.songs.map((x) => x.name));
const shape = (p) => p.sets.map((s) => `${s.type}${s.number}:${s.songs.length}`).join(' ');

test('tuning, banter, crowd, "tmp", fades, bracketed talk and file numbering are not songs', () => {
  const p = archive.tracksFromMetadata({ files: [
    'd1t01 Tuning', 'Crowd-Tuning', 'Molly Maloy >', 'tmp', '[this song is for your birthday then]',
    'crowd noise...', 'fade in (samba procession)', 'Stage Banter', '05. Freekshow', 'Keller Thanks',
  ].map((title, i) => ({ name: `t${i}.flac`, format: 'Flac', title, track: String(i + 1) })) }, { aliases: {} });
  assert.deepStrictEqual(names(p), ['Molly Maloy', 'Freekshow']);
});

test('a track list\'s own "set break" and "encore break" tracks become breaks', () => {
  const lines = archive.trackLines(['Shakedown', 'set break', 'Scarlet >', 'Fire', 'encore break', 'Sugar Magnolia']);
  assert.deepStrictEqual(lines, ['Shakedown', 'Set 2', 'Scarlet >', 'Fire', 'Encore', 'Sugar Magnolia']);
  const p = archive.tracksFromMetadata({ files: ['Shakedown', 'Setbreak', 'Scarlet >', 'Fire', 'encore break', 'Sugar Magnolia']
    .map((title, i) => ({ name: `t${i}.flac`, format: 'Flac', title, track: String(i + 1) })) }, { aliases: {} });
  assert.strictEqual(shape(p), 'set1:1 set2:2 encore1:1');
});

test('with no break marked, a track list stays one set', () => {
  const p = archive.tracksFromMetadata({ files: ['Art', 'Yoni', 'Freeker', 'Breathe']
    .map((title, i) => ({ name: `t${i}.flac`, format: 'Flac', title, track: String(i + 1) })) }, { aliases: {} });
  assert.strictEqual(shape(p), 'set1:4');
});

test('"untitled", "?" and nameless files are gaps, so the list is never complete', () => {
  const p = archive.tracksFromMetadata({ files: [
    { name: 't1.flac', format: 'Flac', title: 'Charlie Dozen', track: '1' },
    { name: 't2.flac', format: 'Flac', title: 'untitled', track: '2' },
    { name: 't3.flac', format: 'Flac', title: 'Thrill', track: '3' },
    { name: 't4.flac', format: 'Flac', title: 'Doublewide', track: '4' },
    { name: 't5.flac', format: 'Flac', track: '5' },
  ] }, { aliases: {} });
  assert.deepStrictEqual(names(p), ['Charlie Dozen', 'Thrill', 'Doublewide']);
  assert.strictEqual(p.gaps, 2);
});

test('the same few labels on every track are not a setlist', () => {
  const titles = [];
  for (let i = 0; i < 4; i++) titles.push('Ozomatli', 'The Crown Room', 'Crystal Bay Club', 'Crystal Bay NV');
  const p = archive.tracksFromMetadata({ files: titles.map((title, i) => ({ name: `t${i}.flac`, format: 'Flac', title, track: String(i + 1) })) }, { aliases: {} });
  assert.strictEqual(p.songCount, 0);
});

test('"I:" and "E:" are set and encore headers', () => {
  const p = archive.parseSetlistText('I: Thin Mint>\nPeople Watching,\nNight Fever>\nRockumal\nE: We Want the Funk', { aliases: {} });
  assert.strictEqual(p.explicit, true);
  assert.strictEqual(shape(p), 'set1:4 encore1:1');
});

test('songs under "Disc 1" before a "(set II)" header are Set I', () => {
  const p = archive.parseSetlistText("Disc 1\n\n01) Asphalt Funk\n02) Reservoir\n03) Rapture\n\nDisc 2\n\n(set II)\n01) Baseball Jam\n02) Georgie P\n(encore)\n03) Willin'**", { aliases: {} });
  assert.strictEqual(shape(p), 'set1:3 set2:2 encore1:1');
  assert.strictEqual(p.sets[2].songs[0].name, "Willin'");
});

test('without a later Set 2 header, a Disc 1 block is still preamble', () => {
  const p = archive.parseSetlistText('Disc 1\n01) Asphalt Funk\n02) Reservoir\n\nSet 1\n01) Rapture\n02) Biscuits\n03) Freedom', { aliases: {} });
  assert.deepStrictEqual(names(p), ['Rapture', 'Biscuits', 'Freedom']);
});

test('numbered tracks with no title are gaps', () => {
  const p = archive.parseSetlistText('Set 1:\n1)  How Fine Is That\n2)  New York City\n3)  \n4)  Satisfied', { aliases: {} });
  assert.deepStrictEqual(names(p), ['How Fine Is That', 'New York City', 'Satisfied']);
  assert.strictEqual(p.gaps, 1);
});

test('notes about a set are not songs', () => {
  const p = archive.parseSetlistText('Set One\n4. (12:47) The Rump Winder\n\nKarl Denson and Chris Wood tweener set\n1. ( 5:13) Intro', { aliases: {} });
  assert.ok(!names(p).some((n) => /tweener/.test(n)));
});

test('someone thanking the crowd does not end the setlist', () => {
  const p = archive.parseSetlistText('Set 1:\nSheebs\nBreathe>\nGolden Years\n\nE:\nKeller says thanks\nTumbleweed', { endOnProse: true, aliases: {} });
  assert.strictEqual(shape(p), 'set1:3 encore1:1');
});

test('the band\'s name after a setlist ends it, and the lineup is not read', () => {
  const p = archive.parseSetlistText('Set 1\n01 Black Eyed Pea\n02 Shucktime\n03 Funky Bird\n\n - Galactic - \nBen Ellman\nStanton Moore', { endOnProse: true, aliases: {}, band: 'Galactic' });
  assert.deepStrictEqual(names(p), ['Black Eyed Pea', 'Shucktime', 'Funky Bird']);
});

test('band-member and photo-credit lines end a description', () => {
  const p = archive.parseSetlistText('Set 1\nStruggling Man\nEvangeline\nDeal\n\nBand:\nMelvin Seals Organ\n\nCover Photo Credit:\nSomeone', { aliases: {} });
  assert.deepStrictEqual(names(p), ['Struggling Man', 'Evangeline', 'Deal']);
});

test('footnote notes, cover credits and lost characters come off the title', () => {
  assert.strictEqual(archive.cleanTitle('Big River* (White Strat)', {}), 'Big River');
  assert.strictEqual(archive.cleanTitle('Miss You [The Rolling Stones]', {}), 'Miss You');
  assert.strictEqual(archive.cleanTitle('Baker�s Dozen^', {}), "Baker's Dozen");
  assert.strictEqual(archive.cleanTitle('�Pleas', {}), 'Pleas');
  assert.strictEqual(archive.cleanTitle('No Woman, No Cry', {}), 'No Woman, No Cry');
  // A parenthetical that is part of the title stays.
  assert.strictEqual(archive.cleanTitle("(Don't Worry) If There's a Hell Below", {}), "(Don't Worry) If There's a Hell Below");
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

console.log(`\narchiveBands: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
