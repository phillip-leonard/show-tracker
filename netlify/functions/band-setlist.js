/**
 * band-setlist — one date-addressed setlist fetch, whichever band source
 * owns the artist.
 *
 *   GET /api/band-setlist?source=elgoose&artist=Goose&date=2025-07-18
 *   GET /api/band-setlist?source=phishnet&artist=Phish&date=1997-11-22&venue=Hampton%20Coliseum
 *   GET /api/band-setlist?source=elgoose&artist=Goose&date=2026-08-15&debug=1
 *   GET /api/band-setlist?source=archive&artist=Grateful%20Dead&date=1977-05-08&artistId=GratefulDead
 *
 * `debug=1` adds an `upstream` object reporting the envelope's top-level
 * keys, the type of `data`, the row count and the first row's key names.
 * That is how you check this adapter's FIELDS map against what the
 * archive actually sends — particularly the case where songs come back
 * fine but one field is missing from every one of them.
 *
 * It bypasses the cache in both directions, so it always reflects what
 * the archive is sending right now and never leaves a debug-shaped
 * response in the cache for other callers.
 *
 * `source` is a band-source id from lib/setlistSources.js: 'phishnet',
 * 'archive', or the id of an ENABLED Songfish site in
 * config/songfish-sites.json ('elgoose'). The per-source fetch and field
 * mapping live in netlify/functions/lib/{songfish,phishnet,archive}Adapter.js
 * and each source is one branch in ADAPTERS below. Every Songfish site
 * shares one adapter and gets its branch from the config; a disabled site
 * gets none, so a request for it is an unknown source and nothing is sent
 * to its host.
 *
 * For a Songfish site, `artistId` is the site's numeric artist_id. Older
 * app versions send 'goose' there; the function then matches `artist`
 * against the site's mapped names instead (songfishSites.artistIdFor). An
 * artist the site doesn't map gets `ok: false` without a request.
 *
 * ── Why this is so much smaller than the setlist.fm path ─────────────
 *
 * Both APIs are addressable by show date. That is the real win. Finding one
 * night on setlist.fm means scanForMissingSetlists's loop: up to three
 * pages × three artist-name variants, each page 20 results, reversing
 * setlist.fm's DD-MM-YYYY into YYYY-MM-DD to compare, hoping the night is
 * in there somewhere. Here it is one request for one date, and either the
 * archive has the show or it doesn't.
 *
 * ── Caching ───────────────────────────────────────────────────────────
 *
 * Mirrors search-setlists.js: Firestore-backed, age-derived TTL, X-Cache:
 * HIT|MISS|STALE, stale-on-upstream-failure fallback, hit counting, and the
 * same getDb() lazy-init-with-graceful-degradation — if the Firebase env
 * vars are missing the function still works, just uncached.
 *
 * The one deliberate difference is the TTL ceiling. determineTtlHours in
 * search-setlists.js gives a show more than two years old a 7-day TTL,
 * which is right for setlist.fm and wrong here: phish.net's docs are
 * explicit that you should cache locally but for no longer than 24 hours,
 * because setlists get corrected after review. A corrected Phish setlist
 * should reach the app the next day, not the next week — so the ceiling is
 * 24h for both sources, since elgoose.net is a reviewed archive too and
 * there is no reason to treat it differently.
 *
 * A separate collection (`bandSetlistCache`) keyed by source + artist +
 * date, so it cannot collide with `setlistCache`.
 *
 * ── The API key ───────────────────────────────────────────────────────
 *
 * PHISHNET_API_KEY, read server-side only, with NO `||` literal fallback:
 * a missing key returns a 503 saying so. (The setlist.fm functions used to
 * fall back to a live key in the source; since 5.44.5 they read
 * SETLISTFM_API_KEY through lib/setlistfmKey.js, with no fallback either.)
 * elgoose.net needs no key at all.
 */

const crypto = require('crypto');

const songfishAdapter = require('./lib/songfishAdapter');
const songfishSites = require('./lib/songfishSites');
const phishnetAdapter = require('./lib/phishnetAdapter');
const archiveAdapter = require('./lib/archiveAdapter');

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const CACHE_COLLECTION = 'bandSetlistCache';

// phish.net's documented ceiling, applied to both sources. See the header.
const MAX_TTL_HOURS = 24;

