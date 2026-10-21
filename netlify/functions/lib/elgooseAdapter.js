/**
 * netlify/functions/lib/elgooseAdapter.js
 *
 * elgoose.net — the community archive for Goose, running the Songfish
 * engine. Free, public, no key and no auth.
 *
 *   GET https://elgoose.net/api/v2/setlists/showdate/<YYYY-MM-DD>.json
 *
 * The response is a three-node envelope, `{ error, error_message, data }`,
 * where `error` is 0 or 1 (a number, not a boolean — phish.net's v5 differs
 * here, which is why each adapter tests its own error node rather than
 * sharing one truthiness check) and `data` is a FLAT array of song rows,
 * one row per song, with no nested set structure. Set and encore membership
 * lives on each row as `settype` + `setnumber`.
 *
 * Being date-addressable is the whole point. One request per show date, no
 * paging, no DD-MM-YYYY reversal, and none of the three-page /
 * three-name-variant match loop scanForMissingSetlists has to run against
 * setlist.fm's search to find a single night.
 *
 * ── Field mapping: verified against the archive's real keys ──────────
 *
 * Checked against elgoose.net's response for Goose at Ascend Amphitheater,
 * 2024-10-24 (16 songs, two sets), using ?debug=1 to read back every key
 * the archive actually sends on a setlist row. Four corrections came out
 * of that, all of them things the earlier guessed mapping got wrong:
 *
 *   jamchart_description -> jamchart_notes   the flag arrived, the text did
 *                                            not, so a jam-charted song had
 *                                            a badge and nothing behind it
 *   uniqueid             -> song_id          for songId. `uniqueid` is one
 *                                            rendition (the same song twice
 *                                            in a set has two); `song_id`
 *                                            is the song
 *   original_artist                          the covered artist IS provided;
 *                                            this adapter used to set
 *                                            cover: null and claim it wasn't
 *   shownotes                                show-level prose IS provided;
 *                                            this adapter used to hardcode
 *                                            setlistNotes: '' and call it a
 *                                            phish.net-only field
 *
 * ── There is no gap data on this endpoint ────────────────────────────
 *
 * Not mis-spelled — absent. The full key list is showtime, showtitle,
 * artist, song_id, set_label, tracktime, transition_id, footnotes,
 * jamchart_notes, venue_id, shownotes, showyear, showorder, tour_id,
 * isverified, original_artist, timezone, isreprise, isjam, css_class,
 * isrecommended, plus the ones read below. Nothing resembling a gap count.
 *
 * So `sourceGap` cannot be populated from /setlists/showdate/, and the
 * former `gap: 'gap'` entry mapped a key that has never existed — which is
 * why every song came back without it while the mapping looked complete.
 * A mapping that cannot resolve is worse than no mapping: it reads as a
 * working feature. The entry is gone.
 *
 * Getting the official gap count therefore needs a different Songfish
 * endpoint and a second request per song or per show, which is a real
 * design decision (how to batch it, how to cache it) rather than a field
 * rename. Deliberately not attempted here.
 *
 * Every upstream key this adapter reads is named exactly once, in FIELDS
 * below, so a correction stays a one-line edit. To re-check it against the
 * archive at any time:
 *
 *   /api/band-setlist?source=elgoose&artist=Goose&date=<date>&debug=1
 *
 * and read `upstream.firstRowKeys`.
 */

const https = require('https');
const {
  buildSetlist, cleanStr, pickSetLabel, setSortKey, stripHtml, toBool, toIntOrNull,
} = require('./bandSetlistShape');

const HOSTNAME = 'elgoose.net';
const API_PATH = '/api/v2/setlists/showdate';

// A real User-Agent identifying the app, as the existing functions do. This
// is a volunteer-run archive; an anonymous scraper is a bad neighbour.
const USER_AGENT = 'MySetlists/5.33 (+https://mysetlists.net)';

const REQUEST_TIMEOUT_MS = 10000;

