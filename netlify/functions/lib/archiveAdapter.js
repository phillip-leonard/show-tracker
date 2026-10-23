/**
 * netlify/functions/lib/archiveAdapter.js
 *
 * The Internet Archive's Grateful Dead collection, as a setlist source.
 * Grateful Dead only: the collection id is the registry's
 * sourceArtistFilter ('GratefulDead'), and no other band is wired to it.
 *
 *   GET https://archive.org/advancedsearch.php
 *         ?q=collection:GratefulDead AND date:<YYYY-MM-DD>
 *         &fl[]=identifier&fl[]=title&fl[]=venue&fl[]=coverage
 *         &fl[]=downloads&fl[]=description&rows=50&output=json
 *   GET https://archive.org/metadata/<identifier>
 *   GET https://archive.org/download/<identifier>/<file>.txt
 *
 * No key and no auth. One identifying User-Agent, the same one
 * archival-audio-lookup.js sends.
 *
 * ── The Archive has recordings, not setlists ──────────────────────────
 *
 * Every item in the collection is one TAPE of a show. A well-taped night
 * has twenty-odd of them (soundboards, audience tapes, matrixes,
 * remasters), each uploaded by a different person with a description in
 * whatever format they liked. So "the Archive's setlist" for a date is
 * something this adapter has to pick out of those items, not something it
 * can read. Checked against ten dates from 1966 to 1995 and a survey of
 * ~2,400 items over four years before this was written (see the PR):
 *
 *   - About 85% of descriptions carry explicit set headers ("Set I:",
 *     "Set 1\n\n", "-Set II-") with songs separated by commas or lines
 *     and segues marked '>' or '->'. That is the format this trusts.
 *   - The most-downloaded item is often the OLDEST upload, whose
 *     description is a generated comma list with no headers at all and
 *     a set break written as a missing comma ("…Row Jimmy, Dancin' In The
 *     Streets Scarlet Begonias->…"). Without a song dictionary there is no
 *     safe way to split that, so it is never parsed — which is why "take
 *     the top item" is the wrong rule and ranking happens below.
 *   - Some descriptions are HTML from an old editor, some lost their line
 *     breaks entirely ("Set 1 Good Morning Little Schoolgirl Death Don't
 *     Have No Mercy Sitting On Top Of The World…"), some are partial
 *     tapes ("excerpt", "partial", "fragment").
 *   - The info .txt file usually has headers when the description doesn't,
 *     in a different format per uploader.
 *   - Track titles on the audio files are the cleanest song names but
 *     carry no set breaks, and include "Tuning", "Stage Banter" and so on.
 *
 * ── How a result is chosen ────────────────────────────────────────────
 *
 *   1. One search request returns every item for the date WITH its
 *      description. Every description is parsed; only parses with
 *      explicit set headers count.
 *   2. Among those, the one that agrees best with the others wins
 *      (summed song-set overlap), so a description with a typo or an extra
 *      reprise loses to the version most uploaders agree on. Complete tapes
 *      beat partial ones; more songs, then more downloads, break ties.
 *   3. Only if no description has headers: the .txt info file of the top
 *      two items, same parser, same rule.
 *   4. Only if that fails too: the track titles of the top complete item,
 *      as one unlabeled set — returned with confidence 'tracks-only', which
 *      the app never auto-applies and the review screen labels as such.
 *
 * Worst case is five requests for a date, once; band-setlist.js caches the
 * answer, including a "nothing found".
 *
 * `confidence` on the result is the contract with the app:
 *   'explicit-sets' – parsed from text with set headers. Auto-applied on a
 *                     new add (unless partial or ambiguous).
 *   'tracks-only'   – a song list with no set structure. Shown for review
 *                     only, never written without the user saying so.
 */

const https = require('https');
const { buildSetlist, cleanStr, pickSetLabel, setSortKey } = require('./bandSetlistShape');

const CONFIG = require('../../../config/internet-archive.json');

const HOSTNAME = 'archive.org';
const COLLECTION = CONFIG.collection;
const USER_AGENT = 'MySetlistsApp/1.0 (https://mysetlists.net; contact@mysetlists.net)';
const REQUEST_TIMEOUT_MS = 10000;
const SEARCH_ROWS = 50;
// How many items' info files to read when no description has set headers.
const TXT_FALLBACK_ITEMS = 2;
// How many items to re-read from the metadata endpoint when the search API
// flattened their description (see fetchSetlists, step 2).
const METADATA_DESCRIPTION_ITEMS = 3;
// How many header-less descriptions to split with their track titles, at
// most, when fewer than two complete candidates have set headers.
const HEADERLESS_ITEMS = 2;
// Fewer songs than this is a fragment of text, not a setlist. The shortest
// real one in the sample is the three-song Human Be-In set, 1967-01-14.
const MIN_SONGS = 3;

// ── The switch ────────────────────────────────────────────────────────
//
// config/internet-archive.json's `enabled`. Checked here as well as in the
// registry and in band-setlist.js, so nothing that reaches this adapter by
// another route (the admin re-sync, a script) can send the Archive a
// request while the source is off.
function isEnabled(config = CONFIG) {
  return !!config && config.enabled === true;
}

// ── HTTP ──────────────────────────────────────────────────────────────

// The pause between two requests to archive.org. Zero for a single lookup,
// which makes its 2–5 requests one after another and has a Netlify window
// to answer in. A bulk walk (the admin re-sync) sets it with setRequestGap,
// so a backfill of hundreds of dates never sends more than one request a
// second, cache misses included.
let requestGapMs = 0;
let lastRequestAt = 0;

function setRequestGap(ms) {
  requestGapMs = Math.max(0, Number(ms) || 0);
}

function getRequestGap() {
  return requestGapMs;
}

async function waitForGap() {
  const wait = lastRequestAt + requestGapMs - Date.now();
  if (requestGapMs > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function archiveGet(path, opts) {
  await waitForGap();
  return archiveRequest(path, opts);
}

function archiveRequest(path, { json = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: HOSTNAME, path, method: 'GET', headers: { Accept: json ? 'application/json' : 'text/plain', 'User-Agent': USER_AGENT } },
      (res) => {
        // The download endpoint redirects to a storage node. Followed once,
        // and only to an archive.org host.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let next;
          try { next = new URL(res.headers.location, `https://${HOSTNAME}`); } catch { next = null; }
          if (!next || !/(^|\.)archive\.org$/i.test(next.hostname)) {
            reject(new Error('Internet Archive redirected somewhere unexpected'));
            return;
          }
          followOnce(next, json).then(resolve, reject);
          return;
        }
        collect(res, json).then(resolve, reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Internet Archive request timed out'));
    });
    req.end();
  });
}

function followOnce(url, json) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT } }, (res) => {
      collect(res, json).then(resolve, reject);
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Internet Archive request timed out'));
    });
    req.end();
  });
}

function collect(res, json) {
  return new Promise((resolve, reject) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      // 429 and 5xx are the Archive being busy, not an answer about the
      // show. Thrown, so band-setlist.js serves stale cache or a 502 and
      // nothing is cached as "not found".
      if (res.statusCode === 429) { reject(new Error('Internet Archive is rate-limiting requests; try again later')); return; }
      if (res.statusCode >= 500) { reject(new Error(`Internet Archive returned HTTP ${res.statusCode}`)); return; }
      if (!json) { resolve({ statusCode: res.statusCode, data }); return; }
      try {
        resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
      } catch (e) {
        reject(new Error(`Failed to parse Internet Archive response: ${e.message}`));
      }
    });
    res.on('error', reject);
  });
}

