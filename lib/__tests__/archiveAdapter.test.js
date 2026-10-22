/**
 * Unit tests for the Internet Archive source (Grateful Dead) —
 * netlify/functions/lib/archiveAdapter.js, its registry entry, and the
 * auto-apply rule in lib/bandSetlist.js.
 *
 * No network. Every text below was copied from a real Archive item (the
 * identifier is named on each) while the adapter was built, including the
 * shapes it must REFUSE: the header-less comma list the most-downloaded
 * item usually carries, the search API's flattened line breaks, and info
 * files whose notes start with "Set 2 may be from…". Changing a rule in
 * the parser should break one of these, not a live lookup next month.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/archiveAdapter.test.js
 */

import assert from 'assert';
import { createRequire } from 'module';
import { resolveSource, SETLISTFM_SOURCE_ID } from '@/lib/setlistSources';
import { canAutoApply } from '@/lib/bandSetlist';

const require = createRequire(import.meta.url);
const archive = require('../../netlify/functions/lib/archiveAdapter.js');
const bandSetlist = require('../../netlify/functions/band-setlist.js');

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

const parse = (text, opts) => archive.parseSetlistText(text, opts);
const setNames = (parsed) => parsed.sets.map((s) => `${s.type}${s.number}`);
const titles = (parsed, i) => parsed.sets[i].songs.map((s) => s.name);

// ── Descriptions with set headers: the trusted format ─────────────────

// gd72-08-27.sbd.braverman.16582.sbefail.shnf
const VENETA = "Set I: Promised Land, Sugaree, Me & My Uncle, Deal, Black Throated Wind, China Cat Sunflower >I Know You Rider, Mexicali Blues, Bertha\nSet II: Playin' in the Band, He's Gone, Jack Straw, Bird Song, Greatest Story Ever Told\nSet III: Dark Star> El Paso, Sing Me Back Home, Sugar Magnolia, E1: Casey Jones, E2: Saturday Night";

test('inline set headers, three sets and two numbered encores', () => {
  const p = parse(VENETA);
  assert.strictEqual(p.explicit, true);
  assert.deepStrictEqual(setNames(p), ['set1', 'set2', 'set3', 'encore1', 'encore2']);
  assert.strictEqual(p.songCount, 20);
  assert.deepStrictEqual(titles(p, 3), ['Casey Jones']);
  // "Saturday Night" is the taper spelling; the alias keeps the song index whole.
  assert.deepStrictEqual(titles(p, 4), ['One More Saturday Night']);
});

test('segues keep their literal mark, and a comma is not a segue', () => {
  const p = parse(VENETA);
  const china = p.sets[0].songs.find((s) => s.name === 'China Cat Sunflower');
  assert.strictEqual(china.transition, '>');
  const sugaree = p.sets[0].songs.find((s) => s.name === 'Sugaree');
  assert.strictEqual(sugaree.transition, '');
});

// gd1969-02-27.132573.sbd.16track.healy-latvala-wise.flac16 (metadata copy)
const FILLMORE_69 = "Set 1\n\nGood Morning Little School Girl, Doin' That Rag, Cryptical Envelopment-> Drums-> The Other One-> Cryptical Envelopment\n\nSet 2\n\nDupree's Diamond Blues-> Mountains Of The Moon-> Dark Star-> Saint Stephen-> The Eleven-> Turn On Your Love Light, E: Cosmic Charlie\n\nOther artist(s): GD; Pentangle; Sir Douglas Quintet";

test('header lines, -> segues, an inline E:, and trailing notes cut off', () => {
  const p = parse(FILLMORE_69);
  assert.deepStrictEqual(setNames(p), ['set1', 'set2', 'encore1']);
  assert.strictEqual(p.sets[0].songs[2].transition, '->');
  assert.deepStrictEqual(titles(p, 2), ['Cosmic Charlie']);
});

test('the last song of the show never carries a segue', () => {
  const p = parse('Set 1\nDark Star ->\nSaint Stephen ->\nThe Eleven ->');
  assert.strictEqual(p.sets[0].songs.slice(-1)[0].transition, '');
});