// One branch per ENABLED Songfish site. `songfishSite` marks the branch so
// the handler resolves the site's artist_id before fetching; the adapter
// keeps only that artist's rows, because every Songfish site carries more
// than one act on a date.
function songfishAdapters() {
  const out = {};
  for (const site of songfishSites.enabledSites()) {
    out[site.id] = {
      requiresApiKey: false,
      songfishSite: site,
      fetch: (date, { artistId } = {}) => songfishAdapter.fetchSetlists(site, date, { artistId }),
    };
  }
  return out;
}

// The Internet Archive, Grateful Dead only. artistId is the collection
// ('GratefulDead'). The venue goes to the adapter as well as to
// selectShow, because here it narrows which TAPES are read rather than
// which of several shows is returned.
//
// Its own cache rules, because nothing about it matches the other two:
// these are tapes of shows from 1965–1995, not a reviewed archive being
// corrected this week, so a found setlist is kept for 30 days rather
// than 24 hours. And a "not found" is cached too, for 7 days: finding
// one costs up to five requests to a service that asks to be used
// gently, and a repeat lookup of a date with no tapes should not repeat
// them.
const ARCHIVE_ADAPTER = {
  requiresApiKey: false,
  maxTtlHours: 24 * 30,
  emptyTtlHours: 24 * 7,
  // A lookup someone is waiting on stops its optional reads at the
  // deadline, leaving room inside the function's 10 seconds; the result is
  // then not cached. A bulk walk (the admin re-sync, which spaces requests
  // out with setRequestGap) has no deadline.
  fetch: (date, { artistId, venue }) => archiveAdapter.fetchSetlists(date, {
    collection: artistId || archiveAdapter.COLLECTION,
    venue,
    deadlineMs: archiveAdapter.getRequestGap() > 0 ? 0 : ARCHIVE_DEADLINE_MS,
  }),
};

const ARCHIVE_DEADLINE_MS = 6500;

const ADAPTERS = {
  ...songfishAdapters(),
  phishnet: {
    requiresApiKey: true,
    apiKeyEnvVar: 'PHISHNET_API_KEY',
    fetch: (date, { apiKey, artistId }) => phishnetAdapter.fetchSetlists(date, { apiKey, artistId }),
  },
  // The Internet Archive, Grateful Dead only. Present only while
  // config/internet-archive.json has `enabled: true`; see the handler for
  // what a request for it gets otherwise.
  ...(archiveAdapter.isEnabled() ? { archive: ARCHIVE_ADAPTER } : {}),
};

// --- Firebase Admin (lazy init, graceful degradation if env vars missing) ---
// Verbatim from search-setlists.js, deliberately: the point of that pattern
// is that a cache is an optimization and its absence must not be an outage.

function getDb() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;
  try {
    const { getApps, initializeApp, cert } = require('firebase-admin/app');
    if (!getApps().length) {
      initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
    }
    const { getFirestore } = require('firebase-admin/firestore');
    return getFirestore();
  } catch (e) {
    console.warn('[CACHE] Firebase init failed:', e.message);
    return null;
  }
}

