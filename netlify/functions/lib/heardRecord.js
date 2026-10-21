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
//   posterSvg                           the poster and the preview card
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

  // ── The poster ──────────────────────────────────────────────────────
  //
  // Plain SVG: text, rects and lines only, so the same markup renders in
  // resvg (heard-image.js, which has Plus Jakarta Sans and nothing else)
  // and anywhere else. Type only, no band artwork. SVG doesn't wrap or
  // measure text, so widths are estimated per weight and a line that would
  // run over is shrunk or cut with an ellipsis.

  const COLORS = { navy: '#1f1f3a', navyLight: '#2a2a4e', mint: '#10d98a', mintDeep: '#10b981', amber: '#ffb700', text: '#f5f5f5', muted: '#a9a8c2', line: 'rgba(255,255,255,0.14)' };
  const FONT = "'Plus Jakarta Sans', sans-serif";
  const WIDTH_FACTOR = { 400: 0.55, 700: 0.58, 800: 0.6 };

  const SIZES = {
    feed: { width: 1080, height: 1350 },
    story: { width: 1080, height: 1920 },
    card: { width: 1200, height: 630 },
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function textWidth(text, size, weight, spacing = 0) {
    let units = 0;
    for (const ch of String(text)) {
      if (/[A-Z0-9#&@%]/.test(ch)) units += 1.18;
      else if (/[mwMW]/.test(ch)) units += 1.45;
      else if (/[ilj.,:;'’!|\s]/.test(ch)) units += 0.5;
      else units += 1;
    }
    return units * size * (WIDTH_FACTOR[weight] || 0.58) + spacing * String(text).length;
  }

  // Cut to fit maxWidth, with an ellipsis, at the given size.
  function clip(text, size, weight, maxWidth, spacing = 0) {
    let t = String(text);
    if (textWidth(t, size, weight, spacing) <= maxWidth) return t;
    while (t.length > 1 && textWidth(`${t}…`, size, weight, spacing) > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  function text(x, y, content, { size, weight = 700, fill = COLORS.text, anchor = 'start', spacing = 0, opacity } = {}) {
    return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}${opacity ? ` fill-opacity="${opacity}"` : ''}>${esc(content)}</text>`;
  }

  // The band name as big as it fits: one line if it can stay above
  // minSize, else two lines split at the word nearest the middle.
  function bandLines(name, maxWidth, maxSize, minSize) {
    const upper = String(name).toUpperCase();
    const fit = (t) => Math.min(maxSize, Math.floor(maxSize * maxWidth / textWidth(t, maxSize, 800, 0)));
    const one = fit(upper);
    if (one >= minSize || !upper.includes(' ')) return { lines: [upper], size: Math.max(one, Math.floor(minSize * 0.7)) };
    const words = upper.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const size = Math.min(fit(a), fit(b));
      if (!best || size > best.size) best = { lines: [a, b], size };
    }
    return best;
  }

  function statBlock(x, y, value, label, { size, labelSize }) {
    return text(x, y, value, { size, weight: 800 })
      + text(x, y + labelSize * 1.9, label.toUpperCase(), { size: labelSize, weight: 700, fill: COLORS.mint, spacing: labelSize * 0.12 });
  }

  function songList(x, y, items, { size, rowHeight, width, countWidth }) {
    return items.map((s, i) => {
      const yy = y + i * rowHeight;
      return text(x, yy, `${s.count}×`, { size, weight: 800, fill: COLORS.amber })
        + text(x + countWidth, yy, clip(s.name, size, 700, width - countWidth), { size, weight: 700 });
    }).join('');
  }

  function sectionLabel(x, y, label, size) {
    return text(x, y, label.toUpperCase(), { size, weight: 800, fill: COLORS.mint, spacing: size * 0.16 });
  }

  function frame(width, height, inset) {
    return `<rect width="${width}" height="${height}" fill="${COLORS.navy}"/>`
      + `<rect width="${width}" height="${height}" fill="url(#glow)"/>`
      + `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="${COLORS.amber}" stroke-width="3"/>`
      + `<rect x="${inset + 12}" y="${inset + 12}" width="${width - inset * 2 - 24}" height="${height - inset * 2 - 24}" fill="none" stroke="${COLORS.amber}" stroke-opacity="0.35" stroke-width="1.5"/>`;
  }

  function defs(width, height) {
    return `<defs><radialGradient id="glow" cx="50%" cy="22%" r="75%"><stop offset="0%" stop-color="${COLORS.mintDeep}" stop-opacity="0.22"/><stop offset="55%" stop-color="${COLORS.navyLight}" stop-opacity="0.5"/><stop offset="100%" stop-color="${COLORS.navy}" stop-opacity="0"/></radialGradient></defs>`;
  }

  function rule(x1, x2, y) {
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${COLORS.line}" stroke-width="2"/>`;
  }

  // The tall posters: feed (1080x1350) and story (1080x1920). Laid out
  // from both ends: the header and stats from the top, the footer and the
  // rarest catch / bust-outs from the bottom, and "most heard" gets as many
  // rows as fit between them.
  function tallPoster(data, record, { width, height }, story) {
    const pad = 96;
    const inner = width - pad * 2;
    const out = [];
    let y = story ? 210 : 140;

    out.push(text(width / 2, y, "SONGS I'VE HEARD LIVE", { size: story ? 30 : 26, weight: 800, fill: COLORS.mint, anchor: 'middle', spacing: 6 }));
    y += story ? 56 : 34;

    const band = bandLines(data.name, inner, story ? 170 : 124, story ? 92 : 80);
    for (const line of band.lines) {
      y += band.size * 0.96;
      out.push(text(width / 2, y, line, { size: band.size, weight: 800, fill: COLORS.amber, anchor: 'middle' }));
    }
    y += story ? 78 : 54;
    const span = yearSpan(record);
    if (span) out.push(text(width / 2, y, span, { size: story ? 40 : 34, weight: 700, anchor: 'middle', fill: COLORS.text }));
    y += story ? 66 : 40;
    out.push(rule(pad, width - pad, y));
    y += story ? 112 : 84;

    const stats = [
      [num(record.shows), record.shows === 1 ? 'Show' : 'Shows'],
      [num(record.uniqueSongs), record.uniqueSongs === 1 ? 'Song' : 'Songs'],
      [num(record.totalSongs), 'Performances'],
      [num(record.venues), record.venues === 1 ? 'Venue' : 'Venues'],
    ];
    const widths = [0.21, 0.22, 0.33, 0.24];
    let sx = pad;
    stats.forEach(([v, l], i) => {
      out.push(statBlock(sx, y, v, l, { size: v.length > 4 ? 52 : 64, labelSize: 20 }));
      sx += inner * widths[i];
    });
    y += story ? 104 : 74;
    out.push(rule(pad, width - pad, y));
    const listTop = y + (story ? 90 : 66);

    // Bottom up: footer, then the rarest catch and bust-outs.
    const footY = height - (story ? 200 : 126);
    out.push(text(width / 2, footY, 'mysetlists.net/heard', { size: story ? 40 : 36, weight: 800, fill: COLORS.amber, anchor: 'middle' }));
    out.push(text(width / 2, footY + 44, clip(credit(data), 22, 400, inner), { size: 22, weight: 400, fill: COLORS.muted, anchor: 'middle' }));
    let bottom = footY - (story ? 74 : 64);
    out.push(rule(pad, width - pad, bottom));

    const rare = record.rarest[0];
    const busts = record.bustOuts.slice(0, story ? 2 : 1);
    if (rare || busts.length) {
      const rowsHeight = Math.max(rare ? 100 : 0, busts.length ? 56 + (busts.length - 1) * 92 + 40 : 0);
      const top2 = bottom - 56 - rowsHeight;
      const half = inner / 2 - 24;
      if (rare) {
        out.push(sectionLabel(pad, top2, 'Rarest catch', 26));
        out.push(text(pad, top2 + 56, clip(rare.name, 38, 800, busts.length ? half : inner), { size: 38, weight: 800 }));
        out.push(text(pad, top2 + 100, `played ${plural(rare.timesPlayed, 'time')} ever`, { size: 26, weight: 400, fill: COLORS.muted }));
      }
      if (busts.length) {
        const bx = rare ? pad + inner / 2 + 24 : pad;
        const bw = rare ? half : inner;
        out.push(sectionLabel(bx, top2, busts.length === 1 ? 'Bust-out' : 'Bust-outs', 26));
        busts.forEach((b, i) => {
          const by = top2 + 56 + i * 92;
          out.push(text(bx, by, clip(b.name, 34, 800, bw), { size: 34, weight: 800 }));
          out.push(text(bx, by + 40, `after ${plural(b.gap, 'show')}`, { size: 26, weight: 400, fill: COLORS.muted }));
        });
      }
      bottom = top2 - (story ? 64 : 56);
      out.push(rule(pad, width - pad, bottom));
    }

    const rowHeight = story ? 62 : 54;
    const room = Math.floor((bottom - 36 - (listTop + 58)) / rowHeight) + 1;
    const top = record.top.slice(0, Math.max(0, Math.min(story ? 10 : 6, room)));
    if (top.length) {
      out.push(sectionLabel(pad, listTop, 'Most heard', 26));
      out.push(songList(pad, listTop + 58, top, { size: story ? 40 : 36, rowHeight, width: inner, countWidth: 100 }));
    }

    return out.join('');
  }

  // The 1200x630 preview card for a share link.
  function card(data, record, { width, height }) {
    const pad = 72;
    const out = [];
    const leftW = 560;
    out.push(text(pad, 118, "SONGS I'VE HEARD LIVE", { size: 22, weight: 800, fill: COLORS.mint, spacing: 4 }));
    const band = bandLines(data.name, leftW, 92, 64);
    let y = 130;
    for (const line of band.lines) {
      y += band.size;
      out.push(text(pad, y, line, { size: band.size, weight: 800, fill: COLORS.amber }));
    }
    const span = yearSpan(record);
    if (span) out.push(text(pad, y + 52, span, { size: 30, weight: 700 }));
    const sy = 450;
    const stats = [[num(record.shows), record.shows === 1 ? 'Show' : 'Shows'], [num(record.uniqueSongs), 'Songs'], [num(record.totalSongs), 'Performances']];
    stats.forEach(([v, l], i) => out.push(statBlock(pad + i * 190, sy, v, l, { size: v.length > 4 ? 42 : 52, labelSize: 16 })));

    const rx = 700;
    out.push(`<line x1="${rx - 40}" y1="96" x2="${rx - 40}" y2="${height - 96}" stroke="${COLORS.line}" stroke-width="2"/>`);
    const top = record.top.slice(0, 6);
    if (top.length) {
      out.push(sectionLabel(rx, 118, 'Most heard', 20));
      out.push(songList(rx, 170, top, { size: 28, rowHeight: 50, width: width - rx - pad, countWidth: 74 }));
    }
    out.push(text(width - pad, height - 70, 'mysetlists.net/heard', { size: 26, weight: 800, fill: COLORS.amber, anchor: 'end' }));
    return out.join('');
  }

  /** The poster as SVG. kind: 'feed' | 'story' | 'card'. */
  function posterSvg(data, record, kind) {
    const size = SIZES[kind] || SIZES.feed;
    const body = kind === 'card' ? card(data, record, size) : tallPoster(data, record, size, kind === 'story');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${defs(size.width, size.height)}${frame(size.width, size.height, kind === 'card' ? 28 : 40)}${body}</svg>`;
  }

  return {
    BUST_OUT_MIN_GAP,
    NON_SONG,
    SIZES,
    isSong,
    encodeSelection,
    decodeSelection,
    buildRecord,
    headline,
    credit,
    yearSpan,
    posterSvg,
  };
}

module.exports = { ...createHeard(), createHeard };