// gd1967-01-14.sbd.vernon.9108.sbeok.shnf — the old Archive editor's HTML
const HTML_67 = '<div class="b1 set"><span>Set I</span><div class="set_info"><span title="Click to edit">Morning Dew, Viola Lee Blues, Good Morning Little School Girl*</span></div></div><div class="b1 set"><div class="set_info"><span> </span></div></div><div class="b2 set"><span>Comment</span><div>Human Be-In</div></div>';

test('HTML descriptions: header and songs separated, footnote mark dropped, Comment ends it', () => {
  const p = parse(HTML_67);
  assert.strictEqual(p.explicit, true);
  assert.deepStrictEqual(titles(p, 0), ['Morning Dew', 'Viola Lee Blues', 'Good Morning Little School Girl']);
});

// gd1977-05-08.111493.mtx.seamons.sbeok.flac16 (metadata copy)
const CORNELL = "Set 1\n\nMinglewood Blues, Loser, El Paso, They Love Each Other, Jack Straw, Deal, Lazy Lightning > Supplication, Brown Eyed Women, Mama Tried, Row Jimmy, Dancin' In The Streets\n\nSet 2\n\nScarlet Begonias > Fire On The Mountain, Estimated Prophet, Saint Stephen > Not Fade Away > Saint Stephen > Morning Dew \n\nE: One More Saturday Night\n\nCornell University";

test('a venue line after the setlist is not an encore song', () => {
  const p = parse(CORNELL, { ignore: ['Barton Hall', 'Ithaca, NY'] });
  assert.deepStrictEqual(setNames(p), ['set1', 'set2', 'encore1']);
  assert.deepStrictEqual(titles(p, 2), ['One More Saturday Night']);
  assert.strictEqual(p.songCount, 20);
});

test("a title's own comma survives: It's All Over Now, Baby Blue", () => {
  const p = parse("Set 1\nTouch Of Grey, Loser\nEncore: It's All Over Now, Baby Blue");
  assert.deepStrictEqual(titles(p, 1), ["It's All Over Now, Baby Blue"]);
});

test("a trailing apostrophe is part of the title (Smokestack Lightnin', Good Lovin')", () => {
  const p = parse("Set 2\nSmokestack Lightnin' ->\nGood Lovin'");
  assert.deepStrictEqual(titles(p, 0), ["Smokestack Lightnin'", "Good Lovin'"]);
});

// ── Shapes the parser must refuse ─────────────────────────────────────

// gd77-05-08.sbd.hicks.4982.sbeok.shnf — the most-downloaded Cornell item
const CORNELL_GENERATED = "Minglewood Blues, Loser, El Paso, They Love Each Other, Jack Straw, Deal, Lazy Lightning-> Supplication, Brown Eyed Women, Mama Tried, Row Jimmy, Dancin' In The Streets Scarlet Begonias-> Fire On The Mountain, Estimated Prophet, Saint Stephen-> Not Fade Away-> Saint Stephen-> Morning Dew, E: One More Saturday Night";

test('a header-less comma list (set break = missing comma) is never parsed', () => {
  const p = parse(CORNELL_GENERATED);
  assert.strictEqual(p.explicit, false);
  assert.strictEqual(p.songCount, 0);
});

test('the search API\'s flattened line breaks are refused, not guessed at', () => {
  // gd1985-06-24.mtx.seamons.94663.sbeok.flac16 as the search API returns it
  const p = parse('Set 1 Alabama Getaway -> Greatest Story Ever Told They Love Each Other New Minglewood Blues Tennessee Jed My Brother Esau Loser Let It Grow Set 2 Iko Iko -> Samson And Delilah');
  assert.strictEqual(p.explicit, false);
  assert.match(p.rejected, /several set headers/);
});

test('…but a flattened comma list is split back at its headers', () => {
  // gd1985-06-24.118986.BeyerM160.daweez.d5scott.flac16, search copy
  const p = parse("Set 1 Alabama Getaway-> Greatest Story Ever Told, They Love Each Other, Minglewood Blues, Tennessee Jed, My Brother Esau, Loser, Let It Grow Set 2 Iko Iko-> Samson & Delilah, He's Gone");
  assert.deepStrictEqual(setNames(p), ['set1', 'set2']);
  assert.strictEqual(titles(p, 0).slice(-1)[0], 'Let It Grow');
  assert.strictEqual(titles(p, 1)[0], 'Iko Iko');
});