// ── toIsoDate, mirrored from lib/utils.js ─────────────────────────────
// Same two accepted spellings and the same reading of an ambiguous
// DD-MM-YYYY (setlist.fm's format, which is where these come from), so the
// date this function asks an archive about is the date the app displays.
function toIsoDate(value) {
  const str = String(value == null ? '' : value).trim();
  if (!str) return '';

  const ddmmyyyy = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return str;

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- Cache helpers ---

// ── Why the cache key carries a version ───────────────────────────────
//
// A cached response is a snapshot of what the ADAPTER produced, not of what
// the archive sent, so every correction to a field mapping changes the
// meaning of every entry already stored. Without a version in the key those
// stale entries keep being served for up to MAX_TTL_HOURS after the fix
// ships — which looks exactly like "the fix works on some shows and not
// others", because whether a given date is stale depends on whether anyone
// happened to ask for it before the deploy.
//
// That is not hypothetical: this feature shipped four adapter corrections
// in one afternoon (5.33.4 and 5.33.5 between them fixed the permalink and
// four wrong field names), and any date fetched between them is cached
// wrong until tomorrow.
//
// BUMP THIS whenever the adapters' output changes shape or meaning. It
// costs one re-fetch per date and it is the difference between a fix being
// live and a fix being live eventually.
//
//   1 — 5.33.0, the original mapping
//   2 — 5.34.3: elgoose rows are filtered by artist, and everything the
//       5.33.4/5.33.5 corrections changed (permalink, jamchart_notes,
//       song_id, original_artist, shownotes)
//   3 — 5.47.6: one Songfish adapter for every site. Encores (setnumber
//       'e') are labelled Encore instead of Set I, rows are filtered
//       strictly by numeric artist_id, every footnote is kept, and
//       artistId in the key is the site's numeric id
//   4 — ambiguous dates carry `selection` and `contested` (each candidate
//       show with its songs), for the merge rule's overlap choice
//   5 — 5.47.8: Archive results carry needsReview, disagreement,
//       licenseUrl and sourceType, early and late shows come back as two
//       shows, and the tape-selection rule changed
const CACHE_VERSION = 5;

function buildCacheKey(source, artist, date, venue, artistId) {
  const normalized = JSON.stringify({
    ver: CACHE_VERSION,
    s: (source || '').toLowerCase().trim(),
    a: (artist || '').toLowerCase().trim(),
    d: (date || '').trim(),
    v: (venue || '').toLowerCase().trim(),
    // Part of the key because it is part of what the response contains: the
    // Songfish adapter filters rows by it, so two artists on one date don't
    // share an answer.
    i: String(artistId == null ? '' : artistId).toLowerCase().trim(),
  });
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * TTL in hours for one show date. Same shape as search-setlists.js's
 * determineTtlHours — shorter for shows that haven't happened yet or only
 * just did, longer for settled history — but capped at MAX_TTL_HOURS rather
 * than running out to the 7-day tier.
 */
function determineTtlHours(showDate, maxTtlHours = MAX_TTL_HOURS) {
  const d = new Date(`${showDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 1;

  const now = Date.now();
  if (d.getTime() > now) return 1; // upcoming show — the setlist isn't written yet

  const monthsAgo = (now - d.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo < 1) return 6; // still being reviewed and corrected
  return maxTtlHours;
}

// --- Handler ---

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { source, artist, venue, debug } = event.queryStringParameters || {};
  let { date, artistId } = event.queryStringParameters || {};

  // The Archive switched off (config/internet-archive.json). Answered
  // before the cache, so no stored Archive setlist is served either, and
  // as the same "no show" every app version already falls back to
  // setlist.fm from, rather than as an error.
  if (source === 'archive' && !archiveAdapter.isEnabled()) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' },
      body: JSON.stringify({
        ok: false,
        disabled: true,
        source,
        message: 'The Internet Archive source is turned off',
        shows: [],
        songs: [],
      }),
    };
  }

  // Own properties only: `ADAPTERS['constructor']` is truthy otherwise.
  if (!source || !Object.prototype.hasOwnProperty.call(ADAPTERS, source)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Unknown source. Expected one of: ${Object.keys(ADAPTERS).join(', ')}` }),
    };
  }
  // Accepts DD-MM-YYYY as well as YYYY-MM-DD, and works in the latter from
  // here down. setlist.fm's own format is DD-MM-YYYY and it reached show
  // documents through the ticket scanner, so a caller holding one of those
  // dates got a 400 from this endpoint — a well-formed refusal that read,
  // from the app, as "El Goose doesn't have this show". Normalizing here
  // rather than only in the callers means every deployed client is fixed,
  // including app versions already installed.
  const isoDate = toIsoDate(date);
  if (!isoDate) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'A date in YYYY-MM-DD form is required', received: date || '' }),
    };
  }
  date = isoDate;

  const adapter = ADAPTERS[source];

  // A Songfish site answers for every act it carries, so the artist has to
  // be one this site is mapped for. If not, the archive is not asked: the
  // answer is the same "no show" the app already falls back from.
  if (adapter.songfishSite) {
    const siteArtistId = songfishSites.artistIdFor(adapter.songfishSite, { artist, artistId });
    if (siteArtistId == null) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' },
        body: JSON.stringify({
          ok: false,
          source,
          date,
          message: `${artist || 'That artist'} is not mapped on ${adapter.songfishSite.displayName}`,
          shows: [],
          songs: [],
        }),
      };
    }
    artistId = String(siteArtistId);
  }

  // The key, if this source needs one. No literal fallback — a missing key
  // is a configuration problem and says so, rather than silently working
  // off a credential committed to the repository.
  let apiKey = '';
  if (adapter.requiresApiKey) {
    apiKey = process.env[adapter.apiKeyEnvVar] || '';
    if (!apiKey) {
      console.warn(`[BAND-SETLIST] ${adapter.apiKeyEnvVar} is not set — refusing to fetch from ${source}`);
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `${source} is not configured on this deployment`,
          details: `${adapter.apiKeyEnvVar} is not set. Add it as a Netlify environment variable.`,
        }),
      };
    }
  }

  const label = `${source} ${artist || '?'} ${date}`;
  const adapterFile = adapter.songfishSite ? 'songfishAdapter.js' : `${source}Adapter.js`;
  const cacheKey = buildCacheKey(source, artist, date, venue, artistId);
  const db = getDb();
  let staleDoc = null;

  // ── debug bypasses the cache, in both directions ──────────────────
  // The cache key is source + artist + date + venue, deliberately not
  // `debug` — so without this, `debug=1` on any date already in the cache
  // would return the stored body with no diagnostics attached, which is
  // exactly the date you are most likely to be investigating. It must also
  // not WRITE, or a debug-shaped response would be served to everyone for
  // the rest of the TTL.
  const bypassCache = debug === '1';

  // 1. Check cache
  if (db && !bypassCache) {
    try {
      const snap = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
      if (snap.exists) {
        const cached = snap.data();
        const expired = (cached.expiresAt?.toMillis?.() || 0) < Date.now();
        if (!expired) {
          const newHits = (cached.hitCount || 0) + 1;
          console.log(`[CACHE HIT]  ${label} — hits: ${newHits}, ttl: ${cached.ttlHours}h`);
          snap.ref.update({ hitCount: newHits }).catch(() => {});
          return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' }, body: cached.response };
        }
        console.log(`[CACHE EXPIRED] ${label}`);
        staleDoc = cached; // hold onto stale data for API failure fallback
      } else {
        console.log(`[CACHE MISS] ${label}`);
      }
    } catch (e) {
      console.warn('[CACHE] Read error:', e.message);
    }
  }

  // 2. Fetch from the band source
  try {
    const result = await adapter.fetch(date, { apiKey, artistId, venue });

    if (!result.ok) {
      // An upstream that answered and said "no" is not an outage — it is an
      // answer, and the caller's merge rules treat an empty setlist as
      // "change nothing". Reported as 200 with `ok: false` rather than as a
      // 5xx so a bad date doesn't look like a broken function.
      const body = JSON.stringify({
        ok: false,
        source,
        date,
        message: result.message || 'Source returned an error',
        shows: [],
        songs: [],
        upstream: result.upstream,
      });
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body };
    }

    const payload = selectShow(result.shows, { source, date, venue });

    // Nothing came back. Attach what the upstream actually sent, because
    // "the archive has no show on that date" and "a key in this adapter's
    // FIELDS map is wrong" are otherwise the same empty response — and with
    // the mapping unverified, that is the one distinction a caller needs.
    // `firstRowKeys` is the payoff: rows present but none of them carrying
    // the keys FIELDS reads means the mapping is wrong, and it names the
    // real spelling.
    // `?debug=1` attaches the same diagnostics to a SUCCESSFUL fetch. The
    // no-songs case below covers "why did I get nothing", but the other
    // half of checking a FIELDS map is "I got songs, yet one field is
    // missing from every one of them" — which needs the real row keys and
    // is otherwise invisible. It reports key NAMES and counts only, never
    // row values, and everything it exposes is already public on the
    // archive's own API.
    if (debug === '1' && result.upstream) {
      payload.upstream = result.upstream;
    }

    if (payload.songs.length === 0 && result.upstream) {
      payload.upstream = result.upstream;
      // Rows dropped for belonging to another act on this site are not a
      // mapping problem: that is a date this artist didn't play.
      if (result.upstream.rowCount > (result.droppedOtherArtistCount || 0)) {
        console.warn(
          `[BAND-SETLIST] ${label} — upstream returned ${result.upstream.rowCount} row(s) ` +
          `but none produced a song. Row keys: ${result.upstream.firstRowKeys.join(', ')}. ` +
          `Check the FIELDS map in ${adapterFile}.`
        );
      }
    }

    // A row the archive returned that came out with no song title means an
    // upstream key in this adapter's FIELDS map is wrong — get `songName`
    // wrong and every row still has a valid set, position and gap, so the
    // setlist looks structurally perfect and is entirely nameless. The rows
    // are dropped (see buildSetlist in lib/bandSetlistShape.js), which is
    // what stops them being written over a good setlist. This is the line
    // that says so out loud, because otherwise the symptom is only ever
    // "the feature quietly does nothing".
    if (payload.droppedUntitledCount > 0) {
      console.warn(
        `[BAND-SETLIST] ${label} — dropped ${payload.droppedUntitledCount} row(s) with no song title. ` +
        `A FIELDS key in ${adapterFile} is probably wrong; nothing was written.`
      );
    }

    const responseBody = JSON.stringify(payload);

    // 3. Write to cache on success.
    //
    // Only when the source actually returned a show. Caching an empty
    // result for 24h would mean a show added to the archive tomorrow stays
    // invisible to the app for a day — and an empty result is cheap to
    // re-ask for, being one request rather than a nine-request search loop.
    //
    // The exception is a source that sets `emptyTtlHours` (the Archive),
    // where an empty answer is neither cheap nor likely to change; see its
    // ADAPTERS entry. Only an answer the source actually gave — a thrown
    // error never reaches here, so an outage is never cached as "none".
    const cacheEmpty = !!adapter.emptyTtlHours && payload.songs.length === 0;
    if (db && !bypassCache && !payload.lookupCutShort && (payload.songs.length > 0 || cacheEmpty)) {
      const ttlHours = cacheEmpty ? adapter.emptyTtlHours : determineTtlHours(date, adapter.maxTtlHours || MAX_TTL_HOURS);
      const { Timestamp } = require('firebase-admin/firestore');
      db.collection(CACHE_COLLECTION).doc(cacheKey).set({
        response: responseBody,
        fetchedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + ttlHours * 3600 * 1000)),
        ttlHours,
        queryParams: {
          source,
          artistName: (artist || '').toLowerCase().trim(),
          date,
          venueName: (venue || '').toLowerCase().trim(),
        },
        hitCount: 0,
      }).then(() => {
        console.log(`[CACHE WRITE] ${label} → TTL: ${ttlHours}h`);
      }).catch(e => {
        console.warn('[CACHE] Write error:', e.message);
      });
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'MISS' }, body: responseBody };
  } catch (e) {
    // 4. Upstream failure — serve stale cache if we have any.
    //
    // This is the only path that serves data older than the 24h ceiling,
    // and it says so in the header. Better a day-old setlist than none
    // while a volunteer-run archive is down.
    if (staleDoc) {
      const ageHours = Math.round((Date.now() - (staleDoc.fetchedAt?.toMillis?.() || 0)) / 3600000);
      console.log(`[CACHE STALE] ${label} — source down, serving stale (age: ${ageHours}h)`);
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'X-Cache': 'STALE' }, body: staleDoc.response };
    }
    console.warn(`[BAND-SETLIST] ${label} failed:`, e.message);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, source, date, message: e.message, shows: [], songs: [] }),
    };
  }
};

