// lib/bandSetlist.js
//
// The client side of the band-source path: resolve an artist through the
// registry, and if a band source owns them, get that source's setlist for a
// date and hand back the show-document fields to write.
//
// This is the ONE place the app decides where a setlist comes from once a
// show has been identified, so the five add paths don't each grow their own
// copy of the logic. Everything funnels through AppContext's addShow /
// addShowsFromTour / scanForMissingSetlists, which is where this is called
// from — see the comment on buildShowDoc in context/AppContext.jsx ("Change
// the shape here or not at all").
//
// ── What this does NOT change ─────────────────────────────────────────
//
// setlist.fm remains the show *discovery* layer everywhere it is one today:
// artist search, tour lists, venue and mbid resolution, the festival
// lineup lookup. Neither elgoose.net nor phish.net replaces those cleanly,
// and this change is not about replacing show search. It is only about
// where the setlist comes from once a show is identified.
//
// So the fall-through is silent and total: if the band source fails,
// returns nothing, or isn't configured, the caller keeps whatever
// setlist.fm gave it and records `setlistSource: 'setlistfm'`. A volunteer
// archive being down must never turn into a failed show add.

import { apiUrl } from '@/lib/api';
import {
  bandSetlistRequest, bandSetlistResultFrom, canAutoApply, bandSetlistShowFields,
  userNoteCounts, mergeSourceSetlist, mergeNeedsWrite, applyBandSetlist,
} from '@/lib/bandSetlistRules';

// The rules with no network in them live in lib/bandSetlistRules.js
// (CommonJS, 5.60.5), shared with the server's normalize-show; re-exported
// here for the app's existing callers.
export { canAutoApply, bandSetlistShowFields, userNoteCounts, mergeSourceSetlist, mergeNeedsWrite, applyBandSetlist };

const FETCH_TIMEOUT_MS = 12000;

// A hung request must not hang a show add. Races the fetch rather than
// using AbortController so this keeps working in the Capacitor WebView
// without depending on which abort semantics that runtime ships.
function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Band setlist request timed out')), ms)),
  ]);
}

/**
 * fetchBandSetlistWithReason({ artist, artistMbid, date, venue })
 *   -> { result, reason, detail }
 *
 * The same fetch as fetchBandSetlist below, except it says WHY it came back
 * with nothing instead of collapsing every case onto null.
 *
 * The add paths don't care: there, a band source that has no show or is
 * having a bad day falls through to setlist.fm silently, and that is the
 * whole design. A re-fetch the user asked for by pressing a button is the
 * opposite case — "the archive has no show on this date", "one field in the
 * adapter is wrong" and "the request failed" are otherwise the same
 * nothing-happened, which is precisely what made the admin re-sync
 * impossible to diagnose from the outside.
 *
 * `reason` is one of:
 *   'ok'                     the result carries a setlist
 *   'missing-artist-or-date' nothing to ask with
 *   'not-a-band-source'      this artist's setlists belong to setlist.fm
 *   'http-error'             the function answered, but not with 200
 *   'no-show'                the archive has no show on that date
 *   'no-songs'               a show on that date, but no songs on it
 *   'bad-date'               the stored date could not be read at all
 *   'fetch-failed'           network error or timeout
 *
 * `detail` is the upstream's own message where there is one, so it can be
 * shown verbatim rather than paraphrased.
 */
export async function fetchBandSetlistWithReason(args = {}) {
  const request = bandSetlistRequest(args);
  if (!request.source) return request;
  const { source, params } = request;
  const { artist, date } = args;

  try {
    const response = await withTimeout(fetch(apiUrl(`/api/band-setlist?${new URLSearchParams(params).toString()}`)));
    if (!response.ok) {
      // Includes the 503 a missing PHISHNET_API_KEY produces. Nothing to
      // tell the user about on an add — the setlist.fm path still works.
      console.warn(`[BAND-SETLIST] ${source.id} returned HTTP ${response.status} for ${artist} ${date}`);
      return { result: null, reason: 'http-error', detail: `HTTP ${response.status}` };
    }
    return bandSetlistResultFrom(source, await response.json(), { artist, date });
  } catch (err) {
    const message = err?.message || String(err);
    console.warn(`[BAND-SETLIST] ${source.id} fetch failed for ${artist} ${date}:`, message);
    return { result: null, reason: 'fetch-failed', detail: message };
  }
}

/**
 * fetchBandSetlist({ artist, artistMbid, date, venue })
 *   -> null | { source, songs, sourceShowId, sourcePermalink, setlistNotes,
 *               tour, ambiguous, candidates, message }
 *
 * Returns null for every "carry on with setlist.fm" case: artist has no
 * band source, the fetch failed, the source had no show on that date, or
 * the source returned a show with no songs. A caller can therefore treat
 * null as "nothing to do" without inspecting a reason — which is what all
 * three add paths want. Anything that needs the reason calls
 * fetchBandSetlistWithReason above.
 */
export async function fetchBandSetlist(args) {
  const { result } = await fetchBandSetlistWithReason(args);
  return result;
}

/**
 * enrichShowDataWithBandSetlist(showData)
 *   -> showData (unchanged), or showData with the band source's setlist
 *
 * The add-path hook. Takes a show document about to be written — already
 * carrying whatever setlist.fm gave it, which may be nothing — and swaps in
 * the band source's setlist if one exists for that artist and date.
 *
 * Always returns a usable show document. On any failure it returns the
 * input with `setlistSource: 'setlistfm'` stamped on it, so the stored
 * document always says where its setlist came from rather than leaving
 * later readers to guess.
 */
export async function enrichShowDataWithBandSetlist(showData) {
  if (!showData) return showData;
  const result = await fetchBandSetlist({
    artist: showData.artist,
    artistMbid: showData.artistMbid,
    date: showData.date,
    venue: showData.venue,
  });
  return applyBandSetlist(showData, result);
}