test('a run-together line under one header is refused', () => {
  const p = parse("Set 1 Good Morning Little Schoolgirl Death Don't Have No Mercy Sitting On Top Of The World Dark Star Morning Dew Turn On Your Lovelight");
  assert.strictEqual(p.explicit, false);
});

test('an encore marker with no set header is not structure', () => {
  assert.strictEqual(parse('Touch Of Gray, Little Red Rooster, Lazy River Road\n\nE: Black Muddy River, Box Of Rain').explicit, false);
});

// ── Info files ────────────────────────────────────────────────────────

// gd77-05-08.sbd.hicks.4982.sbeok.shnf, gd1977-05-08.4982.txt (trimmed)
const CORNELL_TXT = `Lineage:

Betty Board Portion -- Master 7" Nagra reels 1/2 track @ 7.5ips>Sony PCM 501. Playback on Sony PCM 701>DAT (Digital Transfer)

Disk 1:

Set I

1. Minglewood Blues -> (AUD splice provides beginning of track)
2. Loser
3. El Paso
9. Mama Tried

Disk 2:

Set I (continued)

1. Row Jimmy
2. Dancin' In The Streets

Set II

3. Take A Step Back/Tuning
4. Scarlet Begonias-> Fire On The Mountain

Disk 3:

Set II (continued):

1. Estimated Prophet
2. Tuning/Dead Air
6. Morning Dew
7. Encore: Saturday Night




Culled from a May 6, 1999 post by Rob Eaton to dnc --

I recently re-decoded 5/5/77 and 5/8/77.`;

test('info file: preamble skipped, "continued" headers, taper notes and noise dropped', () => {
  const p = parse(CORNELL_TXT, { endOnProse: true });
  assert.deepStrictEqual(setNames(p), ['set1', 'set2', 'encore1']);
  assert.deepStrictEqual(titles(p, 0), ['Minglewood Blues', 'Loser', 'El Paso', 'Mama Tried', 'Row Jimmy', "Dancin' In The Streets"]);
  assert.deepStrictEqual(titles(p, 1), ['Scarlet Begonias', 'Fire On The Mountain', 'Estimated Prophet', 'Morning Dew']);
  assert.deepStrictEqual(titles(p, 2), ['One More Saturday Night']);
});

// gd1985-06-24.mtx.seamons.94663.sbeok.flac16, its .txt (trimmed)
const MATRIX_TXT = `Notes:
-- Set 2 may be from either a PCM Master or a VHS Master. The reason I say this is I could not find a tape flip and the recording is more dynamic than Set 1.
AUDs:

Set 1
-----

Nak 300 > D5 > CM > CDR

DAE and shorten encoding by C. Vinci

Set I
-----
d1t01 - Alabama Getaway ->
d1t02 - Greatest Story Ever Told
d1t03 - They Love Each Other

Set II
------
d2t01 - Iko Iko ->
d2t02 - Samson And Delilah`;

test('info file: a false start ("Set 2 may be…", a lineage section) is undone, not fatal', () => {
  const p = parse(MATRIX_TXT, { endOnProse: true });
  assert.deepStrictEqual(setNames(p), ['set1', 'set2']);
  assert.deepStrictEqual(titles(p, 0), ['Alabama Getaway', 'Greatest Story Ever Told', 'They Love Each Other']);
});

test('info file: times and footnote marks are stripped, "14:50.59" is not track 14', () => {
  const p = parse('Set 2:\n02.  Corrina > \t\t\t\t14:50.59\n03.  Drums > Space > \t\t\t27:08.20\n05.  Sugar Magnolia#\t\t\t09:43.02\n 6. [ 8:30.16] Sugar Magnolia $', { endOnProse: true });
  assert.deepStrictEqual(titles(p, 0), ['Corrina', 'Drums', 'Space', 'Sugar Magnolia', 'Sugar Magnolia']);
});