function searchPath(date) {
  const params = new URLSearchParams();
  params.set('q', `collection:${COLLECTION} AND date:${date}`);
  ['identifier', 'title', 'venue', 'coverage', 'downloads', 'description', 'source', 'licenseurl'].forEach((f) => params.append('fl[]', f));
  params.set('sort[]', 'downloads desc');
  params.set('rows', String(SEARCH_ROWS));
  params.set('output', 'json');
  return `/advancedsearch.php?${params.toString()}`;
}

// ── Text clean-up ─────────────────────────────────────────────────────

// Like bandSetlistShape's stripHtml, except that closing </span> is also a
// line break: the old Archive editor wrote "<span>Set I</span><div><span>
// Morning Dew, …" and without it the header and the first song run
// together as "Set IMorning Dew".
function htmlToText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|span|h\d|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;| /gi, ' ')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

const ROMAN_TO_INT = { i: 1, ii: 2, iii: 3, iv: 4 };
const WORD_TO_INT = { one: 1, two: 2, three: 3, four: 4, first: 1, second: 2, third: 3, '1st': 1, '2nd': 2, '3rd': 3 };

function headerNumber(raw) {
  const s = String(raw || '').toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  return ROMAN_TO_INT[s] || WORD_TO_INT[s] || 1;
}

