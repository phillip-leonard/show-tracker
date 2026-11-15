/**
 * Groups a stored setlist (array of song objects) into Set I / Set II / Encore
 * sections. Handles both the per-song `set` label (modern imports) and the
 * legacy `setBreak` marker (stamped only on the first song of each set/encore).
 */

const CANONICAL_ORDER = ['Set I', 'Set II', 'Set III', 'Set IV', 'Encore', 'Encore II', 'Encore III'];

export function setBreakToLabel(setBreak) {
  if (!setBreak) return null;
  if (setBreak === 'Main Set') return 'Set I';
  if (setBreak === 'Encore') return 'Encore';
  if (setBreak === 'Encore 2') return 'Encore II';
  const m = setBreak.match(/^Set (\d+)$/);
  if (m) {
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    return `Set ${ROMAN[parseInt(m[1]) - 1] || m[1]}`;
  }
  return setBreak;
}

// Groups a setlist into [{ label, songs }], in performance order.
// A song with no set/setBreak info of its own (e.g. manually added) falls
// into whichever group is currently open, rather than defaulting to Set I.
export function groupSongsBySet(setlist = []) {
  if (!setlist.length) return [];
  const groups = {};
  const order = [];
  const hasSetField = setlist.some(s => s.set);

  let currentLabel = 'Set I';
  if (hasSetField) {
    setlist.forEach(song => {
      if (song.set) currentLabel = song.set;
      if (!groups[currentLabel]) { groups[currentLabel] = []; order.push(currentLabel); }
      groups[currentLabel].push(song);
    });
  } else {
    setlist.forEach(song => {
      if (song.setBreak) currentLabel = setBreakToLabel(song.setBreak) || currentLabel;
      if (!groups[currentLabel]) { groups[currentLabel] = []; order.push(currentLabel); }
      groups[currentLabel].push(song);
    });
  }

  const keys = [
    ...CANONICAL_ORDER.filter(k => groups[k]),
    ...order.filter(k => !CANONICAL_ORDER.includes(k) && groups[k]),
  ];

  return keys.map(label => ({ label, songs: groups[label] }));
}

// Returns the setlist of every distinct set/encore label a show currently
// has, in performance order — used to populate a "which set?" selector.
export function getSetLabels(setlist = []) {
  return groupSongsBySet(setlist).map(g => g.label);
}

// Flattens groupSongsBySet() back into a single array, each song annotated
// with `_setLabel` (the section header to render immediately before it, or
// null if it continues the current section). Used by flat-list renderers
// that show a section header inline rather than via nested groups.
export function attachSetBoundaryLabels(setlist = []) {
  const groups = groupSongsBySet(setlist);
  const withLabels = [];
  groups.forEach(group => {
    group.songs.forEach((song, i) => {
      withLabels.push({ ...song, _setLabel: i === 0 ? group.label : null });
    });
  });
  return withLabels;
}

// Returns the list of set/encore labels to offer in a "which set?" picker —
// every label the show already has, plus every canonical label it doesn't
// have yet (so e.g. "Encore" is always selectable as a new section even on
// a show that setlist.fm only gave a single Set I). Non-canonical legacy
// labels (rare) are kept at the end.
export function getSetOptions(setlist = []) {
  const existing = getSetLabels(setlist);
  const nonCanonicalExisting = existing.filter(l => !CANONICAL_ORDER.includes(l));
  return [...CANONICAL_ORDER, ...nonCanonicalExisting];
}

// Rebuilds a flat setlist array from a groupSongsBySet()-shaped group list,
// stamping each song's `.set` to match the group it's now in.
function flattenGroups(groups) {
  return groups.flatMap(({ label, songs }) => songs.map(song => ({ ...song, set: label })));
}

// Moves one song (by id) to a different set/encore label, appending it to
// the end of that section. Creates the section if it doesn't exist yet.
// Used by the setlist editor to reassign a song between Set 1/Set 2/Encore.
export function moveSongToSet(setlist = [], songId, newLabel) {
  const groups = groupSongsBySet(setlist);
  let moved = null;
  const stripped = groups
    .map(group => {
      const songs = group.songs.filter(song => {
        if (song.id === songId) { moved = song; return false; }
        return true;
      });
      return { ...group, songs };
    })
    .filter(group => group.songs.length > 0);

  if (!moved) return setlist;

  const targetIndex = stripped.findIndex(g => g.label === newLabel);
  if (targetIndex === -1) {
    stripped.push({ label: newLabel, songs: [moved] });
  } else {
    stripped[targetIndex] = { ...stripped[targetIndex], songs: [...stripped[targetIndex].songs, moved] };
  }

  return flattenGroups(stripped);
}

// Moves a song one position up/down within its own set (direction: -1 or 1).
// No-op if the move would go out of bounds. Used by the setlist editor's
// reorder controls.
export function reorderSongWithinSet(setlist = [], setLabel, songIndex, direction) {
  const groups = groupSongsBySet(setlist);
  const groupIndex = groups.findIndex(g => g.label === setLabel);
  if (groupIndex === -1) return setlist;

  const songs = [...groups[groupIndex].songs];
  const targetIndex = songIndex + direction;
  if (targetIndex < 0 || targetIndex >= songs.length) return setlist;

  [songs[songIndex], songs[targetIndex]] = [songs[targetIndex], songs[songIndex]];
  const newGroups = groups.map((g, i) => (i === groupIndex ? { ...g, songs } : g));
  return flattenGroups(newGroups);
}

// Removing and re-inserting one song (the delete and its undo) live in
// lib/setlistEdits.js (CommonJS, 5.60.9) with the other setlist edits;
// re-exported here for existing callers.
export { removeSongFromSetlist, insertSongAt } from '@/lib/setlistEdits';
