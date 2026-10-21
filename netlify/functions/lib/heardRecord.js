// netlify/functions/lib/heardRecord.js
//
// The "Songs I've heard" tool's arithmetic, in one place for both halves:
// the browser (/heard/<slug>/, which ticks shows and shows the record live)
// and the functions (the share page, its preview image and the poster
// PNGs). Everything works on one band's show list, the /api/artist-shows
// shape built by artistSnapshotStats.js's buildShowList.
//
//   encodeSelection / decodeSelection   the share code for a set of shows
//   buildRecord                         the record: counts, top songs,
//                                       rarest catches, bust-outs, debuts,
//                                       songs still to chase
//
// ── One source, two runtimes ──────────────────────────────────────────
//
// The whole module is the body of createHeard(), which closes over nothing
// outside itself. Node calls it once for module.exports; the page functions
// inline `(${createHeard.toString()})()` into the HTML (heardPages.js), so
// the browser runs exactly this code and the share page can never count a
// record differently from the tool that made it. Keep it that way: no
// require, no Node or browser globals, nothing referenced from outside the
// function.
//
// ── The share code ────────────────────────────────────────────────────
//
// A selection is a set of shows, named by date rather than by archive id,
// because dates don't change: a show id could, and an index into the list
// moves whenever the archive adds a show it had missed. Each show is
// (days since 1950-01-01, which show that date it is: 0 for the first),
// sorted, and written as varints of (day delta * 4 + nth), base64url, after
// a version letter 'a'. A typical 40-show record is about 60 characters.
// Nothing about the person is in it.
//
// ── Counting rules ────────────────────────────────────────────────────
//
// The band pages' rules, so a number here means what it means there:
// a song played twice in one show (a reprise, a sandwich) is heard once at
// that show; "songs heard" counts every performance; a bust-out is a
// performance after a gap of BUST_OUT_MIN_GAP or more shows, the gap
// counting the show it came back at; and Jam, Drums, Space and the other
// non-songs (NON_SONG, the same list as artistSnapshotStats.js) stay in
// "every song" but are left out of the top songs, rarest catches,
// bust-outs, debuts and songs to chase.