// ── The one place an upstream key name appears ────────────────────────
// Left side: what the app calls it. Right side: what elgoose.net calls it.
// If a key turns out to be spelled differently on a live response, fix it
// here and nowhere else.
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
  footnote: 'footnote',
  jamchart: 'isjamchart',
  jamchartNote: 'jamchart_notes',
  soundcheck: 'soundcheck',
  opener: 'opener',
  isOriginal: 'isoriginal',
  originalArtist: 'original_artist',
  showNotes: 'shownotes',
  // NO `gap` ENTRY. The showdate endpoint does not carry gap data at all —
  // confirmed by reading every key it sends (see the header). It was
  // mapped to a 'gap' key that has never existed, which is why sourceGap
  // was silently absent from every song. Mapping a key that cannot resolve
  // is worse than not mapping it: it looks like the feature works.
  tourName: 'tourname',
  showId: 'show_id',
  songId: 'song_id',    // stable across performances — use for song-page links
  uniqueId: 'uniqueid', // identifies ONE rendition, not the song
  artistId: 'artist_id',
  artistName: 'artist',
  slug: 'slug',
};

// elgoose.net returns `permalink` as a bare filename, not a URL:
//
//   "goose-august-15-2026-frost-amphitheater-stanford-ca-usa.html"
//
// Stored and rendered as-is, that is a RELATIVE href, so the attribution
// link on a show page resolved against mysetlists.net and 404'd on our own
// site instead of reaching the archive. Resolved against the archive's
// setlist path here, at the edge of the system, so nothing downstream has
// to know the difference — and an already-absolute permalink (which is
// what phish.net sends) passes through untouched.
const PERMALINK_BASE = 'https://elgoose.net/setlists/';

function absolutePermalink(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return PERMALINK_BASE + value.replace(/^\/+/, '');
}

function get(row, field) {
  return row ? row[FIELDS[field]] : undefined;
}

// Any Songfish archive answers the same /api/v2/ paths, so the host is a
// parameter: elgoose.net by default, allthings.umphreys.com or kglw.net for
// the public band-page snapshot (publicArtistSources.js). That is the whole
// of the "other Songfish sites" support for now; the per-artist source
// registry and adapter refactor are a separate piece of work.
function fetchSongfishJson(path, { hostname = HOSTNAME, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
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

function fetchShowDate(date) {
  return fetchSongfishJson(`${API_PATH}/${encodeURIComponent(date)}.json`);
}

// Describes what the upstream actually sent, for the case where we got a
// 200 and no usable rows. Without this, "the archive has no show on that
// date" and "the `data` node is not shaped the way this adapter assumes"
// produce byte-identical output — which is precisely the question you need
// answered when the field mapping is unverified and a lookup comes back
// empty. Attached to the response only when there are no songs, so a
// normal response is not bloated by it.
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
    // The first row's keys are the single most useful thing for checking a
    // FIELDS map against reality: if they are present but none of them is
    // the key this adapter reads, the mapping is wrong and this names the
    // real spelling.
    firstRowKeys: Array.isArray(data) && data.length && data[0] && typeof data[0] === 'object'
      ? Object.keys(data[0])
      : [],
    errorValue: payload.error === undefined ? 'absent' : String(payload.error),
    errorMessage: payload.error_message == null ? '' : String(payload.error_message),
  };
}

/**
 * elgoose.net signals failure with `error: 1` and a message in
 * `error_message`. Tested as a number against 0 rather than truthily,
 * because that is what this API actually returns — phish.net's v5 uses a
 * boolean for the same node and the two must not be conflated.
 */
function readEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'Empty response from elgoose.net', rows: [] };
  }
  // Non-zero, not just 1: phish.net, the same lineage, reports a bad key
  // as error 2, and a test for 1 alone reads that as an empty success.
  const code = Number(payload.error);
  const failed = Number.isFinite(code) && code !== 0;
  if (failed) {
    return { ok: false, message: payload.error_message || 'elgoose.net reported an error', rows: [] };
  }
  const diagnostics = describeUpstream(payload);

  if (diagnostics.dataType !== 'array') {
    // A 200 whose `data` is not a list is not an empty result, it is a
    // response this adapter does not understand. Reported as a failure
    // so it cannot be mistaken for "no show on that date" — the merge
    // rules treat ok:false and an empty setlist identically, so this is
    // no less safe, just no longer silent.
    return {
      ok: false,
      message: `Unexpected response shape from elgoose.net: data is ${diagnostics.dataType}, not an array`,
      rows: [],
      diagnostics,
    };
  }

  return { ok: true, message: '', rows: diagnostics.rowCount ? payload.data : [], diagnostics };
}

