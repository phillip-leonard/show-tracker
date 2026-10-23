// lib/bandSetlistMerge.js
//
// Replacing a setlist from a band source without ever destroying what the
// user put there. This is the ESM half; the CommonJS half lives at
// netlify/functions/lib/bandSetlistMergeRule.js for the admin backfill, and
// lib/__tests__/bandSetlistMergeParity.test.js asserts the two agree on
// every case so they cannot drift silently. Same arrangement
// lib/festivalMatch.js and netlify/functions/lib/festivalMatchRule.js use,
// and for the same reason: a Netlify function is CommonJS with no build
// step to resolve the `@/lib` alias.
//
// ── The invariant ─────────────────────────────────────────────────────
//
// A show's setlist array is not purely source data. The user owns part of
// it: per-song `rating` and `comment`, songs they added by hand that the
// source has never heard of, and set/order edits from the setlist editor.
// A re-fetch that discarded any of that would be worse than not re-fetching
// at all, because the user would have no way to know it happened and no way
// to get it back.
//
// So the merge is conservative in one specific direction: the incoming
// setlist decides what songs were played and in what structure, and the
// existing setlist decides everything the user authored about them. And
// when the incoming setlist is empty or the fetch failed, the existing
// setlist wins outright — nothing is written. A failed fetch must never
// blank a setlist, which is also what makes the name-match heuristic in
// lib/setlistSources.js survivable: ask elgoose.net for a Dutch-Goose date
// and it returns nothing, and nothing is what gets written.
//
// ── Matching ──────────────────────────────────────────────────────────
//
// Existing songs are matched to incoming songs on normalized title (the
// app's one and only normalizeSongTitle), in three passes from most to
// least specific:
//
//   1. title + set + position  – unchanged, the common case
//   2. title + set             – moved within its set
//   3. title                   – moved to a different set
//
// Each existing song is consumed at most once, so a show that plays the
// same song twice pairs them up in order rather than collapsing them. Which
// pass matched is what produces the "moved" counts in the diff summary —
// the Change 4 dry run's output is built from exactly this.

import { normalizeSongTitle } from '@/lib/utils';
import songTitleAliases from '@/config/song-title-aliases.json';

// Per-song fields the USER owns. These are carried from the existing song
// onto its incoming replacement; nothing the source says can overwrite
// them. `manuallyAdded` is here because a song the user added by hand stays
// flagged as theirs even in the unlikely event the source later agrees it
// was played.
export const USER_OWNED_SONG_FIELDS = ['rating', 'comment', 'manuallyAdded', 'tags'];

// Fields a band source populates. Used only for the diff summary's "fields
// newly populated" line — the merge itself takes whatever the adapter
// produced.
export const SOURCE_SONG_FIELDS = [
  'transitionMark', 'footnote', 'jamchart', 'jamchartNote',
  'sourceGap', 'debut', 'songId', 'songSlug', 'sourceOpener',
];

// ── Title aliases ─────────────────────────────────────────────────────
//
// A band's archive and setlist.fm can spell one song two ways: El Goose has
// "Same Old Shenanigans" where setlist.fm has "SOS". Matched on normalized
// title alone, a rename reads as one song removed and another added, and a
// rating on it would leave with the removal. config/song-title-aliases.json
// maps one spelling onto the other per band; both sides of the merge key
// off the mapped title, so the rating comes across with the rename.

/** The alias map for one band, by artist name key ('goose'). {} if none. */
export function titleAliasesFor(bandKey) {
  const entry = bandKey ? songTitleAliases[bandKey] : null;
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
}

function aliasIndex(aliases) {
  const index = new Map();
  Object.entries(aliases || {}).forEach(([from, to]) => {
    const f = normalizeSongTitle(from);
    const t = normalizeSongTitle(to);
    if (f && t && f !== t) index.set(f, t);
  });
  return index;
}

function titleKey(index, name) {
  const key = normalizeSongTitle(name);
  return index.get(key) || key;
}

// A song the user has said something about. Never dropped by a re-sync:
// see the leftovers block in mergeBandSetlist.
function hasUserNotes(song) {
  return song.rating != null || (typeof song.comment === 'string' ? song.comment.trim() !== '' : song.comment != null);
}

function positionsWithinSets(songs, index = new Map()) {
  // Position within a set, derived rather than read off the song, because a
  // stored song carries no position field — groupSongsBySet infers
  // structure from the `set` label and array order, and so does this.
  const counters = new Map();
  return songs.map((song) => {
    const set = song.set || '';
    const next = (counters.get(set) || 0) + 1;
    counters.set(set, next);
    return { song, set, position: next, key: titleKey(index, song.name) };
  });
}