test('"Set III is with Merl Saunders…" is a sentence, not a header', () => {
  const p = parse('Notes:\nSet III is with Merl Saunders, Dickey Betts and Butch Trucks\n\nSet 1\nMorning Dew\nRamble On Rose\nJack Straw', { endOnProse: true });
  assert.deepStrictEqual(setNames(p), ['set1']);
});

test('band-member lines end the setlist', () => {
  const p = parse('Set 1\nTouch Of Grey\nLoser\nBertha\n\nJerry Garcia - Guitar\nBob Weir - Guitar');
  assert.deepStrictEqual(titles(p, 0), ['Touch Of Grey', 'Loser', 'Bertha']);
});

// ── Tapes ─────────────────────────────────────────────────────────────

test('one-set tapes are recognised as partial from their identifier', () => {
  assert.strictEqual(archive.isPartialItem({ identifier: 'gd1985-06-24.140890.s1.unkown.Bryant.Miller.Noel.t-flac2496' }), true);
  assert.strictEqual(archive.isPartialItem({ identifier: 'gd85-06-24.set2.oade-schoeps.sacks.24662.sbeok.flacf' }), true);
  assert.strictEqual(archive.isPartialItem({ identifier: 'gd1968-02-14.167923.2nd.set.fm.smith.miller.clugston.flac2496' }), true);
  assert.strictEqual(archive.isPartialItem({ identifier: 'gd68-09-20.sbd.partial.vernon.5930.sbeok.shnf' }), true);
  assert.strictEqual(archive.isPartialItem({ identifier: 'gd1977-05-08.mtx.seamons.97274.sbeok.flac16' }), false);
});

function candidate(identifier, text, extra = {}) {
  return { doc: { identifier, downloads: 0, ...extra }, parsed: parse(text), partial: archive.isPartialItem({ identifier }) };
}

test('ranking: two set-1-only tapes that agree do not beat a full show', () => {
  const full = 'Set 1\nAlabama Getaway\nLoser\nLet It Grow\nSet 2\nIko Iko\nWharf Rat\nGood Lovin\'\nEncore: U.S. Blues';
  const half = 'Set 1\nAlabama Getaway\nLoser\nLet It Grow';
  const ranked = archive.rankCandidates([
    candidate('a.half1', half),
    candidate('b.half2', half),
    candidate('c.full', full),
  ]);
  assert.strictEqual(ranked[0].doc.identifier, 'c.full');
});

test('ranking: the version most uploads agree on beats an outlier', () => {
  const common = 'Set 2\nScarlet Begonias >\nFire On The Mountain\nEstimated Prophet\nStanding On The Moon';
  const outlier = 'Set 2\nScarlet Begonias >\nFire On The Mountain >\nScarlet Begonias Reprise\nEstimated Prophet\nStanding On The Moon';
  const ranked = archive.rankCandidates([
    candidate('outlier', outlier, { downloads: 900000 }),
    candidate('one', common),
    candidate('two', common),
  ]);
  assert.notStrictEqual(ranked[0].doc.identifier, 'outlier');
});

test('track titles fall back to one lenient set', () => {
  const meta = {
    files: [
      { name: 'd1t01.flac', format: 'Flac', title: 'Tuning', track: '1' },
      { name: 'd1t02.flac', format: 'Flac', title: 'Morning Dew', track: '2' },
      { name: 'd1t03.flac', format: 'Flac', title: 'Viola Lee Blues', track: '3' },
      { name: 'd1t04.flac', format: 'Flac', title: 'A very long note from the taper about the reel flip and lineage here', track: '4' },
      { name: 'd1t02.mp3', format: 'VBR MP3', title: 'Morning Dew', track: '2' },
    ],
  };
  const p = archive.tracksFromMetadata(meta);
  assert.deepStrictEqual(titles(p, 0), ['Morning Dew', 'Viola Lee Blues']);
});

