/**
 * Unit tests for lib/bandSetlistMerge.js — the rules that let a setlist be
 * replaced from a band source without destroying anything the user put
 * there.
 *
 * This is the part of the band-source work most likely to go wrong and the
 * most expensive when it does: a user's ratings and hand-added songs live
 * inside the same array the source overwrites, and there is no undo. So the
 * cases below are deliberately about what must SURVIVE, not just about what
 * must change.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/bandSetlistMerge.test.js
 */

import assert from 'assert';
import { mergeBandSetlist, describeSummary, chooseCandidate, titleAliasesFor, MIN_CANDIDATE_OVERLAP, USER_OWNED_SONG_FIELDS } from '@/lib/bandSetlistMerge';
import { groupSongsBySet } from '@/lib/setlistGrouping';

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

// A stored song, the way setlist.fm's extractSongsFromSetlist writes one.
function stored(name, set, extra = {}) {
  return { id: `old-${name.toLowerCase().replace(/\s+/g, '-')}`, name, set, cover: null, tape: false, ...extra };
}

// An incoming song, the way an adapter produces one.
function incoming(name, set, extra = {}) {
  return { id: `new-${name.toLowerCase().replace(/\s+/g, '-')}`, name, set, cover: null, tape: false, ...extra };
}

const titles = (songs) => songs.map(s => s.name);
const byName = (songs, name) => songs.find(s => s.name === name);

// ── The rule that matters most: never blank a setlist ─────────────────

test('an empty incoming setlist writes nothing and reports why', () => {
  const existing = [stored('Hot Tea', 'Set I'), stored('Arrow', 'Set I')];
  const { setlist, changed, summary } = mergeBandSetlist(existing, []);

  assert.strictEqual(changed, false, 'changed:false is the caller\'s cue not to touch the document');
  assert.strictEqual(setlist, existing, 'the existing array is handed straight back');
  assert.strictEqual(summary.skipped, 'empty-incoming');
  assert.strictEqual(summary.existingCount, 2);
  assert.strictEqual(summary.resultCount, 2);
});

test('a null or undefined incoming setlist is treated as empty, not a crash', () => {
  const existing = [stored('Hot Tea', 'Set I')];
  assert.strictEqual(mergeBandSetlist(existing, null).changed, false);
  assert.strictEqual(mergeBandSetlist(existing, undefined).changed, false);
  assert.strictEqual(mergeBandSetlist(existing).changed, false);
});

test('a failed fetch on a show with no setlist still writes nothing', () => {
  const { setlist, changed } = mergeBandSetlist([], []);
  assert.strictEqual(changed, false);
  assert.deepStrictEqual(setlist, []);
});

test('an incoming setlist of nameless rows writes NOTHING', () => {
  // Defence in depth. The adapter drops untitled rows before this is
  // reachable, but if a future adapter ever emitted them, the ratings below
  // must still survive. Before this guard existed, they did not: the array
  // is non-empty so the empty-incoming rule did not fire, the titles all
  // normalized to '' so nothing matched, and the result was a setlist of
  // blank rows written over a good one.
  const existing = [
    stored('Hot Tea', 'Set I', { rating: 9 }),
    stored('Arrow', 'Set I', { comment: 'best version I have seen' }),
  ];
  const nameless = [incoming('', 'Set I'), { id: 'x', name: '   ', set: 'Set I' }];

  const { setlist, changed, summary } = mergeBandSetlist(existing, nameless);

  assert.strictEqual(changed, false, 'must not write');
  assert.strictEqual(setlist, existing);
  assert.strictEqual(summary.skipped, 'no-titled-songs');
  assert.strictEqual(setlist[0].rating, 9, 'the rating survives');
  assert.strictEqual(setlist[1].comment, 'best version I have seen');
  assert.match(describeSummary(summary), /field mapping is wrong/);
});

test('one titled song among nameless rows is still written', () => {
  // The guard must not be so blunt that a single bad row discards a real
  // setlist — it fires only when NOTHING in the incoming list has a title.
  const existing = [stored('Hot Tea', 'Set I', { rating: 9 })];
  const mixed = [incoming('Hot Tea', 'Set I'), incoming('', 'Set I')];
  const { changed, setlist } = mergeBandSetlist(existing, mixed);
  assert.strictEqual(changed, true);
  assert.strictEqual(setlist[0].rating, 9);
});