// ── Two shows on one date ─────────────────────────────────────────────
//
// A festival day can have two Goose sets at one venue (BottleRock 2025:
// four songs and eight, both "Napa Valley Expo"), and a venue name cannot
// tell them apart. band-setlist.js then returns them all as `contested`,
// and the existing setlist decides: the candidate sharing the most songs
// with it wins. With no existing setlist, a tie, or a best overlap under
// MIN_CANDIDATE_OVERLAP, there is no evidence either way, and the show is
// skipped and reported rather than given a guess.
export const MIN_CANDIDATE_OVERLAP = 0.5;

// Share of the existing setlist's source songs (hand-added ones don't
// count; the source never has them) that appear in `songs`. Each existing
// song can match once, so a reprise isn't counted twice.
function overlapShare(existing, songs, index) {
  const available = new Map();
  songs.forEach((s) => {
    const k = titleKey(index, s?.name);
    if (k) available.set(k, (available.get(k) || 0) + 1);
  });
  const keys = existing.filter((s) => s && !s.manuallyAdded).map((s) => titleKey(index, s.name)).filter(Boolean);
  if (keys.length === 0) return 0;
  let hits = 0;
  keys.forEach((k) => {
    const n = available.get(k) || 0;
    if (n > 0) { hits++; available.set(k, n - 1); }
  });
  return hits / keys.length;
}

/**
 * chooseCandidate(existingSetlist, candidates, { aliases, minOverlap })
 *   -> { chosen: index | null, reason, scored: [{ index, venue, songCount, overlap }] }
 *
 * reason: 'overlap' (chosen), or why nothing was: 'no-existing-setlist',
 * 'low-overlap', 'tie'.
 */
export function chooseCandidate(existingSetlist, candidates, { aliases = {}, minOverlap = MIN_CANDIDATE_OVERLAP } = {}) {
  const existing = Array.isArray(existingSetlist) ? existingSetlist : [];
  const index = aliasIndex(aliases);
  const scored = (candidates || []).map((c, i) => ({
    index: i,
    venue: c?.venue || '',
    songCount: Array.isArray(c?.songs) ? c.songs.length : 0,
    overlap: Math.round(overlapShare(existing, Array.isArray(c?.songs) ? c.songs : [], index) * 100) / 100,
  }));
  const hasExisting = existing.some((s) => s && !s.manuallyAdded && normalizeSongTitle(s.name));
  if (!hasExisting) return { chosen: null, reason: 'no-existing-setlist', scored };
  const ranked = [...scored].sort((a, b) => b.overlap - a.overlap);
  const [best, second] = ranked;
  if (!best || best.overlap < minOverlap) return { chosen: null, reason: 'low-overlap', scored };
  if (second && second.overlap === best.overlap) return { chosen: null, reason: 'tie', scored };
  return { chosen: best.index, reason: 'overlap', scored };
}

/**
 * mergeBandSetlist(existingSetlist, incomingSongs) -> {
 *   setlist, changed, summary
 * }
 *
 * `setlist` is the array to write. `changed` is false when there is nothing
 * worth writing — which happens when the incoming setlist is empty, and is
 * the caller's cue to leave the document alone entirely.
 *
 * `summary` is the per-show change report; see the CJS twin's docblock for
 * its full shape.
 */
