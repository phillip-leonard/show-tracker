// lib/importMatch.js
//
// Which setlist a spreadsheet row gets, before anything is saved, so the
// import preview can say "setlist: yes / no" for every row. Same order as
// every other add path (lib/setlistSources.js): the band's own archive
// first (El Goose, Phish.net), then the Internet Archive for its bands,
// then setlist.fm.
//
// An Internet Archive setlist the app may not write unasked (a track list,
// an incomplete tape; see canAutoApply in lib/bandSetlist.js) is not
// written by an import either. It comes back as `proposal`, which the
// import stores on the show as a pending `setlistProposal`: the show page
// and My Shows then offer it for review, exactly like the Archive backfill.
//
// Requests are made one at a time with a gap between them (MatchContext),
// because a 300-row file must not become 300 parallel requests to our
// functions and, through them, to setlist.fm.

import { apiUrl } from '@/lib/api';
import { resolveSource } from '@/lib/setlistSources';
import { fetchBandSetlistWithReason, canAutoApply, mergeSourceSetlist, bandSetlistShowFields } from '@/lib/bandSetlist';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { artistKey, showDataFor, showKey } from '@/lib/importSheet';

// setlist.fm allows two requests a second per key, shared by everyone
// using the app; a 429 is waited out once (RETRY_MS) before giving up.
const GAP_MS = 600;
const RETRY_MS = 2000;

/**
 * A lookup session: the request gap, what's already known about each
 * artist (so a 40-row band costs one "does this artist exist" check), and
 * the injectable pieces the tests replace.
 */
export function createMatchContext({ fetchImpl, gapMs = GAP_MS, sleep, now } = {}) {
  return {
    fetch: fetchImpl || ((...args) => fetch(...args)),
    gapMs,
    sleep: sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: now || (() => Date.now()),
    lastAt: 0,
    artists: new Map(),
  };
}

async function paced(ctx) {
  const wait = ctx.lastAt + ctx.gapMs - ctx.now();
  if (wait > 0) await ctx.sleep(wait);
  ctx.lastAt = ctx.now();
}

async function searchSetlistFm(ctx, params) {
  await paced(ctx);
  const url = apiUrl(`/.netlify/functions/search-setlists?${new URLSearchParams(params).toString()}`);
  let res = await ctx.fetch(url);
  if (res.status === 429) {
    await ctx.sleep(RETRY_MS);
    ctx.lastAt = ctx.now();
    res = await ctx.fetch(url);
  }
  if (res.status === 404) return { found: [] };
  if (!res.ok) return { error: `setlist.fm lookup failed (HTTP ${res.status})` };
  const data = await res.json();
  return { found: Array.isArray(data?.setlist) ? data.setlist : [] };
}