// ── Whose show is this? ───────────────────────────────────────────────
//
// /setlists/showdate/<date> is addressed by DATE, not by artist, and this
// Songfish instance carries more than one act — elgoose.net lists Orebolo
// and other Goose-adjacent projects alongside Goose itself. So a date where
// two of them played returns rows for both, grouped into two shows, and the
// caller picks between them on venue alone. On a date where the venue
// doesn't match, or matches both, that is a coin flip between two different
// bands' setlists.
//
// Rows carry the artist, so the filter belongs here, before grouping.
//
// ── Failing open, deliberately ────────────────────────────────────────
//
// The filter compares against `sourceArtistFilter` from the registry
// ('goose'), and the exact shape of the archive's `artist` and `artist_id`
// values is not verified against a live response. So if the filter matches
// NOTHING, every row is kept and the result is exactly what it was before
// this existed. A filter that cannot recognize its own artist must not turn
// a working lookup into an empty one — the cost of being wrong in that
// direction is a show that stops updating, which is the failure mode this
// whole feature has been chasing.
function artistRowKey(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

function rowsForArtist(rows, artistFilter) {
  const wanted = artistRowKey(artistFilter);
  if (!wanted) return { rows, droppedOtherArtistCount: 0, filterApplied: false };

  const kept = rows.filter((row) => {
    const id = String(get(row, 'artistId') == null ? '' : get(row, 'artistId')).toLowerCase();
    const name = artistRowKey(get(row, 'artistName'));
    return id === wanted || name === wanted;
  });

  if (kept.length === 0) {
    return { rows, droppedOtherArtistCount: 0, filterApplied: false };
  }

  return { rows: kept, droppedOtherArtistCount: rows.length - kept.length, filterApplied: true };
}

/**
 * Groups the flat row array by show, because one date can carry more than
 * one (a festival day where Goose played twice, or a late show). Grouping
 * on the upstream show id rather than on venue name, since that is the
 * source's own notion of "one show"; venue is what the caller then
 * disambiguates on.
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

function mapShow(rows) {
  const first = rows[0] || {};

  const mapped = rows.map((row) => {
    const setType = get(row, 'setType');
    const setNumber = get(row, 'setNumber');
    // The row-level soundcheck flag and a 'Soundcheck' settype are two
    // spellings of the same thing; either one drops the row.
    const isSoundcheck = toBool(get(row, 'soundcheck'));

    return {
      set: isSoundcheck ? null : pickSetLabel(setType, setNumber),
      setSortKey: setSortKey(setType, setNumber),
      position: toIntOrNull(get(row, 'position')) || 0,
      name: get(row, 'songName'),
      transition: get(row, 'transition'),
      footnote: get(row, 'footnote'),
      jamchart: get(row, 'jamchart'),
      jamchartNote: get(row, 'jamchartNote'),
      // gap intentionally omitted — this endpoint has no gap field.
      // `isoriginal` is about authorship, not about this performance being a
      // cover *of someone else*, and elgoose.net does not name the covered
      // artist on the setlist row — so `cover` stays null rather than being
      // filled with a guess. A Goose show's covers are still visible in the
      // footnote, which is where the archive puts that detail.
      cover: toBool(get(row, 'isOriginal')) ? null : (cleanStr(get(row, 'originalArtist')) || null),
      // No `debut` from this source. elgoose.net's setlist row carries no
      // debut flag, and the obvious inference from `gap` does not hold: a
      // gap of 0 means "played at the previous show", which is the exact
      // opposite of a debut. Guessing here would be the same mistake
      // admin-populate-setlist.js's regex over setlist.fm's free-text
      // `info` field makes, just with a different input — so the field is
      // left unset and `sourceGap` carries the real number instead.
      // Revisit once a live response shows how a genuine debut is marked.
      debut: false,
      opener: get(row, 'opener'),
      // `uniqueid` is a per-PERFORMANCE id, not a stable song id —
      // verified against a live response where "Hot Love & The Lazy Poet"
      // played twice in one set and came back as 80312 and 80319, while
      // `slug` was "hot-love" both times. So songSlug is the identifier
      // that can address the archive's song page; songId identifies this
      // one rendition. Both are kept, labelled for what they actually are.
      songId: get(row, 'songId'),
      songSlug: get(row, 'slug'),
    };
  });

  const { songs, droppedSoundcheckCount, droppedUntitledCount } = buildSetlist(mapped);

  return {
    source: 'elgoose',
    songs,
    droppedSoundcheckCount,
    // Non-zero means a FIELDS key is almost certainly wrong — see the
    // note in bandSetlistShape.js's buildSetlist. Carried on the
    // response so a mapping error is diagnosable rather than silent.
    droppedUntitledCount,
    showDate: String(get(first, 'showDate') || ''),
    venue: String(get(first, 'venue') || ''),
    city: String(get(first, 'city') || ''),
    state: String(get(first, 'state') || ''),
    country: String(get(first, 'country') || ''),
    tour: String(get(first, 'tourName') || ''),
    sourceShowId: String(get(first, 'showId') || ''),
    sourcePermalink: absolutePermalink(get(first, 'permalink')),
    // `shownotes` IS a show-level prose field, so elgoose shows get notes
    // under the setlist just as phish.net ones do. An earlier version of
    // this adapter hardcoded '' and said the archive had no equivalent,
    // which was wrong. Tags are stripped because the archive writes HTML
    // here and the UI renders it as text.
    setlistNotes: stripHtml(get(first, 'showNotes')),
    sourceArtistId: String(get(first, 'artistId') || ''),
  };
}

/**
 * fetchSetlists(date, { artistFilter }) -> { ok, message, shows: [...] }
 *
 * Returns every show elgoose.net has for that date, for the artist asked
 * for. `artistFilter` is the registry's sourceArtistFilter ('goose'); rows
 * belonging to another act in the same archive are dropped before grouping,
 * and the filter fails open if it recognizes nothing (see rowsForArtist).
 *
 * Picking between two shows by the SAME artist on one date is still the
 * caller's job — band-setlist.js disambiguates on venue and says in the
 * response when it had to.
 */
async function fetchSetlists(date, { artistFilter = '' } = {}) {
  const { statusCode, data } = await fetchShowDate(date);

  if (statusCode !== 200) {
    return { ok: false, message: `elgoose.net returned HTTP ${statusCode}`, shows: [] };
  }

  const envelope = readEnvelope(data);
  if (!envelope.ok) {
    return { ok: false, message: envelope.message, shows: [], upstream: envelope.diagnostics };
  }

  const { rows, droppedOtherArtistCount } = rowsForArtist(envelope.rows, artistFilter);

  const shows = groupRowsByShow(rows)
    .map(mapShow)
    // A show kept only because rows were dropped still comes through, so
    // the counts reach the caller and a mapping error is visible. It
    // carries no songs, which is what makes the merge rules leave the
    // existing setlist alone.
    .filter((show) => show.songs.length > 0
      || show.droppedSoundcheckCount > 0
      || show.droppedUntitledCount > 0);

  return {
    ok: true,
    message: '',
    shows,
    // Reported so a caller can see the filter did something — a date where
    // another act in this archive also played is exactly the case that used
    // to be a coin flip.
    droppedOtherArtistCount,
    upstream: envelope.diagnostics,
  };
}

module.exports = { FIELDS, describeUpstream, fetchSetlists, fetchSongfishJson, mapShow, readEnvelope, groupRowsByShow, rowsForArtist };