export function mergeBandSetlist(existingSetlist, incomingSongs, options = {}) {
  const existing = Array.isArray(existingSetlist) ? existingSetlist : [];
  let incoming = Array.isArray(incomingSongs) ? incomingSongs : [];
  const index = aliasIndex(options.aliases);

  const emptySummary = () => ({
    existingCount: existing.length,
    incomingCount: incoming.length,
    resultCount: existing.length,
    added: [],
    removed: [],
    movedSet: [],
    movedPosition: [],
    fieldsPopulated: {},
    carriedOver: {},
    keptManual: [],
    keptNotInSource: [],
    aliased: [],
    candidates: null,
    skipped: null,
  });

  // Rule 0: when the source had more than one show this date could be (see
  // chooseCandidate), the existing setlist picks one, or nothing is written.
  let chosenCandidate = null;
  let candidateReport = null;
  if (Array.isArray(options.candidates) && options.candidates.length > 1) {
    const pick = chooseCandidate(existing, options.candidates, options);
    candidateReport = { reason: pick.reason, chosen: pick.chosen, scored: pick.scored };
    if (pick.chosen == null) {
      const summary = emptySummary();
      summary.skipped = 'ambiguous-date';
      summary.candidates = candidateReport;
      return { setlist: existing, changed: false, summary, chosenCandidate: null };
    }
    chosenCandidate = options.candidates[pick.chosen];
    incoming = Array.isArray(chosenCandidate.songs) ? chosenCandidate.songs : [];
  }

  // Rule 1, and the one that matters most: an empty incoming setlist writes
  // nothing. The caller treats `changed: false` as "do not touch the
  // document", so a source with no data for this date, a bad date, or an
  // artist-name false positive all come out the same safe way.
  if (incoming.length === 0) {
    const summary = emptySummary();
    summary.skipped = 'empty-incoming';
    return { setlist: existing, changed: false, summary };
  }

  // Defence in depth against the same mis-transcribed-key failure
  // netlify/functions/lib/bandSetlistShape.js drops untitled rows for. That
  // drop is the real fix and makes this unreachable today; this is here so a
  // future adapter that builds its songs some other way still cannot write a
  // setlist of nameless rows over a good one. An incoming list with no
  // usable title in it is no better than an empty one, and is treated the
  // same: write nothing.
  if (!incoming.some((song) => normalizeSongTitle(song?.name).length > 0)) {
    const summary = emptySummary();
    summary.skipped = 'no-titled-songs';
    return { setlist: existing, changed: false, summary };
  }

  const existingIndexed = positionsWithinSets(existing, index);
  const incomingIndexed = positionsWithinSets(incoming, index);

  const consumed = new Set();
  const summary = emptySummary();
  summary.candidates = candidateReport;

  const findMatch = (target) => {
    // Pass 1: same title, same set, same position.
    for (let i = 0; i < existingIndexed.length; i++) {
      if (consumed.has(i)) continue;
      const e = existingIndexed[i];
      if (e.key && e.key === target.key && e.set === target.set && e.position === target.position) {
        return { index: i, entry: e, kind: 'exact' };
      }
    }
    // Pass 2: same title, same set, different position.
    for (let i = 0; i < existingIndexed.length; i++) {
      if (consumed.has(i)) continue;
      const e = existingIndexed[i];
      if (e.key && e.key === target.key && e.set === target.set) {
        return { index: i, entry: e, kind: 'moved-position' };
      }
    }
    // Pass 3: same title, anywhere.
    for (let i = 0; i < existingIndexed.length; i++) {
      if (consumed.has(i)) continue;
      const e = existingIndexed[i];
      if (e.key && e.key === target.key) {
        return { index: i, entry: e, kind: 'moved-set' };
      }
    }
    return null;
  };

  const bump = (bucket, field) => {
    summary[bucket][field] = (summary[bucket][field] || 0) + 1;
  };

  const merged = incomingIndexed.map((target) => {
    const match = findMatch(target);

    if (!match) {
      summary.added.push(target.song.name);
      SOURCE_SONG_FIELDS.forEach((f) => {
        if (target.song[f] != null && target.song[f] !== false) bump('fieldsPopulated', f);
      });
      return { ...target.song };
    }

    consumed.add(match.index);
    const old = match.entry.song;
    if (normalizeSongTitle(old.name) !== normalizeSongTitle(target.song.name)) {
      summary.aliased.push({ from: old.name, to: target.song.name });
    }

    if (match.kind === 'moved-set') {
      summary.movedSet.push({ title: target.song.name, from: match.entry.set, to: target.set });
    } else if (match.kind === 'moved-position') {
      summary.movedPosition.push({
        title: target.song.name,
        set: target.set,
        from: match.entry.position,
        to: target.position,
      });
    }

    // Keep the EXISTING song's id. The id is identity everywhere
    // downstream — groupSongsBySet keys off it, songIndex's per-song set
    // lookup keys off it, and the setlist editor's reorder and rating
    // controls address songs by it. Minting a fresh id for a song that is
    // demonstrably the same performance would invalidate all of that for no
    // gain.
    const next = { ...target.song, id: old.id || target.song.id };

    USER_OWNED_SONG_FIELDS.forEach((field) => {
      if (old[field] != null) {
        next[field] = old[field];
        bump('carriedOver', field);
      }
    });

    SOURCE_SONG_FIELDS.forEach((f) => {
      const had = old[f] != null && old[f] !== false;
      const has = next[f] != null && next[f] !== false;
      if (!had && has) bump('fieldsPopulated', f);
    });

    return next;
  });

  // ── What the source didn't account for ──────────────────────────────
  // Every existing song left unconsumed. A song the user added by hand is
  // KEPT — the source disagreeing is not grounds for deleting a user's
  // work — appended to the end of whichever set it was in. Anything else
  // unconsumed came from a previous source fetch and the current source
  // says it wasn't played, so it goes.
  const leftovers = existingIndexed.filter((_, i) => !consumed.has(i));

  const keptManual = [];
  const keptNotInSource = [];
  leftovers.forEach((e) => {
    if (e.song.manuallyAdded) {
      keptManual.push(e.song.name);
    } else if (hasUserNotes(e.song)) {
      // Rated or commented, and the source doesn't list it. Possibly a
      // title this band's alias map doesn't know yet, possibly a source
      // error; either way the user's rating is not ours to delete. Kept,
      // flagged `notInSource` so the setlist shows it for what it is. A
      // later re-sync that does find it clears the flag (it isn't a
      // user-owned field, so the incoming song doesn't carry it).
      keptNotInSource.push(e.song.name);
    } else {
      summary.removed.push(e.song.name);
    }
  });

  let result = merged;

  const kept = leftovers.filter((e) => e.song.manuallyAdded || hasUserNotes(e.song));
  if (kept.length > 0) {
    // Insert each kept song after the last song of its own set, so it
    // stays in the section the user knew it in rather than being dumped at
    // the end of the show. A set the incoming setlist doesn't have at all
    // (the user invented an "Encore II" the source doesn't list) keeps its
    // songs as a trailing group; groupSongsBySet handles a label it has
    // never seen by placing it after the canonical ones.
    const out = [];
    const keptBySet = new Map();
    kept.forEach((e) => {
      const set = e.song.set || '';
      if (!keptBySet.has(set)) keptBySet.set(set, []);
      // `manuallyAdded` is re-stamped so the flag survives even if a stored
      // song somehow lost it, since it is what the UI's "added by you" badge
      // and this rule both key off.
      keptBySet.get(set).push(e.song.manuallyAdded
        ? { ...e.song, manuallyAdded: true }
        : { ...e.song, notInSource: true });
    });

    for (let i = 0; i < merged.length; i++) {
      out.push(merged[i]);
      const thisSet = merged[i].set || '';
      const nextSet = i + 1 < merged.length ? (merged[i + 1].set || '') : null;
      if (thisSet !== nextSet && keptBySet.has(thisSet)) {
        out.push(...keptBySet.get(thisSet));
        keptBySet.delete(thisSet);
      }
    }
    // Sets the incoming setlist has no songs for at all.
    keptBySet.forEach((songs) => out.push(...songs));

    result = out;
  }

  summary.keptManual = keptManual;
  summary.keptNotInSource = keptNotInSource;
  summary.resultCount = result.length;

  return { setlist: result, changed: true, summary, chosenCandidate };
}