// A set header at the start of a line, with whatever follows it on the same
// line returned as `rest` ("Set I: Promised Land, Sugaree, …").
// Covers "Set 1", "Set I:", "-Set II-", "Set:One", "SET 2 cont.",
// "First Set", "2nd set:", "Disc 1 Set 1" (the disc prefix is dropped).
const SET_HEADER = /^[\s\-*=[(<]*(?:(?:dis[ck]|cd)\s*\d+\s*[-:,]?\s*)?(?:set\s*[:#.]?\s*(\d|iv|i{1,3}|one|two|three|four)\b|(first|second|third|1st|2nd|3rd)\s+set\b)\s*(?:\(?\s*cont(?:inued|'d|\.)?\s*\)?)?\s*[-:.)\]=>]*\s*/i;

// An encore header or an inline encore marker: "Encore:", "Encore 2",
// "E:", "E1:", "E2: Saturday Night". A bare "E" needs its colon, so a song
// that starts with E is never read as one.
const ENCORE_HEADER = /^[\s\-*=[(]*(?:encores?(?:\(s\))?\b\s*(\d|ii?|one|two)?|e(\d)?\s*:)\s*[-:.)\]]*\s*/i;

// A band-member line ("Jerry Garcia - Guitar", "Bob Weir: vocals"), which
// ends the setlist in descriptions that list the lineup after it.
const PERSONNEL = /\s[-–:]\s*(?:lead\s+|rhythm\s+|acoustic\s+|pedal\s+steel\s+)?(guitars?|bass|drums?|keyboards?|keys|vocals?|piano|organ|percussion|harmonica|saxophone|sax)\b/i;

// Lines that end the setlist once songs have started (and are skipped
// before). Taper notes follow the setlist in nearly every info file.
const STOP_LINE = /^[\s\-*=]*(w\/|other\s+artists?|comments?|general\s+comments?|notes?|footnotes?|musicians|band\s+members|source|lineage|transfer(?:red)?|taper|recorded\s+by|recording|other\s+artist|flaws?|shntool|md5|ffp|seeded|band\s*line\s*-?up|personnel|thanks?|conversion|editing|equipment|location|mics?|uploaded|checksum|info)\b\s*[:(-]?/i;

// More than one set header on a single line means the line breaks were
// lost ("Set I Morning Dew Good Morning Little Schoolgirl Dark Star > …
// Set II Cryptical …"), and the song boundaries with them.
const INLINE_SET_HEADER = /\bset\s*[:#.]?\s*(?:\d|iv|i{1,3}|one|two|three|four)\b/gi;

// Lines that are layout, not content: disc labels, rules, bare times.
const IGNORE_LINE = /^[\s\-=_*~.]*$|^[\s\-*]*(dis[ck]|cd|side|tape|reel)\s*[#]?\s*\d+\b[^a-z]*(\(.*\))?[^a-z]*$|^[\s[(]*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]*\s*$|^\s*total\s*(time|length)?\b/i;

// Not songs. Drums, Space and Jam ARE songs in every Grateful Dead archive
// (and in the app's own song index), so they are deliberately absent.
const NOISE = /\b(tuning|tune[\s-]?up|banter|stage\s+(?:chatter|announcements?|annoucements?|chaos|rap)|announcements?|crowd|dead\s+air|applause|intro(?:duction)?s?|band\s+intros?|set\s*break|encore\s*break|closing\s+remarks|final\s+remarks|rap|silence|break|filler|soundcheck|teases?)\b/i;

// Taper spellings of a handful of titles that otherwise split the song
// index ("Drumz" and "Drums" are one song). Kept short on purpose: only
// abbreviations the archives themselves agree are the same song.
const TITLE_ALIASES = {
  drumz: 'Drums',
  'saturday night': 'One More Saturday Night',
  playin: "Playin' in the Band",
  'greatest story': 'Greatest Story Ever Told',
  'touch of gray': 'Touch of Grey',
  'other one': 'The Other One',
};

// A cleaned name longer than this is not one song — it is a line whose
// separators were lost ("Set 1 Good Morning Little Schoolgirl Death Don't
// Have No Mercy …"). The longest real title in the sample, "Stuck Inside
// Of Mobile With The Memphis Blues Again", is 52 characters.
const MAX_TITLE_CHARS = 60;
const MAX_TITLE_WORDS = 10;

// Times, bracketed or not: "[ 4:14.13]", "(6:15)", "05:05.32". Removed
// before track numbers, or the "14:" of "14:50.59" reads as track 14.
const TIME = /[[(]?\s*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*[\])]?/g;

// Track numbering: "d1t01 -", "1.", "01)", "t03", "2 -".
function stripNumbering(raw) {
  return String(raw == null ? '' : raw)
    .replace(TIME, ' ')
    .replace(/^\s*(?:d\d+\s*t\d+|t\d+|\d{1,2}\s*[.):]|\d{1,2}\s+-|\d{1,2}\s+(?=[A-Z]))\s*[-.:]*\s*/i, '');
}

// Footnote markers tapers put after a title ("Playin' In The Band *",
// "Sugar Magnolia $"), and at the start of the footnote line itself.
const FOOTNOTE_MARKS = /[*#@%^+~§†$&]+/;

function cleanTitle(raw) {
  let s = stripNumbering(raw).replace(/\s+/g, ' ').trim();
  // Cut-tape slashes and footnote markers at either end.
  s = s.replace(/^[/\s]+|[/\s]+$/g, '')
    .replace(new RegExp(`${FOOTNOTE_MARKS.source}$`), '')
    .replace(new RegExp(`^${FOOTNOTE_MARKS.source}`), '')
    .trim();
  // Surrounding double quotes only: a trailing apostrophe is part of the
  // title in "Smokestack Lightnin'" and "Good Lovin'".
  s = s.replace(/^"+|"+$/g, '').trim();
  // A trailing comma or full stop from a numbered list ("Box Of Rain,",
  // "Turn On Your Lovelight."), but not the stop in "U.S. Blues".
  s = s.replace(/,+$/, '').replace(/(?:\.{2,}|…)$/, '').replace(/(?<![A-Z])\.$/, '').trim();
  // What is left of a time or a disc total is not a title.
  if (/^[\d\s.:]*$/.test(s)) return '';
  s = s.split(SAFE_COMMA).join(',');
  const alias = TITLE_ALIASES[s.toLowerCase()];
  return alias || s;
}

// Words that mark a line as taper prose rather than a title. Song titles
// in this catalogue never contain them; lineage notes nearly always do.
const PROSE = /\b(encod\w*|transferr?\w*|record(?:ed|ing)|master(?:ed|ing)?|seeded|patch(?:ed|es)?|splices?|spliced|remaster\w*|lineage|generation|tapes?|taped|taper|reels?|mix-?down|ampex|uploaded|thanks|requires|minute)\b/i;

// Recording-chain vocabulary. Two of these on one line is a lineage
// ("Nak 300 > D5 > CM > CDR"), never a run of segues.
const GEAR = /\b(DAT|CDRs?|SBD|AUD|MC|MR|PCM|WAV|FLAC|SHN|EAC|DAE|Nak(?:amichi)?|Sony|Tascam|Schoeps|Sennheiser|Neumann|cassettes?|dbx|Dolby|kHz|\d+\s?bit|ips|DDS|ADC|DAC)\b/gi;

function isLineage(line) {
  const hits = String(line).match(GEAR);
  return !!hits && hits.length >= 2;
}

// A date or a year in a "title" is a note ("Culled from a May 6, 1999
// post …"). No Grateful Dead song title carries either.
const DATE_LIKE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b(?:19|20)\d{2}\b/i;

const TITLE_ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt)\./g;

function looksLikeTitle(name) {
  if (!name) return false;
  if (name.length > MAX_TITLE_CHARS) return false;
  if (name.split(/\s+/).length > MAX_TITLE_WORDS) return false;
  // URLs, emails and semicolon-joined notes are not song titles.
  if (/https?:|www\.|@|;/.test(name)) return false;
  if (PROSE.test(name) || DATE_LIKE.test(name) || PERSONNEL.test(name)) return false;
  // A sentence: a full stop after a lowercase letter, then a capital
  // ("Late show. Though actually all one set"). "U.S. Blues" has its stop
  // after a capital.
  // "Dear Mr. Fantasy" and "St. Stephen" are titles, so the stop of a
  // title abbreviation doesn't count.
  const unabbreviated = name.replace(TITLE_ABBREVIATIONS, '$1');
  if (/[a-z]\.\s+[A-Z]/.test(unabbreviated) || /\b(though|actually|which|segments?)\b/i.test(name)) return false;
  // A set header inside a "title" is two songs and a header run together.
  if (/\bset\s*(?:\d|iv|i{1,3})\b/i.test(name)) return false;
  return /[a-z]/i.test(name);
}

// Tapers annotate a track in parentheses: "Minglewood Blues -> (AUD splice
// provides beginning of track)", "Sugar Magnolia (cut)". Those notes go;
// a parenthetical that is part of the title ("Caution (Do Not Stop On
// Tracks)") has none of the note vocabulary and stays.
function stripNotes(text) {
  return String(text).replace(/\s*\(([^)]*)\)/g, (whole, inner) => (
    PROSE.test(inner) || isLineage(inner) || /\b(splice|aud|sbd|cut|fades?|partial|missing|w\/|with|incomplete|patch|tk|track|first|last)\b|\d/i.test(inner)
      ? ''
      : whole
  ));
}

// The few titles in this repertoire with a comma of their own. Their comma
// becomes U+201A (looks the same, isn't a separator) so splitting on
// commas leaves them whole; cleanTitle turns it back.
const COMMA_TITLES = [
  /it'?s all over now,\s*baby blue/gi,
  /don'?t think twice,\s*it'?s all right/gi,
];
const SAFE_COMMA = '‚';

function protectCommaTitles(text) {
  return COMMA_TITLES.reduce((acc, re) => acc.replace(re, (m) => m.replace(/,\s*/, `${SAFE_COMMA} `)), text);
}

/**
 * Splits one chunk of a set ("Scarlet Begonias-> Fire On The Mountain,
 * Estimated Prophet") into songs with their transition marks. '->' and
 * '>' are kept apart, as bandSetlistShape's parseTransition expects.
 */
function splitChunk(text) {
  const items = [];
  // An encore marker mid-line with no comma before it ("Morning Dew E: One
  // More Saturday Night", where a line break was flattened away) starts a
  // new item, the same as a comma would.
  const separated = protectCommaTitles(stripNotes(text))
    .replace(/\s+(?=(?:E\d?|Encore(?:\s*\d)?)\s*:\s)/g, ', ')
    // "Morning Dew % Good Morning Little Schoolgirl % Dark Star ->",
    // "Drums#Space": a % or # with a title on both sides separates two
    // songs. At the end of a title it is a footnote mark, which cleanTitle
    // strips.
    .replace(/(?<=[A-Za-z')])\s*[%#]+\s*(?=[A-Za-z])/g, ', ');
  for (const part of separated.split(/\s*,\s*/)) {
    if (!part.trim()) continue;
    const pieces = part.split(/(\s*-*>+\s*)/);
    for (let i = 0; i < pieces.length; i += 2) {
      const mark = pieces[i + 1] ? pieces[i + 1].trim().replace(/^-+>+$/, '->').replace(/^>+$/, '>') : '';
      items.push({ raw: pieces[i], transition: mark });
    }
  }
  return items;
}

// A venue name on its own line after the setlist, when it is not the
// venue the item's metadata names ("Cornell University" under an item
// whose venue is "Barton Hall"). No Grateful Dead title ends in one of
// these words.
const VENUE_LINE = /\b(university|college|hall|arena|stadium|theat(?:re|er)|coliseum|auditorium|cent(?:er|re)|fairgrounds?|pavilion|gardens|amphitheat(?:re|er)|ballroom|speedway|armory|gymnasium|fieldhouse)$/i;

// The flattened form of the same problem: the venue line joined onto the
// last song ("One More Saturday Night Cornell University").
function stripTrailingIgnored(name, ignoreKeys) {
  const words = name.split(' ');
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    if (ignoreKeys.has(songKey(words.slice(-n).join(' ')))) return words.slice(0, -n).join(' ');
  }
  return name;
}

const LAYOUT_TOKEN = /^(?:dis[ck]|cd|side|tape|reel)\s*[#]?\s*(?:\d+|[a-d])$/i;

/**
 * Reads one chunk into song items without touching any state, so a caller
 * can decide whether to keep them. An inline encore marker ("E1: Casey
 * Jones") comes back on the item as `encore`.
 */
function readItems(chunk, { lenient = false, ignoreKeys = null } = {}) {
  const items = [];
  let bad = '';
  for (const item of splitChunk(chunk)) {
    // Numbering off first, so "5. E:Knockin' On Heaven's Door" is seen as
    // an encore marker.
    let raw = stripNumbering(item.raw).trim();
    let encore = null;
    const enc = raw.match(ENCORE_HEADER);
    if (enc && enc[0].trim()) {
      encore = headerNumber(enc[1] || enc[2] || '1');
      raw = raw.slice(enc[0].length);
    }
    const name = cleanTitle(raw);
    // "Set 1, disc 1", "Side B": layout that rode along on a header line.
    if (LAYOUT_TOKEN.test(name)) continue;
    if (!name) {
      // A bare mark ("Let It Grow" on one line, "->" on the next) belongs
      // to the song before it.
      if (item.transition) items.push({ markOnly: item.transition, encore });
      continue;
    }
    if (!looksLikeTitle(name)) {
      if (lenient) continue;
      bad = `"${name.slice(0, 40)}" is not a song title`;
      break;
    }
    if (NOISE.test(name) || VENUE_LINE.test(name)) continue;
    if (ignoreKeys && ignoreKeys.has(songKey(name))) continue;
    items.push({ name: ignoreKeys ? stripTrailingIgnored(name, ignoreKeys) : name, transition: item.transition, encore });
  }
  return { items, bad };
}

/**
 * parseSetlistText(text, { lenient }) -> {
 *   explicit,        // true when songs sit under at least one set header
 *   sets: [{ type: 'set'|'encore', number, songs: [{ name, transition }] }],
 *   songCount,
 *   rejected,        // why the text could not be used, or ''
 * }
 *
 * Pure; never throws. Songs are collected only after a set header, so an
 * info file's preamble (band, venue, source, lineage) is skipped without
 * having to recognise every way people write it. Once songs have started,
 * a notes-style line ends the setlist.
 *
 * A false start is undone rather than fatal: taper notes say things like
 * "-- Set 2 may be from a PCM master", and a matrix info file has an
 * audience "Set 1" section full of lineage before the real setlist. Until
 * the first song is kept, anything that is not a song resets the parse and
 * scanning carries on.
 *
 * `lenient` skips a line that isn't a title instead of rejecting the text.
 * Used for track titles, where one odd title should not cost the rest.
 *
 * `endOnProse` ends the setlist at the first line after the songs that
 * isn't a title, instead of rejecting the text. Used for info files, which
 * always continue into notes in some unpredictable wording. Descriptions
 * stay strict: there, a line that isn't a title means the format is not
 * one this understands.
 *
 * `ignore` is a list of strings that are not songs even though they look
 * like titles — the item's venue and city, which uploaders often put on
 * a line after the setlist ("… E: One More Saturday Night\n\nCornell
 * University").
 */
function parseSetlistText(rawText, { lenient = false, endOnProse = false, ignore = [] } = {}) {
  const ignoreKeys = new Set(
    ignore.flatMap((v) => String(v || '').split(/,|\s[-–]\s/)).map(songKey).filter((k) => k.length > 3)
  );
  let text = htmlToText(rawText);
  if (!endOnProse) {
    // Notes appended after the setlist ("… E: Cosmic Charlie Other
    // artist(s): GD; Pentangle"). Cut from the first marker that comes
    // after a set header; before one, they are preamble and harmless.
    const firstHeader = text.search(INLINE_SET_HEADER);
    if (firstHeader >= 0) {
      const tail = text.slice(firstHeader).search(/\b(?:other\s+artist\(s\)|comments?\b|notes?\s*:|source\s*:|lineage\s*:|taper\s*:|transfer\w*\s*:)/i);
      if (tail > 0) text = text.slice(0, firstHeader + tail);
    }
  }
  const lines = [];
  for (const line of text.split('\n')) {
    const headers = (line.match(INLINE_SET_HEADER) || []).length;
    // Descriptions only: info-file prose says things like "Set 2 may be
    // from a different master than Set 1", which the false-start reset
    // below handles.
    if (endOnProse || headers < 2) { lines.push(line); continue; }
    // Several headers on one line. With commas between the songs, the
    // headers are the only thing missing a separator ("…, Let It Grow Set 2
    // Iko Iko->…"), so breaking the line before each one restores it. With
    // no commas, the line breaks between songs are gone too — the search
    // API flattens them — and there is nothing to split songs on.
    if ((line.match(/,/g) || []).length < 2) {
      return { explicit: false, sets: [], songCount: 0, rejected: 'several set headers on one line' };
    }
    line.replace(INLINE_SET_HEADER, '\n$&').split('\n').forEach((l) => lines.push(l));
  }
  let sets = [];
  let current = null;
  let started = false;
  let rejected = '';

  const songTotal = () => sets.reduce((n, s) => n + s.songs.length, 0);
  const reset = () => { sets = []; current = null; started = false; };

  const openSet = (type, number) => {
    // "Set 2 cont." and a repeated header continue the same set.
    const existing = sets.find((s) => s.type === type && s.number === number);
    current = existing || { type, number, songs: [] };
    if (!existing) sets.push(current);
    started = true;
  };

  // Commits items read by readItems. Returns false when the text has to
  // stop here.
  const commit = (chunk, { newParagraph = false } = {}) => {
    const { items, bad } = readItems(chunk, { lenient, ignoreKeys });
    if (bad) {
      if (songTotal() === 0) { reset(); return true; }
      // A paragraph of notes after a whole setlist ("w/ David Crosby;
      // Other artist on bill: NRPS"). Flattened text, the case strictness
      // is for, has no blank lines to start a paragraph with.
      if (newParagraph && items.length === 0 && songTotal() >= MIN_SONGS) return false;
      if (!endOnProse) rejected = bad;
      return false;
    }
    for (const item of items) {
      if (item.encore != null) openSet('encore', item.encore);
      if (item.markOnly) {
        const prev = current && current.songs[current.songs.length - 1];
        if (prev && !prev.transition) prev.transition = item.markOnly;
        continue;
      }
      if (!current) openSet('set', 1);
      current.songs.push({ name: item.name, transition: item.transition });
    }
    return true;
  };

  let blankBefore = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t+/g, '  ').trim();
    if (!line) { blankBefore = true; continue; }
    const newParagraph = blankBefore;
    blankBefore = false;

    if (isLineage(line)) {
      if (songTotal() === 0) { reset(); continue; }
      break;
    }

    const setMatch = line.match(SET_HEADER);
    // "Set III is with Merl Saunders…" is a sentence about a set, not a
    // header: what follows a real header is a title or a track number,
    // and neither starts with a lowercase word.
    const isSentence = setMatch && /^[a-z]{2,}\b/.test(stripNumbering(line.slice(setMatch[0].length)).trim());
    if (setMatch && !isSentence) {
      openSet('set', headerNumber(setMatch[1] || setMatch[2]));
      const rest = line.slice(setMatch[0].length).trim();
      if (rest && !IGNORE_LINE.test(rest) && !/^\(.*\)$/.test(rest) && !commit(rest)) break;
      continue;
    }

    // An encore header counts once a set is open. "Encore" before any set
    // is not enough to call the text structured, and a bare "E:" before
    // any set is the header-less comma format, which is never parsed.
    const encMatch = line.match(ENCORE_HEADER);
    if (encMatch && encMatch[0].trim() && started) {
      openSet('encore', headerNumber(encMatch[1] || encMatch[2] || '1'));
      const rest = line.slice(encMatch[0].length).trim();
      if (rest && !IGNORE_LINE.test(rest) && !commit(rest)) break;
      continue;
    }

    if (!started) continue;
    if (STOP_LINE.test(line) || PERSONNEL.test(line)) {
      if (songTotal() === 0) { reset(); continue; }
      break;
    }
    if (IGNORE_LINE.test(line)) continue;
    // Footnote lines ("*w/ Bob Weir on acoustic", "* Some minor static in
    // bursts…") come after the songs they annotate, so once songs have
    // started one ends the setlist; whatever follows is the footnote's own
    // list ("- Ramble On Rose 4:07").
    if (new RegExp(`^${FOOTNOTE_MARKS.source}`).test(line)) {
      if (songTotal() >= MIN_SONGS) break;
      continue;
    }
    // An indented lowercase line is a note on the track above it
    // ("      announced by Bill Graham").
    if (/^\s{2,}[a-z]/.test(rawLine)) continue;

    if (!commit(line, { newParagraph })) break;
  }

  // A trailing header with nothing under it is a set the tape didn't
  // reach ("… And We Bid You Good Night Set 2"). Dropped, not fatal.
  while (sets.length && sets[sets.length - 1].songs.length === 0) sets.pop();
  if (!rejected && sets.some((s) => s.songs.length === 0)) rejected = 'a set header with no songs under it';

  if (rejected) return { explicit: false, sets: [], songCount: 0, rejected };

  // The last song of the show has nothing to segue into.
  const last = sets.length ? sets[sets.length - 1].songs.slice(-1)[0] : null;
  if (last) last.transition = '';

  return {
    explicit: sets.some((s) => s.type === 'set'),
    sets,
    songCount: songTotal(),
    rejected: '',
  };
}

// ── Picking one setlist out of many tapes ─────────────────────────────

const PARTIAL = /\b(partial|excerpts?|incomplete|fragments?|filler|snippets?)\b/i;

// A one-set tape says so in its identifier: "gd1985-06-24.140890.s1.…",
// "gd85-06-24.set2.oade-schoeps.…".
const ONE_SET_SEGMENT = /^(?:s|set)\d[p]?$/i;

function isPartialItem(doc) {
  const identifier = String(doc.identifier || '');
  return PARTIAL.test(identifier) || PARTIAL.test(String(doc.title || ''))
    || identifier.split('.').some((seg) => ONE_SET_SEGMENT.test(seg))
    || /\b(?:1st|2nd|3rd|first|second|third)[\s._-]*set\b/i.test(identifier.replace(/\./g, ' '))
    || PARTIAL.test(String(Array.isArray(doc.description) ? doc.description.join(' ') : doc.description || '').slice(0, 200));
}

// A setlist whose first set is not Set 1 ("Set II" alone, 1969-11-08's
// s2p tape) is the part of the show this tape reached, whatever its name
// says.
function startsAfterSetOne(parsed) {
  const sets = parsed && Array.isArray(parsed.sets) ? parsed.sets.filter((x) => x.type === 'set') : [];
  return sets.length > 0 && !sets.some((x) => x.number === 1);
}

// Early/late shows on one date are separate shows on separate tapes. The
// title, the venue or the identifier usually says which ("Fillmore East
// (Late Show)", "gd1970-02-13.early.sbd…"). A tape that names both
// ("early-late") covers the two shows and belongs to neither.
function showSlotOf(doc) {
  const text = [doc.title, doc.venue, String(doc.identifier || '').replace(/[._]/g, ' ')].join(' ').toLowerCase();
  const early = /\bearly(?:\s*show)?\b/.test(text);
  const late = /\blate(?:\s*show)?\b|\blateshow\b/.test(text);
  if (early && late) return '';
  return early ? 'early' : late ? 'late' : '';
}

function songKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Drums, Space and Jam are songs, but uploaders disagree about writing
// them down (most descriptions of 1982-08-10 leave out the Space its track
// list has), so they don't count for or against two tapes agreeing.
// Compared on looseKey (see "Header-less lists"), so "Playing In The Band"
// and "Playin' In The Band" are one song and a spelling is never a
// disagreement.
const SOFT_KEYS = new Set(['drums', 'space', 'jam', 'rhythmdevils', 'drumz']);

function keySet(parsed) {
  return new Set(parsed.sets.flatMap((s) => s.songs.map((song) => looseKey(song.name))).filter((k) => k && !SOFT_KEYS.has(k)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((k) => { if (b.has(k)) shared++; });
  return shared / (a.size + b.size - shared);
}

// What kind of tape an item is, from its identifier first ("sbd", "mtx",
// "aud" are how the collection names them) and its `source` text second.
// A tape that names both a board and an audience source is a matrix.
function sourceTypeOf(doc) {
  const tokens = String(doc.identifier || '').toLowerCase().split(/[.\-_]+/);
  const has = (...words) => words.some((w) => tokens.includes(w));
  if (has('mtx', 'matrix', 'ultramatrix') || (has('sbd') && has('aud'))) return 'matrix';
  if (has('sbd', 'soundboard')) return 'sbd';
  if (has('aud')) return 'aud';
  const source = String(Array.isArray(doc.source) ? doc.source.join(' ') : doc.source || '').toLowerCase();
  if (/matrix/.test(source)) return 'matrix';
  if (/\bsbd\b|soundboard/.test(source)) return 'sbd';
  return 'aud';
}

const SOURCE_TYPE_RANK = { sbd: 0, matrix: 1, aud: 2 };

// Two tapes of one show disagree when they share less than this much of
// their songs (Drums, Space and Jam aside), or their song counts differ by
// more than DISAGREE_COUNT_GAP.
const AGREE_OVERLAP = 0.85;
const DISAGREE_COUNT_GAP = 2;

/**
 * rankCandidates(candidates) -> candidates sorted best first.
 *
 * Each candidate is { doc, parsed, partial, inferred }. The rule, in order,
 * every step deterministic so a re-run picks the same tape:
 *
 *   1. complete tapes before partial ones
 *   2. tapes not much shorter than the fullest one
 *   3. set breaks written by the uploader before set breaks inferred from
 *      a header-less list (inferred ones still count toward agreement)
 *   4. agreement with the other candidates (Drums/Space/Jam aside), so a
 *      typo or an extra reprise on one upload loses to the version the
 *      rest agree on
 *   5. soundboard, then matrix, then audience
 *   6. downloads
 *   7. identifier, so a tie never depends on the order the search returned
 */
function rankCandidates(candidates) {
  const keys = candidates.map((c) => keySet(c.parsed));
  // A tape that is much shorter than the fullest one is a partial tape even
  // when nothing in its name says so, and two set-1-only uploads agree with
  // each other perfectly. So shortness is ranked before agreement.
  const maxSongs = Math.max(0, ...candidates.map((c) => c.parsed.songCount));
  const scored = candidates.map((c, i) => {
    let agreement = 0;
    keys.forEach((k, j) => { if (j !== i) agreement += overlap(keys[i], k); });
    const short = c.parsed.songCount < maxSongs * 0.8;
    return { ...c, agreement, short, sourceType: sourceTypeOf(c.doc) };
  });
  return scored.sort((a, b) => {
    if (a.partial !== b.partial) return a.partial ? 1 : -1;
    if (a.short !== b.short) return a.short ? 1 : -1;
    if (!!a.inferred !== !!b.inferred) return a.inferred ? 1 : -1;
    if (Math.abs(b.agreement - a.agreement) > 0.05) return b.agreement - a.agreement;
    if (SOURCE_TYPE_RANK[a.sourceType] !== SOURCE_TYPE_RANK[b.sourceType]) {
      return SOURCE_TYPE_RANK[a.sourceType] - SOURCE_TYPE_RANK[b.sourceType];
    }
    const downloads = (Number(b.doc.downloads) || 0) - (Number(a.doc.downloads) || 0);
    if (downloads !== 0) return downloads;
    return String(a.doc.identifier).localeCompare(String(b.doc.identifier));
  });
}

/**
 * disagreementOf(ranked) -> null | { with, overlap, songCounts }
 *
 * Whether the chosen tape and the best other complete tape tell different
 * stories. One complete tape has nothing to disagree with, so null.
 */
function disagreementOf(ranked) {
  const [best, ...rest] = ranked;
  if (!best || best.partial) return null;
  const other = rest.find((c) => !c.partial && !c.short);
  if (!other) return null;
  const a = keySet(best.parsed);
  const b = keySet(other.parsed);
  const shared = overlap(a, b);
  if (shared >= AGREE_OVERLAP && Math.abs(a.size - b.size) <= DISAGREE_COUNT_GAP) return null;
  return { with: String(other.doc.identifier), overlap: Math.round(shared * 100) / 100, songCounts: [a.size, b.size] };
}

function venueKey(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/theatre/g, 'theater')
    .replace(/centre/g, 'center')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefer items at the venue the caller asked about, when any match. Venue
// spellings differ between uploaders ("JFK Stadium", "John F Kennedy
// Stadium"), so a venue that matches nothing filters nothing.
function filterByVenue(docs, venue) {
  const wanted = venueKey(venue);
  if (!wanted) return docs;
  const matched = docs.filter((d) => {
    const v = venueKey(d.venue);
    return v && (v === wanted || v.includes(wanted) || wanted.includes(v));
  });
  return matched.length ? matched : docs;
}

function splitCoverage(coverage) {
  const parts = String(coverage || '').split(',').map((p) => p.trim()).filter(Boolean);
  return { city: parts[0] || '', state: parts[1] || '', country: parts.length > 2 ? parts[parts.length - 1] : '' };
}

function permalinkFor(identifier) {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

/**
 * Turns a chosen parse into the show object band-setlist.js expects —
 * the same shape songfishAdapter.mapShow returns, plus the three fields
 * that only this source has.
 */
function mapShow(doc, parsed, { confidence, parsedFrom, partial, itemCount, candidateCount = 0, disagreement = null }) {
  const rows = [];
  for (const set of parsed.sets) {
    set.songs.forEach((song, index) => {
      rows.push({
        set: pickSetLabel(set.type, set.number),
        setSortKey: setSortKey(set.type, set.number),
        position: index + 1,
        name: song.name,
        transition: song.transition,
        cover: null,
      });
    });
  }
  const { songs, droppedSoundcheckCount, droppedUntitledCount } = buildSetlist(rows);
  const { city, state, country } = splitCoverage(doc.coverage);

  return {
    source: 'archive',
    songs,
    droppedSoundcheckCount,
    droppedUntitledCount,
    showDate: '',
    venue: cleanStr(doc.venue),
    city,
    state,
    country,
    tour: '',
    sourceShowId: cleanStr(doc.identifier),
    sourcePermalink: permalinkFor(doc.identifier),
    setlistNotes: '',
    confidence,
    parsedFrom,
    partial: !!partial,
    itemCount,
    // How many tapes produced a setlist, and whether the best two tell
    // different stories. A disagreement is what `needsReview` means: the
    // rule still picked one, but a person should look.
    candidateCount,
    disagreement,
    needsReview: !!disagreement,
    sourceType: sourceTypeOf(doc),
    // Every item checked in the collection has an empty licenseurl, so this
    // is null today; stored anyway, so a licensed upload is credited as one.
    licenseUrl: cleanStr(doc.licenseurl) || null,
  };
}

// ── Track-title fallback ──────────────────────────────────────────────

const AUDIO_FORMATS = /^(flac|24bit flac|shorten|vbr mp3|wave|ogg vorbis)$/i;

function tracksFromMetadata(meta) {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const audio = files.filter((f) => f && f.title && AUDIO_FORMATS.test(String(f.format || '')));
  // Each track exists in several formats; keep the format with the most
  // titled tracks, in track order.
  const byFormat = new Map();
  audio.forEach((f) => {
    const k = String(f.format).toLowerCase();
    if (!byFormat.has(k)) byFormat.set(k, []);
    byFormat.get(k).push(f);
  });
  let best = [];
  byFormat.forEach((list) => { if (list.length > best.length) best = list; });
  best.sort((a, b) => (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || String(a.name).localeCompare(String(b.name)));
  const text = best.map((f) => f.title).join('\n');
  // Reuse the parser with a synthetic header; the caller marks the result
  // 'tracks-only', so the header is never mistaken for a real set break.
  return parseSetlistText(`Set 1\n${text}`, { lenient: true });
}

// ── Header-less lists ─────────────────────────────────────────────────
//
// The most-downloaded tape of a night often has the oldest description
// format: one comma list, no set headers, and a set break written as a
// missing comma ("…, Row Jimmy, Dancin' In The Streets Scarlet Begonias->
// Fire On The Mountain, …"). Nothing in the text says where one title ends
// and the next begins. The same item's track titles do: split a piece only
// where both halves are titles of that tape, and only when there is exactly
// one such place.
//
// The result is marked `inferred`. It counts toward agreement between
// tapes, but a setlist whose set breaks were inferred is never written on
// an add without the user seeing it.

// Spelling-tolerant key for comparing a description's title with a track
// title: "Dancin' In The Streets" / "Dancing in the Streets", "Saint
// Stephen" / "St. Stephen", "Touch Of Gray" / "Touch of Grey".
function looseKey(name) {
  const words = String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w === 'saint' ? 'st' : w === 'gray' ? 'grey' : w.replace(/ing$/, 'in')));
  if (words[0] === 'the' && words.length > 1) words.shift();
  return words.join('');
}

const MAX_UNKNOWN_SHARE = 0.25;

/**
 * splitHeaderless(text, trackTitles) -> the parseSetlistText shape, plus
 * `inferred: true` on success. Refuses (`explicit: false`, `rejected`)
 * anything it can't split with certainty.
 */
function splitHeaderless(rawText, trackTitles) {
  const fail = (rejected) => ({ explicit: false, inferred: false, sets: [], songCount: 0, rejected });
  const vocab = new Set((trackTitles || []).map(looseKey).filter(Boolean));
  if (vocab.size < MIN_SONGS) return fail('no track titles to split with');

  const text = htmlToText(rawText);
  // Text with set headers is parseSetlistText's.
  if (text.search(INLINE_SET_HEADER) >= 0) return fail('has set headers');
  // The list is the first paragraph with a run of commas in it, plus any
  // paragraphs right after it that start with an encore marker ("Sugar
  // Magnolia\n\n E: Black Muddy River, Box Of Rain").
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());
  const first = paragraphs.findIndex((p) => (p.match(/,/g) || []).length >= 4);
  if (first < 0) return fail('no comma list');
  let paragraph = paragraphs[first];
  for (let i = first + 1; i < paragraphs.length && /^(?:E\d?|Encores?)\s*:/i.test(paragraphs[i]); i++) {
    paragraph += `, ${paragraphs[i]}`;
  }

  // A shorter spelling of a track title ("Saturday Night" for "One More
  // Saturday Night", "Minglewood Blues" for "New Minglewood Blues") is the
  // same song. Only that direction: a piece that CONTAINS a title is what a
  // set break looks like.
  const known = (key) => vocab.has(key) || (key.length >= 8 && [...vocab].some((v) => v.length > key.length && v.includes(key)));

  const sets = [{ type: 'set', number: 1, songs: [] }];
  let current = sets[0];
  let total = 0;
  let unknown = 0;

  for (const item of splitChunk(paragraph)) {
    let raw = stripNumbering(item.raw).trim();
    const enc = raw.match(ENCORE_HEADER);
    if (enc && enc[0].trim()) {
      const number = headerNumber(enc[1] || enc[2] || '1');
      current = sets.find((x) => x.type === 'encore' && x.number === number);
      if (!current) { current = { type: 'encore', number, songs: [] }; sets.push(current); }
      raw = raw.slice(enc[0].length);
    }
    const name = cleanTitle(raw);
    if (!name || LAYOUT_TOKEN.test(name)) {
      const prev = current.songs[current.songs.length - 1];
      if (!name && item.transition && prev && !prev.transition) prev.transition = item.transition;
      continue;
    }
    if (NOISE.test(name)) continue;
    if (!looksLikeTitle(name)) return fail(`"${name.slice(0, 40)}" is not a song title`);

    if (known(looseKey(name))) {
      current.songs.push({ name, transition: item.transition });
      total++;
      continue;
    }

    const words = name.split(' ');
    const splits = [];
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i).join(' ');
      if (vocab.has(looseKey(left)) && vocab.has(looseKey(right))) splits.push([left, right]);
    }
    if (splits.length > 1) return fail(`"${name.slice(0, 40)}" splits more than one way`);
    if (splits.length === 1) {
      if (current.type === 'encore') return fail('a set break after an encore');
      const [left, right] = splits[0];
      current.songs.push({ name: left, transition: '' });
      current = { type: 'set', number: current.number + 1, songs: [{ name: right, transition: item.transition }] };
      sets.push(current);
      total += 2;
      continue;
    }

    unknown++;
    total++;
    current.songs.push({ name, transition: item.transition });
  }

  const setCount = sets.filter((x) => x.type === 'set').length;
  if (setCount < 2) return fail('no set break found');
  if (setCount > 4) return fail('more set breaks than a show has');
  if (total < MIN_SONGS) return fail('too few songs');
  if (unknown / total > MAX_UNKNOWN_SHARE) return fail('too many titles the tape does not list');
  if (sets.some((x) => x.songs.length === 0)) return fail('a set with no songs');

  const last = sets[sets.length - 1].songs.slice(-1)[0];
  if (last) last.transition = '';
  return { explicit: true, inferred: true, sets, songCount: total, rejected: '' };
}

function txtFileName(meta) {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const txt = files.find((f) => /\.txt$/i.test(f.name || '') && !/(ffp|md5|shntool|st5|fingerprint|_meta)/i.test(f.name));
  return txt ? txt.name : '';
}

// ── Entry point ───────────────────────────────────────────────────────

function describeUpstream(docs) {
  return {
    topLevelKeys: ['response'],
    dataType: 'array',
    rowCount: docs.length,
    firstRowKeys: docs.length ? Object.keys(docs[0]) : [],
  };
}

// The item's venue and city, plus the venue as its title spells it
// ("Grateful Dead Live at Barton Hall - Cornell University on 1977-05-08"),
// which is often fuller than the `venue` field ("Barton Hall").
function ignoreFor(doc) {
  const fromTitle = String(doc.title || '').match(/\blive at (.+?) on \d{4}-\d{2}-\d{2}/i);
  return [doc.venue, doc.coverage, fromTitle ? fromTitle[1] : ''];
}

function descriptionOf(doc) {
  return Array.isArray(doc.description) ? doc.description.join('\n') : String(doc.description || '');
}

/**
 * fetchSetlists(date, { collection, venue, config, deadlineMs }) ->
 *   { ok, message, shows, upstream }
 *
 * One show per date, or one per show slot when the tapes say there were
 * early and late shows: band-setlist.js's selectShow then sees two shows at
 * one venue ('venue-tie'), and the merge rule chooses between them by
 * overlap with the setlist the show already has. With no setlist to
 * compare against, nothing is written — the early/late-without-evidence
 * rule.
 *
 * `deadlineMs` bounds the optional reads (info files, header-less splits,
 * extra metadata) so an interactive lookup answers inside a Netlify
 * function's window. A result cut short by it carries `lookupCutShort`, and
 * band-setlist.js does not cache it.
 *
 * Throws on network failure or rate limiting, so the caller can serve
 * stale cache and never caches an outage as "not found".
 */
async function fetchSetlists(date, { collection = COLLECTION, venue = '', config = CONFIG, deadlineMs = 0 } = {}) {
  if (!isEnabled(config)) {
    return { ok: false, disabled: true, message: 'The Internet Archive source is turned off (config/internet-archive.json)', shows: [] };
  }
  if (collection !== COLLECTION) {
    return { ok: false, message: `The Archive source only covers the ${COLLECTION} collection`, shows: [] };
  }

  const startedAt = Date.now();
  const ctx = {
    timeLeft: () => !deadlineMs || Date.now() - startedAt < deadlineMs,
    cutShort: false,
    softError: null,
    metaCache: new Map(),
  };

  const search = await archiveGet(searchPath(date));
  if (search.statusCode !== 200 || !search.data?.response) {
    return { ok: false, message: `Internet Archive search returned HTTP ${search.statusCode}`, shows: [] };
  }
  const allDocs = Array.isArray(search.data.response.docs) ? search.data.response.docs : [];
  const upstream = describeUpstream(allDocs);
  if (allDocs.length === 0) {
    return { ok: true, message: `No Grateful Dead recordings on the Internet Archive for ${date}`, shows: [], upstream };
  }

  const docs = filterByVenue(allDocs, venue);
  const slots = [...new Set(docs.map(showSlotOf).filter(Boolean))].sort();

  const groups = slots.length > 1
    ? slots.map((slot) => ({ slot, docs: docs.filter((d) => showSlotOf(d) === slot) }))
    : [{ slot: '', docs }];

  const shows = [];
  for (const group of groups) {
    const show = await pickShow(group.docs, ctx, allDocs.length);
    if (!show) continue;
    if (group.slot) {
      show.showSlot = group.slot;
      // So the review screen and selectShow's candidates can tell the two
      // apart; the venue match still works on the venue itself.
      if (!/\b(early|late)\b/i.test(show.venue)) show.venue = `${show.venue} (${group.slot === 'early' ? 'Early' : 'Late'} Show)`;
    }
    if (ctx.cutShort) show.lookupCutShort = true;
    shows.push(show);
  }

  if (shows.length > 0) return { ok: true, message: '', shows, upstream };

  // Anything weaker than a setlist, reached after a request failed or the
  // deadline cut a lookup short, might only be weaker BECAUSE of that.
  // Better to fail now and be asked again than to cache a "not found".
  if (ctx.softError) throw ctx.softError;
  if (ctx.cutShort) throw new Error('Internet Archive lookup ran out of time');

  return {
    ok: true,
    message: `${allDocs.length} recording${allDocs.length === 1 ? '' : 's'} on the Internet Archive for ${date}, but none lists a setlist`,
    shows: [],
    upstream,
  };
}

/**
 * pickShow(docs, ctx, itemCount) -> one mapped show, or null.
 *
 * The tapes of one show. Reads as little as it can, in this order, and
 * stops reading optional sources at the deadline:
 *
 *   1. every description in the search response (no extra requests)
 *   2. descriptions the search API flattened, re-read from metadata
 *   3. header-less descriptions, split with the tape's own track titles,
 *      while fewer than two complete candidates agree or disagree
 *   4. info files, only if nothing above produced a candidate
 *   5. track titles of the top complete tape, as a last resort
 */
async function pickShow(docs, ctx, itemCount) {
  if (docs.length === 0) return null;

  const soft = async (fn) => {
    try { return await fn(); } catch (e) { ctx.softError = e; return null; }
  };
  const metadata = async (identifier) => {
    if (!ctx.metaCache.has(identifier)) {
      const res = await soft(() => archiveGet(`/metadata/${encodeURIComponent(identifier)}`));
      ctx.metaCache.set(identifier, res && res.statusCode === 200 ? res.data : null);
    }
    return ctx.metaCache.get(identifier);
  };
  const optional = () => {
    if (ctx.timeLeft()) return true;
    ctx.cutShort = true;
    return false;
  };

  const byDownloads = [...docs].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0)
    || String(a.identifier).localeCompare(String(b.identifier)));
  const complete = byDownloads.filter((d) => !isPartialItem(d));
  const fallbackOrder = complete.length ? complete : byDownloads;
  const usable = (parsed) => parsed.explicit && parsed.songCount >= MIN_SONGS;
  const partialOf = (doc, parsed) => isPartialItem(doc) || startsAfterSetOne(parsed);

  // 1. Descriptions, from the search response itself. Comma-separated ones
  //    survive the search API intact.
  const candidates = [];
  const flattened = [];
  const headerless = [];
  for (const doc of byDownloads) {
    const text = descriptionOf(doc);
    const parsed = parseSetlistText(text, { ignore: ignoreFor(doc) });
    if (usable(parsed)) {
      candidates.push({ doc, parsed, partial: partialOf(doc, parsed), parsedFrom: 'description', fromSearch: true });
    } else if ((text.match(INLINE_SET_HEADER) || []).length > 0) {
      flattened.push(doc);
    } else if ((text.match(/,/g) || []).length >= 4) {
      headerless.push(doc);
    }
  }

  // 2. The search API joins a description's lines with spaces, so a
  //    one-song-per-line setlist arrives as "Set 1 Alabama Getaway ->
  //    Greatest Story Ever Told They Love Each Other …". The metadata
  //    endpoint has the real line breaks.
  const completeCount = () => candidates.filter((c) => !c.partial).length;
  for (const doc of flattened.filter((d) => !isPartialItem(d)).slice(0, METADATA_DESCRIPTION_ITEMS)) {
    if (completeCount() >= METADATA_DESCRIPTION_ITEMS || !optional()) break;
    const meta = await metadata(doc.identifier);
    const parsed = parseSetlistText(descriptionOf(meta?.metadata || {}), { ignore: ignoreFor(doc) });
    if (usable(parsed)) candidates.push({ doc, parsed, partial: partialOf(doc, parsed), parsedFrom: 'description' });
  }

  // 3. Header-less lists, split with the tape's track titles, until there
  //    are two complete candidates to compare.
  for (const doc of headerless.filter((d) => !isPartialItem(d)).slice(0, HEADERLESS_ITEMS)) {
    if (completeCount() >= 2 || !optional()) break;
    const meta = await metadata(doc.identifier);
    if (!meta) continue;
    const tracks = tracksFromMetadata(meta).sets.flatMap((x) => x.songs.map((song) => song.name));
    const parsed = splitHeaderless(descriptionOf(meta.metadata || {}), tracks);
    if (usable(parsed)) candidates.push({ doc, parsed, partial: partialOf(doc, parsed), parsedFrom: 'description', inferred: true });
  }

  // 4. Info files of the top items, only when no description gave a setlist.
  if (candidates.length === 0) {
    for (const doc of fallbackOrder.slice(0, TXT_FALLBACK_ITEMS)) {
      if (!optional()) break;
      const meta = await metadata(doc.identifier);
      const name = txtFileName(meta);
      if (!name) continue;
      const txt = await soft(() => archiveGet(`/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(name)}`, { json: false }));
      if (!txt || txt.statusCode !== 200) continue;
      const parsed = parseSetlistText(txt.data, { endOnProse: true, ignore: ignoreFor(doc) });
      if (usable(parsed)) candidates.push({ doc, parsed, partial: partialOf(doc, parsed), parsedFrom: 'info-file' });
    }
  }

  if (candidates.length > 0) {
    const ranked = rankCandidates(candidates);
    const [best] = ranked;
    // The winner was read from the search API's flattened copy of its
    // description. The real one, with its line breaks, is one request away
    // and is what gets returned when it parses — the flattened copy can
    // join a trailing note or venue onto the last song.
    if (best.fromSearch && optional()) {
      const meta = await metadata(best.doc.identifier);
      const reparsed = parseSetlistText(descriptionOf(meta?.metadata || {}), { ignore: ignoreFor(best.doc) });
      if (usable(reparsed)) best.parsed = reparsed;
    }
    const disagreement = disagreementOf(ranked);
    return mapShow(best.doc, best.parsed, {
      confidence: best.inferred ? 'inferred-sets' : 'explicit-sets',
      parsedFrom: best.parsedFrom,
      partial: best.partial,
      itemCount,
      candidateCount: candidates.length,
      disagreement,
    });
  }

  // Weaker than a set-marked setlist; see the caller on why a failed or
  // cut-short read stops here rather than settling for it.
  if (ctx.softError || ctx.cutShort) return null;

  // 5. Track titles of the top complete item — a song list, no sets.
  const top = fallbackOrder[0];
  const meta = await metadata(top.identifier);
  if (ctx.softError) return null;
  const parsed = tracksFromMetadata(meta);
  if (parsed.songCount > 0) {
    return mapShow(top, parsed, {
      confidence: 'tracks-only',
      parsedFrom: 'track-titles',
      partial: isPartialItem(top),
      itemCount,
      candidateCount: 0,
      disagreement: null,
    });
  }
  return null;
}

module.exports = {
  COLLECTION,
  isEnabled,
  setRequestGap,
  getRequestGap,
  disagreementOf,
  showSlotOf,
  sourceTypeOf,
  cleanTitle,
  fetchSetlists,
  filterByVenue,
  htmlToText,
  isPartialItem,
  mapShow,
  parseSetlistText,
  permalinkFor,
  rankCandidates,
  searchPath,
  splitChunk,
  splitHeaderless,
  tracksFromMetadata,
};