// ── Carrying over what the user authored ──────────────────────────────

test('a rating survives a re-fetch', () => {
  const existing = [stored('Hot Tea', 'Set I', { rating: 9 })];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);

  assert.strictEqual(setlist[0].rating, 9);
  assert.strictEqual(summary.carriedOver.rating, 1);
});

test('a per-song comment survives a re-fetch', () => {
  const existing = [stored('Arrow', 'Set I', { comment: 'best version I have seen' })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Arrow', 'Set I')]);
  assert.strictEqual(setlist[0].comment, 'best version I have seen');
});

test('every declared user-owned field survives, so the list is the contract', () => {
  const extras = { rating: 7, comment: 'note', manuallyAdded: true, tags: ['debut'] };
  const existing = [stored('Tumble', 'Set I', extras)];
  const { setlist } = mergeBandSetlist(existing, [incoming('Tumble', 'Set I')]);

  USER_OWNED_SONG_FIELDS.forEach((field) => {
    assert.deepStrictEqual(setlist[0][field], extras[field], `${field} must be carried over`);
  });
});

test('a rating of 0 is carried over — it is a rating, not an absence', () => {
  // The bug a truthy check would introduce: `if (old[field])` drops a 0.
  const existing = [stored('Madhuvan', 'Set I', { rating: 0 })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Madhuvan', 'Set I')]);
  assert.strictEqual(setlist[0].rating, 0);
});

test('the source cannot overwrite a rating with its own value', () => {
  const existing = [stored('Hot Tea', 'Set I', { rating: 9 })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I', { rating: 2 })]);
  assert.strictEqual(setlist[0].rating, 9, 'the user wins on user-owned fields');
});

test('a matched song keeps its EXISTING id, which is identity downstream', () => {
  // groupSongsBySet, songIndex's per-song set lookup, and the editor's
  // reorder and rating controls all address songs by id.
  const existing = [stored('Hot Tea', 'Set I', { rating: 5 })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);
  assert.strictEqual(setlist[0].id, 'old-hot-tea');
});

// ── Manually added songs ──────────────────────────────────────────────

test('a hand-added song the source does not have is KEPT, not deleted', () => {
  const existing = [
    stored('Hot Tea', 'Set I'),
    stored('A Song I Remember', 'Set I', { manuallyAdded: true, rating: 8 }),
  ];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);

  assert.ok(titles(setlist).includes('A Song I Remember'), 'a user\'s song is never deleted because the source disagrees');
  assert.deepStrictEqual(summary.keptManual, ['A Song I Remember']);
  assert.deepStrictEqual(summary.removed, [], 'a kept manual song is not counted as removed');
  assert.strictEqual(byName(setlist, 'A Song I Remember').rating, 8);
});

test('a kept manual song stays in the set the user put it in', () => {
  const existing = [
    stored('Hot Tea', 'Set I'),
    stored('Tumble', 'Set II'),
    stored('My Encore Memory', 'Encore', { manuallyAdded: true }),
    stored('Mid Set Two', 'Set II', { manuallyAdded: true }),
  ];
  const incomingSongs = [
    incoming('Hot Tea', 'Set I'),
    incoming('Tumble', 'Set II'),
    incoming('Time to Flee', 'Encore'),
  ];

  const { setlist } = mergeBandSetlist(existing, incomingSongs);

  // Grouped the way the app will render it, which is the thing that has to
  // be right — not the raw array order.
  const groups = groupSongsBySet(setlist);
  const setTwo = groups.find(g => g.label === 'Set II');
  const encore = groups.find(g => g.label === 'Encore');

  assert.ok(titles(setTwo.songs).includes('Mid Set Two'), 'must land in Set II');
  assert.ok(titles(encore.songs).includes('My Encore Memory'), 'must land in the Encore');
  // Appended to the end of its section rather than interleaved.
  assert.strictEqual(setTwo.songs[setTwo.songs.length - 1].name, 'Mid Set Two');
});

test('a manual song in a set the source does not list at all is still kept', () => {
  const existing = [
    stored('Hot Tea', 'Set I'),
    stored('Imagined Encore', 'Encore II', { manuallyAdded: true }),
  ];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);
  assert.ok(titles(setlist).includes('Imagined Encore'));
  const groups = groupSongsBySet(setlist);
  assert.ok(groups.some(g => g.label === 'Encore II'));
});

test('the manuallyAdded flag is re-stamped so the "added by you" badge survives', () => {
  const existing = [stored('Hot Tea', 'Set I'), stored('Mine', 'Set I', { manuallyAdded: true })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);
  assert.strictEqual(byName(setlist, 'Mine').manuallyAdded, true);
});

test('a song from a PREVIOUS source fetch that the source now omits is removed', () => {
  // The asymmetry is the point: user-authored songs are kept, stale source
  // data is not — otherwise a corrected setlist could never shrink.
  const existing = [stored('Hot Tea', 'Set I'), stored('Wrongly Listed', 'Set I')];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I')]);

  assert.deepStrictEqual(titles(setlist), ['Hot Tea']);
  assert.deepStrictEqual(summary.removed, ['Wrongly Listed']);
});

// ── Matching, and the diff summary it produces ────────────────────────

test('titles match through normalizeSongTitle, so punctuation and case differ freely', () => {
  const existing = [stored("Mike's Song", 'Set II', { rating: 10 })];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Mikes Song', 'Set II')]);

  assert.strictEqual(setlist.length, 1, 'must not double up the same song under two spellings');
  assert.strictEqual(setlist[0].rating, 10);
  assert.deepStrictEqual(summary.added, []);
});

test('a song moved within its set is reported as moved, keeping its rating', () => {
  const existing = [stored('A', 'Set I'), stored('B', 'Set I', { rating: 6 })];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('B', 'Set I'), incoming('A', 'Set I')]);

  assert.deepStrictEqual(titles(setlist), ['B', 'A']);
  assert.strictEqual(byName(setlist, 'B').rating, 6);

  // Both songs moved, so both are reported — a swap is two position
  // changes, not one, and the dry run should say so.
  assert.strictEqual(summary.movedPosition.length, 2);
  assert.deepStrictEqual(
    summary.movedPosition.map(m => [m.title, m.from, m.to]).sort(),
    [['A', 1, 2], ['B', 2, 1]]
  );
  assert.deepStrictEqual(summary.movedSet, [], 'neither left Set I');
});

