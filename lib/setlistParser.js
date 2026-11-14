/**
 * Shared setlist.fm response parsing — extracts songs with per-song set/encore
 * labels from a setlist.fm setlist object (the `sets.set[]` structure).
 *
 * setlist.fm labels each set as either a regular set or an encore (`set.encore`
 * holds the encore's 1-based number). Regular sets and encores are counted
 * separately so labels come out right even when a show has multiple regular
 * sets before its encore(s) — e.g. Set I, Set II, Encore, Encore II.
 *
 * CommonJS (5.60.5), so normalize-show builds songs with this same code.
 *
 * Song ids: by default the app's long-standing "base36 time + random" id,
 * unchanged. `idFor(index)` replaces it, so a test (and the golden
 * fixtures in fixtures/shows/) gets the same ids on every run.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const toRoman = (n) => ROMAN[n - 1] || String(n);

const randomSongId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function extractSongsFromSetlist(setlistFmSetlist, { idFor = randomSongId } = {}) {
  const songs = [];
  let regularSetCount = 0;
  let encoreCount = 0;

  if (setlistFmSetlist?.sets?.set) {
    setlistFmSetlist.sets.set.forEach(set => {
      let setLabel;
      if (set.encore) {
        encoreCount++;
        setLabel = encoreCount === 1 ? 'Encore' : `Encore ${toRoman(encoreCount)}`;
      } else {
        regularSetCount++;
        setLabel = `Set ${toRoman(regularSetCount)}`;
      }

      if (set.song) {
        set.song.forEach(song => {
          songs.push({
            id: idFor(songs.length),
            name: (song.name || '').trim(),
            set: setLabel,
            cover: song.cover ? song.cover.name : null,
            tape: song.tape || false,
          });
        });
      }
    });
  }

  return songs;
}

module.exports = { extractSongsFromSetlist, randomSongId };