/**
 * Picks which show to return when a date carries more than one — a festival
 * day, or a two-a-day.
 *
 * Disambiguates on venue name when the caller supplied one, and SAYS SO in
 * the response either way rather than picking the first silently:
 * `ambiguous: true` plus a `candidates` list of every show on the date, so
 * a caller that got the wrong one can tell, and a human reading the
 * backfill's dry-run output can see it happened.
 */
// ── Comparing two spellings of one venue ──────────────────────────────
//
// The stored venue comes from setlist.fm (or from whatever the user typed)
// and the candidate's comes from the archive, so an exact comparison fails
// on differences that are not differences: "Ascend Amphitheater" against
// "Ascend Amphitheatre", "The Capitol Theatre" against "Capitol Theatre",
// "Hill Auditorium, Ann Arbor" against "Hill Auditorium". When that
// comparison fails on a date with two shows, the wrong setlist is returned
// — which is a data-shaped bug reached through a spelling.
//
// British/American spellings folded, punctuation and articles dropped,
// whitespace collapsed. Deliberately NOT fuzzy beyond that: two genuinely
// different venues must still not match, because the fallback (the fullest
// setlist, reported as ambiguous) is safer than a confident wrong answer.
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

function selectShow(shows, { source, date, venue }) {
  const base = { ok: true, source, date, ambiguous: false, candidates: [], message: '' };

  if (!shows || shows.length === 0) {
    return { ...base, songs: [], shows: [], message: `No show on ${date}` };
  }

  const candidates = shows.map((s) => ({
    venue: s.venue,
    city: s.city,
    state: s.state,
    sourceShowId: s.sourceShowId,
    sourcePermalink: s.sourcePermalink,
    songCount: s.songs.length,
  }));

  let chosen = shows[0];
  let ambiguous = false;
  let message = '';
  // How `chosen` was picked, and the shows it was picked from when that
  // was not a clean answer. 'only': one show. 'venue': the one show whose
  // venue matched. 'venue-tie': more than one show at the matched venue
  // (BottleRock 2025: two Goose sets, both "Napa Valley Expo"), so the
  // venue decided nothing. 'fullest': no venue match; the fullest setlist,
  // a guess. For the last two, `contested` lists the candidates with their
  // songs, and a caller that has the show's existing setlist picks between
  // them by song overlap (chooseCandidate in lib/bandSetlistMerge.js)
  // rather than taking `chosen`.
  let selection = 'only';
  let contested = [];

  if (shows.length > 1) {
    ambiguous = true;
    const wanted = venueKey(venue);
    const venueMatches = wanted
      ? shows.filter((s) => {
          const v = venueKey(s.venue);
          return v && (v === wanted || v.includes(wanted) || wanted.includes(v));
        })
      : [];
    const matched = venueMatches[0] || null;

    if (matched && venueMatches.length > 1) {
      chosen = matched;
      selection = 'venue-tie';
      contested = venueMatches;
      message = `${shows.length} shows on ${date}, ${venueMatches.length} of them at "${chosen.venue}"; choose by song overlap`;
    } else if (matched) {
      chosen = matched;
      selection = 'venue';
      message = `${shows.length} shows on ${date}; matched on venue "${chosen.venue}"`;
    } else {
      selection = 'fullest';
      contested = shows;
      // No venue match. Array order is not evidence of anything, so the
      // fullest setlist is the better guess than the first one: on a
      // festival day the two entries are usually a full set and a sit-in or
      // a late-night guest spot, and returning the three-song one over the
      // sixteen-song one is the worse failure. Still reported as ambiguous
      // with every candidate attached, because it IS a guess.
      chosen = shows.reduce((best, s) => (s.songs.length > best.songs.length ? s : best), shows[0]);
      message = wanted
        ? `${shows.length} shows on ${date} and none matched venue "${venue}" — returning "${chosen.venue}" (the fullest setlist). Check candidates.`
        : `${shows.length} shows on ${date} and no venue was supplied — returning "${chosen.venue}" (the fullest setlist). Check candidates.`;
    }
  }

  // Archive only: the fields that decide whether a setlist may be written
  // without asking, per show, so a contested early/late pick carries its
  // own. Absent (and dropped from the JSON) for the other sources.
  const archiveFields = (s) => ({
    confidence: s.confidence,
    parsedFrom: s.parsedFrom,
    partial: s.partial,
    itemCount: s.itemCount,
    candidateCount: s.candidateCount,
    needsReview: s.needsReview,
    disagreement: s.disagreement,
    sourceType: s.sourceType,
    licenseUrl: s.licenseUrl,
    showSlot: s.showSlot,
  });

  return {
    ...base,
    ambiguous,
    candidates,
    selection,
    contested: contested.map((s) => ({
      venue: s.venue,
      city: s.city,
      state: s.state,
      country: s.country,
      tour: s.tour,
      sourceShowId: s.sourceShowId,
      sourcePermalink: s.sourcePermalink,
      setlistNotes: s.setlistNotes,
      songs: s.songs,
      ...archiveFields(s),
    })),
    message,
    // How the setlist was read, which decides whether the app may write it
    // without asking. See archiveAdapter.js.
    ...archiveFields(chosen),
    lookupCutShort: shows.some((s) => s.lookupCutShort) || undefined,
    // The normalized setlist, which is what callers actually want.
    songs: chosen.songs,
    droppedSoundcheckCount: chosen.droppedSoundcheckCount,
    droppedUntitledCount: chosen.droppedUntitledCount,
    // Show-level fields, stored on the show document.
    venue: chosen.venue,
    city: chosen.city,
    state: chosen.state,
    country: chosen.country,
    tour: chosen.tour,
    sourceShowId: chosen.sourceShowId,
    sourcePermalink: chosen.sourcePermalink,
    setlistNotes: chosen.setlistNotes,
  };
}

// Exported for the unit tests, which exercise selectShow's disambiguation
// without standing up the handler.
exports.selectShow = selectShow;
exports.determineTtlHours = determineTtlHours;
exports.buildCacheKey = buildCacheKey;
exports.MAX_TTL_HOURS = MAX_TTL_HOURS;
exports.CACHE_VERSION = CACHE_VERSION;
exports.venueKey = venueKey;
exports.toIsoDate = toIsoDate;