test('a song moved to a different set is reported with from and to', () => {
  const existing = [stored('Tumble', 'Set I', { rating: 4 })];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Tumble', 'Set II')]);

  assert.strictEqual(setlist[0].set, 'Set II', 'the source decides the structure');
  assert.strictEqual(setlist[0].rating, 4, 'the user still keeps the rating');
  assert.deepStrictEqual(summary.movedSet, [{ title: 'Tumble', from: 'Set I', to: 'Set II' }]);
});

test('a song played twice in one show pairs up rather than collapsing', () => {
  const existing = [
    stored('Tweezer', 'Set II', { rating: 9 }),
    { ...stored('Tweezer', 'Encore'), id: 'old-tweezer-2', rating: 7 },
  ];
  const { setlist } = mergeBandSetlist(existing, [incoming('Tweezer', 'Set II'), incoming('Tweezer', 'Encore')]);

  assert.strictEqual(setlist.length, 2);
  assert.strictEqual(setlist[0].rating, 9);
  assert.strictEqual(setlist[1].rating, 7, 'each performance keeps its own rating');
});

test('a genuinely new song is reported as added', () => {
  const existing = [stored('Hot Tea', 'Set I')];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I'), incoming('Arrow', 'Set I')]);

  assert.deepStrictEqual(titles(setlist), ['Hot Tea', 'Arrow']);
  assert.deepStrictEqual(summary.added, ['Arrow']);
});

test('newly populated source fields are counted for the dry-run report', () => {
  const existing = [stored('Hot Tea', 'Set I')];
  const { summary } = mergeBandSetlist(existing, [
    incoming('Hot Tea', 'Set I', {
      transitionMark: '>', tape: true, footnote: 'teases', jamchart: true,
      jamchartNote: 'big one', sourceGap: 3, songId: 'x',
    }),
  ]);

  assert.strictEqual(summary.fieldsPopulated.transitionMark, 1);
  assert.strictEqual(summary.fieldsPopulated.footnote, 1);
  assert.strictEqual(summary.fieldsPopulated.jamchart, 1);
  assert.strictEqual(summary.fieldsPopulated.sourceGap, 1);
});

