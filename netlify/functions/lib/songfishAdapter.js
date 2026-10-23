/**
 * netlify/functions/lib/songfishAdapter.js
 *
 * One adapter for every Songfish-powered archive: elgoose.net (Goose),
 * ttbase.net, kglw.net, thecarton.net, go-set.net, and the rest. They all
 * answer the same keyless v2 API, so the only thing that differs between
 * them is the site entry in config/songfish-sites.json.
 *
 *   GET https://<site>/api/v2/setlists/showdate/<YYYY-MM-DD>.json
 *
 * The response is a three-node envelope, `{ error, error_message, data }`.
 * `error` is 0/false on success and non-zero/true on failure (elgoose.net
 * has sent both spellings), and `data` is a FLAT array of song rows, one
 * per song, every act the archive carries mixed together. Set and encore
 * membership lives on each row as `settype` + `setnumber`.
 *
 * Formerly elgooseAdapter.js. Two behaviours changed on the way over, both
 * verified against live responses on 2026-10-21:
 *
 *   Encores   Songfish marks an encore as settype 'Set' (or 'One Set')
 *             with setnumber 'e', not as settype 'Encore'. The shared
 *             pickSetLabel read that as Set I, so every Goose encore was
 *             stored as the last song of the first set. See setParts.
 *
 *   Artists   The artist filter used to keep EVERY row when it matched
 *             none, so a Goose lookup on a date only Orebolo played
 *             (2024-02-08) returned Orebolo's setlist as Goose's. Rows are
 *             now kept only when `artist_id` equals the site's id for the
 *             artist; no match means no show. See rowsForArtist.
 *
 * ── Field mapping ─────────────────────────────────────────────────────
 *
 * Checked against elgoose.net (Goose, Ascend Amphitheater, 2024-10-24) and
 * the 2024 setlists on ttbase.net and kglw.net, which send the same keys.
 * There is NO gap or debut field on this endpoint: the full key list is
 * artist, artist_id, city, country, css_class, footnote, footnotes, isjam,
 * isjamchart, isoriginal, isrecommended, isreprise, isverified,
 * jamchart_notes, opener, original_artist, permalink, position, settype,
 * setnumber, show_id, showdate, shownotes, showorder, showtime, showtitle,
 * showyear, slug, song_id, songname, soundcheck, state, timezone, tour_id,
 * tourname, tracktime, transition, transition_id, uniqueid, venue_id,
 * venuename. So `sourceGap` and `debut` stay unset rather than guessed.
 *
 * Every upstream key is named once, in FIELDS. To re-check against a site:
 *
 *   /api/band-setlist?source=<site id>&artist=<name>&date=<date>&debug=1
 *
 * and read `upstream.firstRowKeys`.
 */

const https = require('https');
const {
  buildSetlist, cleanStr, pickSetLabel, setSortKey, stripHtml, toBool, toIntOrNull,
} = require('./bandSetlistShape');

const API_PATH = '/api/v2/setlists/showdate';

// A real User-Agent identifying the app. These are volunteer-run archives;
// an anonymous scraper is a bad neighbour.
const USER_AGENT = 'MySetlists/5.33 (+https://mysetlists.net)';

const REQUEST_TIMEOUT_MS = 10000;

// ── The one place an upstream key name appears ────────────────────────
// Left side: what the app calls it. Right side: what Songfish calls it.
const FIELDS = {
  showDate: 'showdate',
  permalink: 'permalink',
  venue: 'venuename',
  city: 'city',
  state: 'state',
  country: 'country',
  setType: 'settype',
  setNumber: 'setnumber',
  position: 'position',
  songName: 'songname',
  transition: 'transition',
  // `footnote` is the first footnote as text; `footnotes` is every one of
  // them as a JSON-encoded array string ('["w\/ Jeff Fielder","Dedicated
  // to Bill Walton"]'). They agree whenever there is only one.
  footnote: 'footnote',
  footnotes: 'footnotes',
  jamchart: 'isjamchart',
  jamchartNote: 'jamchart_notes',
  soundcheck: 'soundcheck',
  opener: 'opener',
  isOriginal: 'isoriginal',
  originalArtist: 'original_artist',
  showNotes: 'shownotes',
  tourName: 'tourname',
  showId: 'show_id',
  songId: 'song_id',    // stable across performances
  uniqueId: 'uniqueid', // identifies ONE rendition, not the song
  artistId: 'artist_id',
  artistName: 'artist',
  slug: 'slug',
};

function get(row, field) {
  return row ? row[FIELDS[field]] : undefined;
}