test('mapShow produces the shared song shape with Archive attribution', () => {
  const doc = { identifier: 'gd72-08-27.sbd.braverman.16582.sbefail.shnf', venue: 'Old Renaissance Faire Grounds', coverage: 'Veneta, OR' };
  const show = archive.mapShow(doc, parse(VENETA), { confidence: 'explicit-sets', parsedFrom: 'description', partial: false, itemCount: 7 });
  assert.strictEqual(show.source, 'archive');
  assert.strictEqual(show.sourcePermalink, 'https://archive.org/details/gd72-08-27.sbd.braverman.16582.sbefail.shnf');
  assert.strictEqual(show.city, 'Veneta');
  assert.strictEqual(show.state, 'OR');
  assert.deepStrictEqual([...new Set(show.songs.map((s) => s.set))], ['Set I', 'Set II', 'Set III', 'Encore', 'Encore II']);
  const china = show.songs.find((s) => s.name === 'China Cat Sunflower');
  assert.strictEqual(china.tape, true);
  assert.strictEqual(china.transitionMark, '>');
});

// ── band-setlist.js plumbing ──────────────────────────────────────────

test('selectShow carries the Archive fields and an early/late doubt', () => {
  const doc = { identifier: 'gd1970-02-13.x', venue: 'Fillmore East', coverage: 'New York, NY' };
  const show = archive.mapShow(doc, parse(VENETA), { confidence: 'explicit-sets', parsedFrom: 'description', partial: false, itemCount: 10 });
  show.ambiguousSlot = true;
  const picked = bandSetlist.selectShow([show], { source: 'archive', date: '1970-02-13', venue: '' });
  assert.strictEqual(picked.confidence, 'explicit-sets');
  assert.strictEqual(picked.parsedFrom, 'description');
  assert.strictEqual(picked.ambiguous, true);
  assert.match(picked.message, /early and late shows/i);
});

test('determineTtlHours takes a per-source ceiling', () => {
  assert.strictEqual(bandSetlist.determineTtlHours('1977-05-08', 720), 720);
  assert.strictEqual(bandSetlist.determineTtlHours('1977-05-08'), 24);
});

test('the search is scoped to the GratefulDead collection and one date', () => {
  const path = decodeURIComponent(archive.searchPath('1977-05-08').replace(/\+/g, ' '));
  assert.match(path, /collection:GratefulDead AND date:1977-05-08/);
  assert.match(path, /fl\[\]=description/);
});

// ── Registry and the auto-apply rule ──────────────────────────────────

test('Grateful Dead resolves to the Archive, by name and by mbid', () => {
  const byName = resolveSource('Grateful Dead');
  assert.strictEqual(byName.id, 'archive');
  assert.strictEqual(byName.requiresReview, true);
  assert.strictEqual(byName.sourceArtistFilter, 'GratefulDead');
  assert.strictEqual(resolveSource({ name: 'GD', mbid: '6faa7ca7-0d99-4a5e-bfa6-1fd5037520c6' }).id, 'archive');
});

test('the rest of the Dead family stays on setlist.fm', () => {
  ['Dead & Company', 'The Dead', 'Jerry Garcia Band', 'Phil Lesh & Friends', 'Bob Weir & Wolf Bros', 'Grateful Shred']
    .forEach((name) => assert.strictEqual(resolveSource(name).id, SETLISTFM_SOURCE_ID, `${name} must stay on setlist.fm`));
});

test('Goose and Phish are unchanged and need no review', () => {
  assert.strictEqual(resolveSource('Goose').id, 'elgoose');
  assert.strictEqual(resolveSource('Phish').id, 'phishnet');
  assert.strictEqual(resolveSource('Goose').requiresReview, false);
  assert.strictEqual(resolveSource('The Strokes').requiresReview, false);
});

test('canAutoApply: band archives always; the Archive only with explicit sets, complete, unambiguous', () => {
  assert.strictEqual(canAutoApply({ source: 'elgoose' }), true);
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: 'explicit-sets' }), true);
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: 'tracks-only' }), false);
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: 'explicit-sets', partial: true }), false);
  assert.strictEqual(canAutoApply({ source: 'archive', confidence: 'explicit-sets', ambiguous: true }), false);
  assert.strictEqual(canAutoApply({ source: 'archive' }), false);
  assert.strictEqual(canAutoApply(null), false);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