function createHeard() {
  'use strict';

  const BUST_OUT_MIN_GAP = 50;
  const NON_SONG = /^(jam|drums|space|unknown|dueling drums|(bass|drum|drums|guitar|keys|keyboard|piano|organ|percussion) solo)$/i;
  const isSong = (song) => !NON_SONG.test(String(song.name || '').trim());

  const DAY_MS = 86400000;
  const EPOCH_DAY = Date.UTC(1950, 0, 1) / DAY_MS;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const VERSION = 'a';

  function dayNumber(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS - EPOCH_DAY;
  }

  function dateOfDay(n) {
    return new Date((n + EPOCH_DAY) * DAY_MS).toISOString().slice(0, 10);
  }

  function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += B64[n & 63];
    }
    return out;
  }

  function fromBase64Url(text) {
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (const ch of text) {
      const v = B64.indexOf(ch);
      if (v < 0) return null;
      value = (value << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
    }
    return bytes;
  }

  // ── The show list, indexed ──────────────────────────────────────────

  // One pass over a band's list, cached on the object: id -> show, and
  // each date's shows in the order the archive lists them.
  function indexOf(data) {
    if (data.__heardIndex) return data.__heardIndex;
    const byId = new Map();
    const byDate = new Map();
    data.shows.forEach((show, position) => {
      const nth = byDate.has(show.date) ? byDate.get(show.date).length : 0;
      const entry = { show, position, nth, day: dayNumber(show.date) };
      byId.set(show.id, entry);
      if (!byDate.has(show.date)) byDate.set(show.date, []);
      byDate.get(show.date).push(entry);
    });
    const index = { byId, byDate };
    Object.defineProperty(data, '__heardIndex', { value: index, enumerable: false });
    return index;
  }

  /** The share code for a list of show ids ('' for none). */
  function encodeSelection(data, ids) {
    const { byId } = indexOf(data);
    const picked = [];
    const seen = new Set();
    for (const id of ids) {
      const e = byId.get(String(id));
      if (!e || seen.has(e.show.id)) continue;
      seen.add(e.show.id);
      picked.push(e);
    }
    if (!picked.length) return '';
    picked.sort((a, b) => a.day - b.day || a.nth - b.nth);
    const bytes = [];
    let prev = 0;
    for (const e of picked) {
      let v = (e.day - prev) * 4 + Math.min(e.nth, 3);
      prev = e.day;
      while (v >= 128) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); }
      bytes.push(v);
    }
    return VERSION + toBase64Url(bytes);
  }

  /**
   * The shows a share code names: { ids, missing } (missing: dates in the
   * code with no such show in this list), or null for a malformed code.
   */
  function decodeSelection(data, code) {
    const text = String(code || '');
    if (text[0] !== VERSION || !/^[A-Za-z0-9_-]*$/.test(text.slice(1))) return null;
    const bytes = fromBase64Url(text.slice(1));
    if (!bytes) return null;
    const { byDate } = indexOf(data);
    const ids = [];
    const missing = [];
    let day = 0;
    let v = 0;
    let scale = 1;
    for (const b of bytes) {
      v += (b & 127) * scale;
      if (b & 128) { scale *= 128; if (scale > 2 ** 35) return null; continue; }
      day += Math.floor(v / 4);
      const nth = v % 4;
      const date = dateOfDay(day);
      const match = (byDate.get(date) || [])[nth];
      if (match) ids.push(match.show.id); else missing.push(date);
      v = 0;
      scale = 1;
    }
    if (v !== 0 || scale !== 1) return null;
    return { ids, missing };
  }

  // ── The record ──────────────────────────────────────────────────────

  function venueOf(data, show) {
    const v = data.venues[show.venue] || ['', ''];
    return { venue: v[0], city: v[1] };
  }

  function showRef(data, show) {
    const { venue, city } = venueOf(data, show);
    return { id: show.id, date: show.date, venue, city, url: show.url ? data.urlBase + show.url : '' };
  }

  const byName = (a, b) => a.name.localeCompare(b.name);

  /**
   * Everything the tool shows for a set of ticked shows. `ids` is any
   * iterable of show ids; unknown ids are ignored.
   */
  function buildRecord(data, ids) {
    const { byId } = indexOf(data);
    const picked = [];
    const seen = new Set();
    for (const id of ids || []) {
      const e = byId.get(String(id));
      if (e && !seen.has(e.show.id)) { seen.add(e.show.id); picked.push(e); }
    }
    picked.sort((a, b) => a.position - b.position);

    const heard = new Map(); // song index -> { count, first, last }
    const bustOuts = [];
    const debuts = [];
    const venues = new Set();
    const years = new Set();
    let performances = 0;
    let withSetlist = 0;

    for (const { show } of picked) {
      venues.add(show.venue);
      years.add(show.date.slice(0, 4));
      if (show.sets.length) withSetlist++;
      const atThisShow = new Set();
      for (const [, songs] of show.sets) {
        for (const [index, gap] of songs) {
          performances++;
          const song = data.songs[index];
          if (!song) continue;
          if (!atThisShow.has(index)) {
            atThisShow.add(index);
            const h = heard.get(index) || { count: 0, first: show.date, last: show.date };
            h.count++;
            h.last = show.date;
            heard.set(index, h);
          }
          if (!isSong(song)) continue;
          const ref = () => ({ slug: song.slug, name: song.name, isOriginal: song.isOriginal, timesPlayed: song.timesPlayed, show: showRef(data, show) });
          if (gap === null) debuts.push(ref());
          else if (gap >= BUST_OUT_MIN_GAP) bustOuts.push({ ...ref(), gap });
        }
      }
    }

    const songs = [...heard.entries()].map(([index, h]) => {
      const s = data.songs[index];
      return { slug: s.slug, name: s.name, isOriginal: s.isOriginal, originalArtist: s.originalArtist || '', timesPlayed: s.timesPlayed, count: h.count, firstHeard: h.first, lastHeard: h.last };
    }).sort((a, b) => b.count - a.count || byName(a, b));

    const real = songs.filter(isSong);
    const heardSlugs = new Set(songs.map((s) => s.slug));
    const first = picked[0] ? picked[0].show : null;
    const last = picked.length ? picked[picked.length - 1].show : null;

    return {
      shows: picked.length,
      showsWithSetlist: withSetlist,
      firstShow: first ? showRef(data, first) : null,
      lastShow: last ? showRef(data, last) : null,
      years: years.size,
      venues: venues.size,
      uniqueSongs: songs.length,
      totalSongs: performances,
      songs,
      top: real.slice(0, 10),
      rarest: real.slice().sort((a, b) => a.timesPlayed - b.timesPlayed || b.count - a.count || byName(a, b)).slice(0, 10),
      bustOuts: bustOuts.sort((a, b) => b.gap - a.gap || b.show.date.localeCompare(a.show.date) || byName(a, b)).slice(0, 10),
      debuts: debuts.sort((a, b) => b.show.date.localeCompare(a.show.date) || byName(a, b)),
      chasing: data.songs
        .filter((s) => s.isOriginal === true && isSong(s) && !heardSlugs.has(s.slug))
        .sort((a, b) => b.timesPlayed - a.timesPlayed || byName(a, b))
        .slice(0, 10)
        .map((s) => ({ slug: s.slug, name: s.name, timesPlayed: s.timesPlayed })),
      selectedIds: picked.map((e) => e.show.id),
    };
  }

  // "2016" or "2016–2026"
  function yearSpan(record) {
    if (!record.firstShow) return '';
    const a = record.firstShow.date.slice(0, 4);
    const b = record.lastShow.date.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }

  const num = (n) => Number(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || `${one}s`)}`;

  /** "Setlists courtesy of elgoose.net", for the page and the poster. */
  function credit(data) {
    return data.sourceName ? `Setlists courtesy of ${data.sourceName}` : '';
  }

  /** "A Goose record: 42 shows, 211 songs heard" (no names, ever). */
  function headline(bandName, record) {
    return `A ${bandName} record: ${plural(record.shows, 'show')}, ${plural(record.totalSongs, 'song')} heard`;
  }

  return {
    BUST_OUT_MIN_GAP,
    NON_SONG,
    isSong,
    encodeSelection,
    decodeSelection,
    buildRecord,
    headline,
    credit,
    yearSpan,
  };
}

module.exports = { ...createHeard(), createHeard };