// Songfish returns `permalink` as a bare filename
// ("goose-october-24-2024-ascend-amphitheater-nashville-tn-usa.html").
// Stored as-is it is a relative href that 404s on our own site, so it is
// resolved against the site's /setlists/ path here. An absolute one passes
// through untouched.
function absolutePermalink(raw, permalinkBase) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return permalinkBase + value.replace(/^\/+/, '');
}

// Also used by the public band-page snapshot (publicArtistSources.js) for
// its per-year and per-artist calls, which is why the host is a parameter.
function fetchSongfishJson(path, { hostname, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse ${hostname} response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`${hostname} request timed out`));
    });
    req.end();
  });
}

// Describes what the upstream actually sent, for the case where we got a
// 200 and no usable rows: "no show on that date" and "the FIELDS map is
// wrong" are otherwise byte-identical. Key NAMES and counts only.
function describeUpstream(payload) {
  if (!payload || typeof payload !== 'object') {
    return { topLevelKeys: [], dataType: payload === null ? 'null' : typeof payload, rowCount: 0 };
  }
  const data = payload.data;
  let dataType;
  if (Array.isArray(data)) dataType = 'array';
  else if (data === null) dataType = 'null';
  else if (data === undefined) dataType = 'absent';
  else dataType = typeof data;

  return {
    topLevelKeys: Object.keys(payload),
    dataType,
    rowCount: Array.isArray(data) ? data.length : 0,
    firstRowKeys: Array.isArray(data) && data.length && data[0] && typeof data[0] === 'object'
      ? Object.keys(data[0])
      : [],
    errorValue: payload.error === undefined ? 'absent' : String(payload.error),
    errorMessage: payload.error_message == null ? '' : String(payload.error_message),
  };
}

/**
 * readEnvelope(payload, siteName) -> { ok, message, rows, diagnostics }
 *
 * Failure is any non-zero `error` (Number(true) is 1, Number(false) is 0,
 * so both spellings work). A 200 whose `data` is not a list is reported as
 * a failure rather than as "no show", so a shape change can't pass for an
 * empty date. An empty list is ok with no rows.
 */
function readEnvelope(payload, siteName = 'Songfish') {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: `Empty response from ${siteName}`, rows: [] };
  }
  const code = Number(payload.error);
  const failed = Number.isFinite(code) && code !== 0;
  if (failed) {
    return { ok: false, message: payload.error_message || `${siteName} reported an error`, rows: [] };
  }
  const diagnostics = describeUpstream(payload);

  if (diagnostics.dataType !== 'array') {
    return {
      ok: false,
      message: `Unexpected response shape from ${siteName}: data is ${diagnostics.dataType}, not an array`,
      rows: [],
      diagnostics,
    };
  }

  return { ok: true, message: '', rows: diagnostics.rowCount ? payload.data : [], diagnostics };
}

// ── Whose show is this? ───────────────────────────────────────────────
//
// /setlists/showdate/<date> is addressed by DATE, and every Songfish site
// carries more than one act: elgoose.net has Orebolo, Mt. Joy and guest
// sets; ttbase.net has dozens of openers and sit-ins. So rows are kept only
// when their `artist_id` is the site's id for the artist asked about.
//
// Strict on purpose. A filter that kept everything when it matched nothing
// handed back another band's setlist on any date the artist didn't play,
// labelled as theirs. An empty result is the safe answer: the merge rules
// write nothing and the app falls back to setlist.fm.
function rowsForArtist(rows, artistId) {
  const wanted = Number(artistId);
  if (artistId == null || String(artistId).trim() === '' || !Number.isInteger(wanted)) {
    return { rows: [], droppedOtherArtistCount: rows.length };
  }
  const kept = rows.filter((row) => Number(get(row, 'artistId')) === wanted);
  return { rows: kept, droppedOtherArtistCount: rows.length - kept.length };
}

/**
 * Groups the flat row array by show, because one date can carry more than
 * one (a festival day, or an early and late show). Grouped on the upstream
 * show id; venue is what the caller then disambiguates on.
 */
function groupRowsByShow(rows) {
  const byShow = new Map();
  for (const row of rows) {
    const key = String(get(row, 'showId') || get(row, 'permalink') || get(row, 'venue') || 'unknown');
    if (!byShow.has(key)) byShow.set(key, []);
    byShow.get(key).push(row);
  }
  return Array.from(byShow.values());
}

// ── Sets and encores ──────────────────────────────────────────────────
//
// Songfish writes the set NUMBER as '1', '2', '3' and the encore as 'e'
// (settype stays 'Set' or 'One Set'). 'e2' and the like are read as a
// second encore. Translated here into the (type, number) pair the shared
// pickSetLabel / setSortKey already understand, so they need no change and
// the phish.net and band-page paths that also use them are untouched.
function setParts(setType, setNumber) {
  const encore = String(setNumber == null ? '' : setNumber).trim().match(/^e(\d*)$/i);
  if (encore) return { type: 'Encore', number: encore[1] || '1' };
  return { type: setType, number: setNumber };
}