test('a field the show already had is not counted as newly populated', () => {
  const existing = [stored('Hot Tea', 'Set I', { footnote: 'already here' })];
  const { summary } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I', { footnote: 'updated' })]);
  assert.strictEqual(summary.fieldsPopulated.footnote, undefined);
});

test('the source refreshes its own fields even though it cannot touch the user\'s', () => {
  const existing = [stored('Hot Tea', 'Set I', { footnote: 'old note', rating: 8 })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I', { footnote: 'corrected note' })]);

  assert.strictEqual(setlist[0].footnote, 'corrected note', 'corrections are the reason to re-fetch');
  assert.strictEqual(setlist[0].rating, 8);
});

test('tape and transitionMark come from the source, replacing a stale segue', () => {
  const existing = [stored('Hot Tea', 'Set I', { tape: true })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Hot Tea', 'Set I', { tape: false })]);
  assert.strictEqual(setlist[0].tape, false);
});

test('a first fetch onto a show with no setlist adds everything', () => {
  const { setlist, changed, summary } = mergeBandSetlist([], [incoming('Hot Tea', 'Set I'), incoming('Arrow', 'Set I')]);
  assert.strictEqual(changed, true);
  assert.deepStrictEqual(titles(setlist), ['Hot Tea', 'Arrow']);
  assert.strictEqual(summary.added.length, 2);
  assert.strictEqual(summary.existingCount, 0);
  assert.strictEqual(summary.resultCount, 2);
});

test('a blank title never matches another blank title by accident', () => {
  // Both normalize to '', which findMatch refuses to treat as a key — so a
  // blank row can never silently absorb the rating of an unrelated song.
  // Exercised alongside a real song, because an incoming list of nothing
  // but blanks is refused outright by the no-titled-songs guard above and
  // would never reach the matching passes.
  const existing = [
    stored('Hot Tea', 'Set I', { rating: 9 }),
    stored('', 'Set I', { rating: 5 }),
  ];
  const { setlist, summary } = mergeBandSetlist(existing, [
    incoming('Hot Tea', 'Set I'),
    incoming('', 'Set I'),
  ]);

  assert.strictEqual(byName(setlist, 'Hot Tea').rating, 9, 'the real song keeps its rating');
  // The blank incoming row is new rather than matched, and the blank
  // existing row doesn't pair up with it. It carries a rating, so since
  // 5.47.7 it is kept, flagged notInSource, rather than dropped.
  assert.deepStrictEqual(summary.added, ['']);
  assert.deepStrictEqual(summary.removed, []);
  assert.deepStrictEqual(summary.keptNotInSource, ['']);
  const blanks = setlist.filter(s => s.name === '');
  assert.strictEqual(blanks.length, 2);
  assert.strictEqual(blanks.filter(s => s.rating === 5 && s.notInSource === true).length, 1, 'the rated blank is kept as itself');
  assert.strictEqual(blanks.filter(s => s.rating === undefined && !s.notInSource).length, 1, 'the incoming blank gained nothing');
});

// ── The summary rendering the dry run prints ──────────────────────────

test('describeSummary names the skip reason on an empty result', () => {
  const { summary } = mergeBandSetlist([stored('A', 'Set I')], []);
  assert.match(describeSummary(summary), /source returned no songs/);
});

test('describeSummary lists the counts a human needs to read a dry run', () => {
  const existing = [stored('A', 'Set I', { rating: 5 }), stored('Gone', 'Set I'), stored('Mine', 'Set I', { manuallyAdded: true })];
  const { summary } = mergeBandSetlist(existing, [incoming('A', 'Set I'), incoming('New', 'Set I', { footnote: 'x' })]);
  const line = describeSummary(summary);

  assert.match(line, /\+1 added/);
  assert.match(line, /-1 removed/);
  assert.match(line, /1 manual kept/);
  assert.match(line, /carried rating×1/);
  assert.match(line, /new footnote×1/);
});

test('describeSummary tolerates a missing summary', () => {
  assert.strictEqual(describeSummary(null), 'no summary');
});

// ── 5.47.7: never drop what the user rated or commented on ───────────

test('a rated song the source does not list is kept, flagged notInSource', () => {
  const existing = [
    stored('Arcadia', 'Set I'),
    stored('Madhuvan', 'Set I', { rating: 10, comment: 'the one' }),
    stored('Arrow', 'Set I', { rating: 9 }),
    stored('Hot Tea', 'Set I'),
  ];
  const { setlist, summary } = mergeBandSetlist(existing, [incoming('Arcadia', 'Set I'), incoming('Rockdale', 'Set I')]);
  assert.deepStrictEqual(summary.removed, ['Hot Tea'], 'only the unrated song goes');
  assert.deepStrictEqual(summary.keptNotInSource, ['Madhuvan', 'Arrow']);
  const madhuvan = byName(setlist, 'Madhuvan');
  assert.strictEqual(madhuvan.rating, 10);
  assert.strictEqual(madhuvan.comment, 'the one');
  assert.strictEqual(madhuvan.notInSource, true);
  assert.strictEqual(byName(setlist, 'Arrow').notInSource, true);
  assert.deepStrictEqual(titles(setlist), ['Arcadia', 'Rockdale', 'Madhuvan', 'Arrow'], 'kept at the end of their set');
});

test('a commented-only song is kept too; an empty comment does not count', () => {
  const existing = [stored('Arcadia', 'Set I'), stored('Tumble', 'Set I', { comment: 'opener?' }), stored('Atlas Dogs', 'Set I', { comment: '  ' })];
  const { summary } = mergeBandSetlist(existing, [incoming('Arcadia', 'Set I')]);
  assert.deepStrictEqual(summary.keptNotInSource, ['Tumble']);
  assert.deepStrictEqual(summary.removed, ['Atlas Dogs']);
});

test('a later re-sync that finds the song clears notInSource and keeps the rating', () => {
  const first = mergeBandSetlist([stored('Arcadia', 'Set I'), stored('Arrow', 'Set I', { rating: 9 })], [incoming('Arcadia', 'Set I')]).setlist;
  const { setlist, summary } = mergeBandSetlist(first, [incoming('Arcadia', 'Set I'), incoming('Arrow', 'Set I')]);
  const arrow = byName(setlist, 'Arrow');
  assert.strictEqual(arrow.rating, 9);
  assert.strictEqual(arrow.notInSource, undefined);
  assert.deepStrictEqual(summary.keptNotInSource, []);
});

test('a rated song in a set the source does not have keeps its set as a trailing group', () => {
  const existing = [stored('Arcadia', 'Set I'), stored('Echo of a Rose', 'Encore II', { rating: 8 })];
  const { setlist } = mergeBandSetlist(existing, [incoming('Arcadia', 'Set I')]);
  assert.deepStrictEqual(setlist.map(s => [s.name, s.set]), [['Arcadia', 'Set I'], ['Echo of a Rose', 'Encore II']]);
});

// ── 5.47.7: per-band title aliases ────────────────────────────────────

test('titleAliasesFor reads the band entry and ignores unknown bands', () => {
  assert.strictEqual(titleAliasesFor('goose').SOS, 'Same Old Shenanigans');
  assert.deepStrictEqual(titleAliasesFor('nobody'), {});
  assert.deepStrictEqual(titleAliasesFor('_comment'), {});
  assert.deepStrictEqual(titleAliasesFor(''), {});
});

test('an aliased rename carries the rating and comment and takes the source title', () => {
  const existing = [stored('SOS', 'Set I', { rating: 8, comment: 'huge' }), stored("Baby Don't You Do It", 'Encore', { rating: 9 })];
  const { setlist, summary } = mergeBandSetlist(
    existing,
    [incoming('Same Old Shenanigans', 'Set I'), incoming("Don't Do It", 'Encore')],
    { aliases: titleAliasesFor('goose') }
  );
  assert.deepStrictEqual(titles(setlist), ['Same Old Shenanigans', "Don't Do It"]);
  assert.strictEqual(byName(setlist, 'Same Old Shenanigans').rating, 8);
  assert.strictEqual(byName(setlist, 'Same Old Shenanigans').comment, 'huge');
  assert.strictEqual(byName(setlist, "Don't Do It").rating, 9);
  assert.strictEqual(byName(setlist, 'Same Old Shenanigans').id, 'old-sos', 'keeps the stored id');
  assert.deepStrictEqual(summary.aliased, [{ from: 'SOS', to: 'Same Old Shenanigans' }, { from: "Baby Don't You Do It", to: "Don't Do It" }]);
  assert.deepStrictEqual(summary.removed, []);
  assert.deepStrictEqual(summary.added, []);
});

test('without the alias map the rename is a removal (kept, since rated)', () => {
  const { summary } = mergeBandSetlist([stored('SOS', 'Set I', { rating: 8 })], [incoming('Same Old Shenanigans', 'Set I')]);
  assert.deepStrictEqual(summary.added, ['Same Old Shenanigans']);
  assert.deepStrictEqual(summary.keptNotInSource, ['SOS']);
});

test('aliases match on normalized titles and work in either direction of storage', () => {
  const { summary } = mergeBandSetlist([stored('s.o.s.', 'Set I', { rating: 7 })], [incoming('SAME OLD SHENANIGANS', 'Set I')], { aliases: { SOS: 'Same Old Shenanigans' } });
  assert.strictEqual(summary.aliased.length, 1);
  assert.strictEqual(summary.carriedOver.rating, 1);
});

// ── 5.47.7: two shows on one date ─────────────────────────────────────

const bottleRock = [
  { venue: 'Napa Valley Expo', sourceShowId: 'a', songs: ['Rockdale', 'Lead Up', 'California Magic', 'Hot Tea'].map(n => incoming(n, 'Set I')) },
  { venue: 'Napa Valley Expo', sourceShowId: 'b', songs: ['Hot Love & The Lazy Poet', 'Animal', 'Silver Rising', 'Your Direction', 'I Would Die 4 U', 'Hungersite', 'Slow Ready', 'Give It Time'].map(n => incoming(n, 'Set I')) },
];

test('the candidate sharing the most songs with the existing setlist wins', () => {
  const existing = ['Hot Love & The Lazy Poet', 'Animal', 'Silver Rising', 'Your Direction', 'I Would Die 4 U', 'Hungersite', 'Slow Ready', 'Give It Time'].map(n => stored(n, ''));
  const { setlist, summary, chosenCandidate, changed } = mergeBandSetlist(existing, bottleRock[0].songs, { candidates: bottleRock });
  assert.strictEqual(changed, true);
  assert.strictEqual(chosenCandidate.sourceShowId, 'b');
  assert.strictEqual(setlist.length, 8);
  assert.deepStrictEqual(summary.removed, []);
  assert.strictEqual(summary.candidates.reason, 'overlap');
  assert.deepStrictEqual(summary.candidates.scored.map(c => c.overlap), [0, 1]);
});

test('no existing setlist: skipped and reported, never guessed', () => {
  const { changed, setlist, summary } = mergeBandSetlist([], bottleRock[0].songs, { candidates: bottleRock });
  assert.strictEqual(changed, false);
  assert.deepStrictEqual(setlist, []);
  assert.strictEqual(summary.skipped, 'ambiguous-date');
  assert.strictEqual(summary.candidates.reason, 'no-existing-setlist');
  assert.match(describeSummary(summary), /more than one show/);
});

test('best overlap under the threshold: skipped', () => {
  const existing = ['Rockdale', 'Arcadia', 'Tumble', 'Atlas Dogs', 'Pancakes'].map(n => stored(n, 'Set I'));
  const { changed, summary } = mergeBandSetlist(existing, [], { candidates: bottleRock });
  assert.strictEqual(changed, false);
  assert.strictEqual(summary.candidates.reason, 'low-overlap');
  assert.strictEqual(MIN_CANDIDATE_OVERLAP, 0.5);
});

test('a tie: skipped', () => {
  const twins = [{ songs: [incoming('Arcadia', 'Set I')] }, { songs: [incoming('Arcadia', 'Set I')] }];
  const { changed, summary } = mergeBandSetlist([stored('Arcadia', 'Set I')], [], { candidates: twins });
  assert.strictEqual(changed, false);
  assert.strictEqual(summary.candidates.reason, 'tie');
});

test('hand-added songs do not count toward overlap', () => {
  const existing = [stored('Rockdale', 'Set I', { manuallyAdded: true })];
  assert.strictEqual(chooseCandidate(existing, bottleRock).reason, 'no-existing-setlist');
});

test('a single candidate is not a choice: the incoming setlist is used as before', () => {
  const { changed, chosenCandidate } = mergeBandSetlist([], bottleRock[0].songs, { candidates: [bottleRock[0]] });
  assert.strictEqual(changed, true);
  assert.strictEqual(chosenCandidate, null);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
