// lib/setGroups.js — a stored setlist split into its sets and encores, in
// the order they were played (5.60.23). CommonJS, so the public show page
// (netlify/functions/public-show.js) requires the same rule the app uses
// through lib/setlistGrouping.js; until 5.60.23 that page kept its own copy.
//
// THE ORDER. Sets first, by number, then encores, by number, then any other
// label in the order it first appears. A set or encore number may be Roman
// or Arabic ("Set V", "Set 9", "Encore 2"), so a seven-set show runs
// Set I … Set VII, Encore. Until 5.60.23 only Set I–IV and Encore–Encore III
// were known; a fifth set sorted after the encores.

const ROMAN = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90],
  ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];

function toRoman(n) {
  let left = n;
  let out = '';
  for (const [sym, value] of ROMAN) {
    while (left >= value) { out += sym; left -= value; }
  }
  return out;
}

/** "IX" -> 9, "12" -> 12; 0 for anything else. */
function readNumber(text) {
  const s = String(text || '').trim().toUpperCase();
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  if (!/^[MDCLXVI]+$/.test(s)) return 0;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 }[s[i]];
    const next = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 }[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  // Only a numeral that reads back the same ("IIII" and "VX" aren't).
  return toRoman(total) === s ? total : 0;
}

/**
 * Where a label sorts: { rank, number }. rank 0 a set, 1 an encore, 2
 * anything else (its number 0). "Encore" alone is encore 1.
 */
function setLabelRank(label) {
  const s = String(label || '').trim();
  const set = s.match(/^set\s+(\S+)$/i);
  if (set) {
    const n = readNumber(set[1]);
    if (n > 0) return { rank: 0, number: n };
  }
  const encore = s.match(/^encore(?:\s+(\S+))?$/i);
  if (encore) {
    const n = encore[1] ? readNumber(encore[1]) : 1;
    if (n > 0) return { rank: 1, number: n };
  }
  return { rank: 2, number: 0 };
}

/** The labels in playing order; ties (and other labels) keep their order. */
function orderSetLabels(labels) {
  return (labels || [])
    .map((label, i) => ({ label, i, ...setLabelRank(label) }))
    .sort((a, b) => a.rank - b.rank || a.number - b.number || a.i - b.i)
    .map((x) => x.label);
}

/** A legacy `setBreak` marker ("Main Set", "Set 2", "Encore 2") as a label. */
function setBreakToLabel(setBreak) {
  if (!setBreak) return null;
  if (setBreak === 'Main Set') return 'Set I';
  if (setBreak === 'Encore') return 'Encore';
  if (setBreak === 'Encore 2') return 'Encore II';
  const m = String(setBreak).match(/^Set (\d+)$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    return n > 0 ? `Set ${toRoman(n)}` : setBreak;
  }
  return setBreak;
}

// Groups a setlist into [{ label, songs }], in playing order. A song with
// no set/setBreak of its own (e.g. added by hand) joins whichever section
// is open, rather than defaulting to Set I.
function groupSongsBySet(setlist = []) {
  if (!setlist || !setlist.length) return [];
  const groups = {};
  const order = [];
  const hasSetField = setlist.some((s) => s && s.set);

  let currentLabel = 'Set I';
  setlist.forEach((song) => {
    if (hasSetField) {
      if (song.set) currentLabel = song.set;
    } else if (song.setBreak) {
      currentLabel = setBreakToLabel(song.setBreak) || currentLabel;
    }
    if (!groups[currentLabel]) { groups[currentLabel] = []; order.push(currentLabel); }
    groups[currentLabel].push(song);
  });

  return orderSetLabels(order).map((label) => ({ label, songs: groups[label] }));
}

module.exports = { groupSongsBySet, setBreakToLabel, orderSetLabels, setLabelRank, toRoman };