// Every footnote on the row, joined. Falls back to `footnote` when
// `footnotes` is absent or not a JSON array.
function footnoteText(row) {
  const raw = get(row, 'footnotes');
  let list = null;
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { list = JSON.parse(raw); } catch (e) { list = null; }
  }
  const notes = Array.isArray(list) ? list.map(cleanStr).filter(Boolean) : [];
  if (notes.length) return notes.join('; ');
  return get(row, 'footnote');
}

function mapShow(rows, site) {
  const first = rows[0] || {};

  const mapped = rows.map((row) => {
    const { type, number } = setParts(get(row, 'setType'), get(row, 'setNumber'));
    // The row-level soundcheck flag and a 'Soundcheck' settype are two
    // spellings of the same thing; either one drops the row.
    const isSoundcheck = toBool(get(row, 'soundcheck'));

    return {
      set: isSoundcheck ? null : pickSetLabel(type, number),
      setSortKey: setSortKey(type, number),
      position: toIntOrNull(get(row, 'position')) || 0,
      name: get(row, 'songName'),
      transition: get(row, 'transition'),
      footnote: footnoteText(row),
      jamchart: get(row, 'jamchart'),
      jamchartNote: get(row, 'jamchartNote'),
      // No gap and no debut: this endpoint carries neither (see header).
      cover: toBool(get(row, 'isOriginal')) ? null : (cleanStr(get(row, 'originalArtist')) || null),
      debut: false,
      opener: get(row, 'opener'),
      // `uniqueid` is one rendition; `song_id` and `slug` are the song.
      songId: get(row, 'songId'),
      songSlug: get(row, 'slug'),
    };
  });

  const { songs, droppedSoundcheckCount, droppedUntitledCount } = buildSetlist(mapped);

  return {
    source: site.id,
    songs,
    droppedSoundcheckCount,
    // Non-zero means a FIELDS key is almost certainly wrong — see
    // buildSetlist in bandSetlistShape.js.
    droppedUntitledCount,
    showDate: String(get(first, 'showDate') || ''),
    venue: String(get(first, 'venue') || ''),
    city: String(get(first, 'city') || ''),
    state: String(get(first, 'state') || ''),
    country: String(get(first, 'country') || ''),
    tour: String(get(first, 'tourName') || ''),
    sourceShowId: String(get(first, 'showId') || ''),
    sourcePermalink: absolutePermalink(get(first, 'permalink'), site.permalinkBase),
    // Show-level prose; the archives write HTML here and the UI renders text.
    setlistNotes: stripHtml(get(first, 'showNotes')),
    sourceArtistId: String(get(first, 'artistId') || ''),
  };
}

/**
 * fetchSetlists(site, date, { artistId }) -> { ok, message, shows: [...] }
 *
 * `site` is an entry from songfishSites.js; `artistId` is that site's
 * numeric artist_id for the artist (songfishSites.artistIdFor). Returns
 * every show the site has for that artist on that date. Picking between two
 * shows on one date is the caller's job (band-setlist.js's selectShow).
 */
async function fetchSetlists(site, date, { artistId } = {}) {
  const { statusCode, data } = await fetchSongfishJson(
    `${API_PATH}/${encodeURIComponent(date)}.json`,
    { hostname: site.hostname },
  );

  if (statusCode !== 200) {
    return { ok: false, message: `${site.hostname} returned HTTP ${statusCode}`, shows: [] };
  }

  const envelope = readEnvelope(data, site.hostname);
  if (!envelope.ok) {
    return { ok: false, message: envelope.message, shows: [], upstream: envelope.diagnostics };
  }

  const { rows, droppedOtherArtistCount } = rowsForArtist(envelope.rows, artistId);

  const shows = groupRowsByShow(rows)
    .map((showRows) => mapShow(showRows, site))
    // A show kept only because rows were dropped still comes through, so a
    // mapping error is visible. It carries no songs, which is what makes
    // the merge rules leave the existing setlist alone.
    .filter((show) => show.songs.length > 0
      || show.droppedSoundcheckCount > 0
      || show.droppedUntitledCount > 0);

  return { ok: true, message: '', shows, droppedOtherArtistCount, upstream: envelope.diagnostics };
}

module.exports = {
  FIELDS, describeUpstream, fetchSetlists, fetchSongfishJson, footnoteText, groupRowsByShow,
  mapShow, readEnvelope, rowsForArtist, setParts,
};