/**
 * A one-line rendering of a summary, for logging.
 */
export function describeSummary(summary) {
  if (!summary) return 'no summary';
  if (summary.skipped === 'empty-incoming') {
    return `skipped — source returned no songs (kept existing ${summary.existingCount})`;
  }
  if (summary.skipped === 'no-titled-songs') {
    return `skipped — source returned ${summary.incomingCount} rows with no song titles, `
      + `which means a field mapping is wrong (kept existing ${summary.existingCount})`;
  }
  if (summary.skipped === 'ambiguous-date') {
    const scored = (summary.candidates?.scored || []).map((c) => `${c.songCount} songs, ${Math.round(c.overlap * 100)}% overlap`).join('; ');
    return `skipped — the source has more than one show this date could be (${summary.candidates?.reason}: ${scored}); kept existing ${summary.existingCount}`;
  }
  const parts = [`${summary.existingCount} → ${summary.resultCount} songs`];
  if (summary.added.length) parts.push(`+${summary.added.length} added`);
  if (summary.removed.length) parts.push(`-${summary.removed.length} removed`);
  if (summary.movedSet.length) parts.push(`${summary.movedSet.length} changed set`);
  if (summary.movedPosition.length) parts.push(`${summary.movedPosition.length} moved`);
  if (summary.keptManual.length) parts.push(`${summary.keptManual.length} manual kept`);
  if (summary.keptNotInSource?.length) parts.push(`${summary.keptNotInSource.length} rated/commented kept as not in source`);
  if (summary.aliased?.length) parts.push(`${summary.aliased.length} renamed via alias`);
  if (summary.candidates?.reason === 'overlap') parts.push(`chose show ${summary.candidates.chosen + 1} of ${summary.candidates.scored.length} by overlap`);

  const carried = Object.entries(summary.carriedOver).map(([k, n]) => `${k}×${n}`);
  if (carried.length) parts.push(`carried ${carried.join(' ')}`);

  const populated = Object.entries(summary.fieldsPopulated).map(([k, n]) => `${k}×${n}`);
  if (populated.length) parts.push(`new ${populated.join(' ')}`);

  return parts.join(', ');
}