function venueKey(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// The setlist.fm show for this row: the artist as spelled (setlist.fm's
// name search also returns other acts), then the venue if the file has one.
//
// Two acts can share a name ("Goose" and Belgium's "GOOSE"). A show at a
// different venue from the file's, by an act spelled differently from the
// file's, is the other act's, and isn't taken.
function pickSetlist(found, artist, venue) {
  const sameArtist = found.filter((s) => artistKey(s.artist?.name) === artistKey(artist));
  const pool = sameArtist.length ? sameArtist : found;
  const wanted = venueKey(venue);
  if (wanted) {
    const atVenue = pool.find((s) => {
      const v = venueKey(s.venue?.name);
      return v && (v.includes(wanted) || wanted.includes(v));
    });
    if (atVenue) return atVenue;
    return pool.find((s) => s.artist?.name === artist) || null;
  }
  return pool.find((s) => s.artist?.name === artist) || pool[0] || null;
}

// Spellings worth a second try when setlist.fm doesn't know the first one.
function nameVariants(artist) {
  const out = [];
  if (/&/.test(artist)) out.push(artist.replace(/&/g, 'and'));
  if (/^the\s+/i.test(artist)) out.push(artist.replace(/^the\s+/i, ''));
  else out.push(`The ${artist}`);
  return out;
}

// Whether setlist.fm has the artist at all, with the spelling that worked.
async function knownArtist(ctx, artist) {
  const key = artistKey(artist);
  if (ctx.artists.has(key)) return ctx.artists.get(key);
  let answer = null;
  for (const name of [artist, ...nameVariants(artist)]) {
    const r = await searchSetlistFm(ctx, { artistName: name, p: '1' });
    if (r.error) { answer = { error: r.error }; break; }
    const hit = r.found.find((s) => artistKey(s.artist?.name) === artistKey(name)) || r.found[0];
    if (hit) { answer = { name: hit.artist?.name || name, query: name }; break; }
  }
  ctx.artists.set(key, answer);
  return answer;
}

function proposalFrom(result, baseSetlist) {
  const merged = mergeSourceSetlist(baseSetlist || [], result);
  const picked = merged.result;
  const summary = merged.summary || {};
  return {
    source: 'archive',
    status: 'pending',
    createdAt: new Date().toISOString(),
    from: 'import',
    songs: picked.songs || [],
    sourceShowId: picked.sourceShowId || '',
    sourcePermalink: picked.sourcePermalink || '',
    setlistNotes: picked.setlistNotes || '',
    licenseUrl: picked.licenseUrl == null ? null : picked.licenseUrl,
    needsReview: !!picked.needsReview,
    disagreement: picked.disagreement || null,
    confidence: picked.confidence || '',
    parsedFrom: picked.parsedFrom || '',
    partial: !!picked.partial,
    sourceType: picked.sourceType || '',
    showSlot: picked.showSlot || '',
    summary: {
      existingCount: summary.existingCount || 0,
      incomingCount: summary.incomingCount || 0,
      resultCount: summary.resultCount || 0,
      added: summary.added || [],
      removed: summary.removed || [],
      movedSet: summary.movedSet || [],
      movedPosition: summary.movedPosition || [],
      keptManual: summary.keptManual || [],
      keptNotInSource: summary.keptNotInSource || [],
      carriedOver: summary.carriedOver || {},
    },
  };
}

/**
 * matchShow({ artist, date, venue }, ctx) -> {
 *   status,         'matched' | 'no-setlist' | 'unknown-artist' | 'error'
 *   reason,         why it didn't match, for the preview and the CSV
 *   artist,         the artist as setlist.fm spells it, when it knows them
 *   venue, city, state, country, tour,   from setlist.fm, when it has the show
 *   setlist,        songs to save with the show, or null
 *   setlistSource,  'setlistfm' or a band source id, when there is a setlist
 *   setlistfmId, setlistfmUrl,
 *   sourceFields,   a band source's show fields (bandSetlistShowFields)
 *   proposal,       an Internet Archive setlist to review, or null
 *   sourceLabel,    who the setlist (or the proposal) is from
 * }
 *
 * Never throws: a failed request is status 'error', and the row can still
 * be imported, just without a setlist.
 */
export async function matchShow({ artist, date, venue = '' }, ctx = createMatchContext()) {
  const out = {
    status: 'no-setlist', reason: '', artist, venue: '', city: '', state: '', country: '', tour: '',
    setlist: null, setlistSource: '', setlistfmId: null, setlistfmUrl: null, proposal: null, sourceLabel: '',
  };
  try {
    // 1. A band source. Its setlist goes in when the app may write it
    //    unasked; addShow's own band-source step (enrichShowDataWithBandSetlist)
    //    then finds the same answer in band-setlist.js's cache.
    let tape = null;
    const source = resolveSource(artist);
    if (source.isBandSource) {
      await paced(ctx);
      const { result } = await fetchBandSetlistWithReason({ artist, date, venue });
      if (result && canAutoApply(result)) {
        Object.assign(out, {
          status: 'matched', setlist: result.songs, setlistSource: result.source,
          sourceLabel: result.source === 'archive' ? 'a tape on the Internet Archive' : source.label,
          // Where it came from (the tape, the archive's page), so the saved
          // show is credited without waiting for addShow to ask again.
          sourceFields: bandSetlistShowFields(result, result.songs),
        });
      } else if (result) {
        tape = result;
      }
    }

    // 2. setlist.fm, for the setlist (when no band source gave one) and for
    //    the venue, city and the artist's spelling.
    const needSetlistFm = !out.setlist || !venue;
    let show = null;
    if (needSetlistFm) {
      let r = await searchSetlistFm(ctx, { artistName: artist, date });
      if (r.error) {
        if (!out.setlist) return { ...out, status: 'error', reason: r.error, proposal: tape ? proposalFrom(tape, []) : null };
      } else {
        show = pickSetlist(r.found, artist, venue);
        // Nothing that day. A misspelling, or a night setlist.fm doesn't
        // have? Not asked for a band-source artist, which the registry
        // already knows: setlist.fm's "Goose" is a Belgian band too.
        if (!show && !out.setlist && !source.isBandSource) {
          const known = await knownArtist(ctx, artist);
          if (known?.error) return { ...out, status: 'error', reason: known.error };
          if (!known && !tape) {
            return { ...out, status: 'unknown-artist', reason: `setlist.fm has no artist called "${artist}". Check the spelling.` };
          }
          // Only a show found on the date renames the artist; knowing that
          // some act has the name is not enough.
          if (known && known.query !== artist) {
            r = await searchSetlistFm(ctx, { artistName: known.query, date });
            if (!r.error) show = pickSetlist(r.found, known.query, venue);
          }
        }
      }
    }

    if (show) {
      out.artist = show.artist?.name || out.artist;
      out.venue = show.venue?.name || '';
      out.city = show.venue?.city?.name || '';
      out.state = show.venue?.city?.stateCode || show.venue?.city?.state || '';
      out.country = show.venue?.city?.country?.name || '';
      out.tour = show.tour?.name || '';
      if (!out.setlist) {
        const songs = extractSongsFromSetlist(show);
        if (songs.length) {
          Object.assign(out, {
            status: 'matched', setlist: songs, setlistSource: 'setlistfm', sourceLabel: 'setlist.fm',
            setlistfmId: show.id || null, setlistfmUrl: show.url || null,
          });
        }
      }
    }

    // 3. A tape setlist to review, set against whatever setlist the show
    //    is getting, the way the show page would.
    if (tape) {
      out.proposal = proposalFrom(tape, out.setlist || []);
      if (!out.setlist) out.sourceLabel = 'Internet Archive (to review)';
    }
    if (!out.setlist && !out.proposal) out.reason = `No setlist for ${date} on setlist.fm`;
    return out;
  } catch (e) {
    return { ...out, status: 'error', reason: e?.message || 'Lookup failed' };
  }
}

/**
 * importShows(shows, options) -> { counts, unmatched }
 *
 * Saves the chosen shows one at a time, matching any that weren't checked
 * in the preview, and counts what happened. `shows` is planShows' list.
 *
 *   isPicked(show)   – whether the user left it ticked
 *   matches          – Map of show key -> matchShow result from the preview
 *   match(show)      – matchShow for a show the preview didn't reach
 *   save(showData)   – addShow: a show id, { duplicate: true }, or falsy
 *   shouldStop()     – true once the user pressed Stop; what's saved stays
 *   onProgress(done, total)
 *   artistColumn, isSplit(rowIndex) – so a split act's row in the
 *                      unmatched CSV names that act, not the whole bill
 *
 * counts: { imported, withSetlists, toReview, duplicates, unmatched,
 * leftOut, cancelled }. `unmatched` is [{ cells, reason }] for the CSV.
 */
export async function importShows(shows, {
  isPicked, matches = new Map(), match, save, shouldStop = () => false, onProgress = () => {},
  artistColumn, isSplit = () => false,
}) {
  const counts = { imported: 0, withSetlists: 0, toReview: 0, duplicates: 0, unmatched: 0, leftOut: 0, cancelled: false };
  const unmatched = [];
  const savedKeys = new Set();
  const notMatched = (s, reason) => {
    counts.unmatched++;
    const cells = [...(s.row.cells || [])];
    if (artistColumn !== undefined && isSplit(s.rowIndex) && s.row.artists.length > 1) cells[artistColumn] = s.artist;
    unmatched.push({ cells, reason });
  };

  const chosen = [];
  for (const s of shows) {
    if (s.problem) notMatched(s, s.problem);
    else if (s.duplicate) counts.duplicates++;
    else if (isPicked(s)) chosen.push(s);
    else if (matches.get(s.key)?.status === 'unknown-artist') notMatched(s, matches.get(s.key).reason);
    else counts.leftOut++;
  }

  for (let i = 0; i < chosen.length; i++) {
    if (shouldStop()) {
      // Shows never reached are left for the next run, which sees the
      // saved ones as duplicates.
      counts.cancelled = true;
      counts.leftOut += chosen.length - i;
      break;
    }
    const s = chosen[i];
    let m = matches.get(s.key);
    if (!m) m = await match(s);
    const data = showDataFor(s, m);
    if (data.skip) {
      notMatched(s, data.skip);
    } else {
      try {
        const saved = await save(data);
        if (saved && typeof saved === 'object' && saved.duplicate) {
          counts.duplicates++;
        } else if (saved) {
          counts.imported++;
          savedKeys.add(s.key);
          savedKeys.add(showKey(data.artist, data.date));
          if (data.setlist.length) counts.withSetlists++;
          if (data.setlistProposal) counts.toReview++;
        } else {
          notMatched(s, 'Not saved (are you signed in?)');
        }
      } catch (e) {
        notMatched(s, `Not saved: ${e?.message || 'error'}`);
      }
    }
    onProgress(i + 1, chosen.length);
  }
  return { counts, unmatched, savedKeys };
}
