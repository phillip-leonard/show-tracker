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
import { toIsoDate } from '@/lib/utils';
import { resolveSource, SETLISTFM_SOURCE_ID, SETLIST_SOURCES } from '@/lib/setlistSources';
import { mergeBandSetlist, titleAliasesFor } from '@/lib/bandSetlistMerge';
import internetArchive from '@/config/internet-archive.json';

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
export async function fetchBandSetlistWithReason({ artist, artistMbid, date, venue } = {}) {
  if (!artist || !date) return { result: null, reason: 'missing-artist-or-date', detail: '' };

  const source = resolveSource({ name: artist, mbid: artistMbid });
  if (!source.isBandSource) {
    return { result: null, reason: 'not-a-band-source', detail: '' };
  }

  // Show documents do not all store dates the same way — the ticket scanner
  // saved setlist.fm's DD-MM-YYYY verbatim while every other add path
  // reversed it — and parseDate handles both, so the app DISPLAYS such a
  // show correctly and then asked the archive for a date it has never
  // heard of. Normalized here, at the one place that builds the request.
  const isoDate = toIsoDate(date);
  if (!isoDate) {
    return { result: null, reason: 'bad-date', detail: String(date || '') };
  }

  const params = new URLSearchParams({ source: source.id, artist, date: isoDate });
  if (venue) params.set('venue', venue);
  if (source.sourceArtistFilter) params.set('artistId', source.sourceArtistFilter);

  try {
    const response = await withTimeout(fetch(apiUrl(`/api/band-setlist?${params.toString()}`)));
    if (!response.ok) {
      // Includes the 503 a missing PHISHNET_API_KEY produces. Nothing to
      // tell the user about on an add — the setlist.fm path still works.
      console.warn(`[BAND-SETLIST] ${source.id} returned HTTP ${response.status} for ${artist} ${date}`);
      return { result: null, reason: 'http-error', detail: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (!data?.ok || !Array.isArray(data.songs) || data.songs.length === 0) {
      if (data?.message) console.log(`[BAND-SETLIST] ${source.id} ${artist} ${date}: ${data.message}`);
      // Two different findings, worth keeping apart: the archive has no
      // show on this date at all, or it has one whose rows all dropped —
      // which means a field mapping is wrong, not that nothing was played.
      // selectShow in netlify/functions/band-setlist.js returns `shows: []`
      // for the first and a populated `candidates` for the second.
      const hadShow =
        (Array.isArray(data?.candidates) && data.candidates.length > 0) ||
        (Array.isArray(data?.shows) && data.shows.length > 0) ||
        (data?.droppedUntitledCount || 0) > 0;

      return {
        result: null,
        reason: hadShow ? 'no-songs' : 'no-show',
        detail: data?.message || '',
      };
    }

    if (data.ambiguous) {
      // Surfaced rather than swallowed: more than one show on this date and
      // the function had to choose. See selectShow in
      // netlify/functions/band-setlist.js.
      console.warn(`[BAND-SETLIST] ${artist} ${date}: ${data.message}`);
    }

    return {
      reason: 'ok',
      detail: data.message || '',
      result: {
        source: source.id,
        songs: data.songs,
        sourceShowId: data.sourceShowId || '',
        sourcePermalink: data.sourcePermalink || '',
        setlistNotes: data.setlistNotes || '',
        tour: data.tour || '',
        ambiguous: !!data.ambiguous,
        candidates: data.candidates || [],
        // How band-setlist.js picked the show, and the shows it picked
        // from when the venue couldn't decide; see mergeSourceSetlist.
        selection: data.selection || 'only',
        contested: Array.isArray(data.contested) ? data.contested : [],
        // The artist name key, which keys the band's title aliases.
        bandKey: source.nameKey || '',
        message: data.message || '',
        // Internet Archive only; see canAutoApply below.
        confidence: data.confidence || '',
        parsedFrom: data.parsedFrom || '',
        partial: !!data.partial,
        itemCount: data.itemCount || 0,
        needsReview: !!data.needsReview,
        disagreement: data.disagreement || null,
        licenseUrl: data.licenseUrl == null ? null : data.licenseUrl,
        sourceType: data.sourceType || '',
        showSlot: data.showSlot || '',
      },
    };
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
 * canAutoApply(result) -> boolean
 *
 * Whether a fetched band-source setlist may be written without the user
 * seeing it first. True for El Goose and Phish.net, which publish reviewed
 * setlists. For a source with `requiresReview` (the Internet Archive, whose
 * setlists are reconstructed from tape descriptions), only when the
 * setlist was read from text with explicit set headers, from a complete
 * tape, on a date with no early/late-show doubt. Anything less is offered
 * for review and never written unasked.
 *
 * `chosenByOverlap` is the evidence an early/late date needs: the show's
 * existing setlist (setlist.fm's, on an add) matched one of the two shows
 * well enough for the merge rule to choose it. Without it the date stays
 * ambiguous and setlist.fm's setlist stands.
 *
 * Tapes that disagree do NOT stop the write: the selection rule picks one
 * and the show is marked `needsReview` (see bandSetlistShowFields).
 */
export function canAutoApply(result, { chosenByOverlap = false } = {}) {
  if (!result) return false;
  if (!SETLIST_SOURCES[result.source]?.requiresReview) return true;
  return result.confidence === 'explicit-sets' && !result.partial && (!result.ambiguous || chosenByOverlap);
}

/**
 * The show-document fields a band-sourced setlist contributes, so callers
 * write the same keys in the same way every time.
 *
 * `setlistSource` is the field everything downstream branches on. Nothing
 * should infer the source by sniffing for the presence of `footnote` or
 * `transitionMark` — a Goose show where nobody wrote any footnotes is still
 * a Goose show from El Goose.
 */
//
// A source with `requiresReview` (the Internet Archive) also records the
// recording's license (`sourceLicenseUrl`, null when the item has none,
// which is every item checked so far) and `needsReview`, set when the
// tapes of the night disagreed and the selection rule had to pick one.
// `reviewed` is true when the user has just looked at this setlist and
// accepted it, which answers the review.
export function bandSetlistShowFields(result, setlist, { reviewed = false } = {}) {
  const fields = {
    setlist,
    setlistSource: result.source,
    sourceShowId: result.sourceShowId || '',
    sourcePermalink: result.sourcePermalink || '',
    setlistNotes: result.setlistNotes || '',
    setlistFetchedAt: new Date().toISOString(),
    isManual: false,
  };
  if (SETLIST_SOURCES[result.source]?.requiresReview || result.source === 'archive') {
    fields.sourceLicenseUrl = result.licenseUrl == null ? null : result.licenseUrl;
    fields.needsReview = !reviewed && !!result.needsReview;
    fields.needsReviewReason = fields.needsReview && result.disagreement
      ? { with: result.disagreement.with || '', overlap: result.disagreement.overlap ?? null }
      : null;
  }
  return fields;
}

/**
 * userNoteCounts(setlist) -> { rated, commented }
 *
 * What the user has said about a show's songs, counted the way the stats
 * check in AppContext.applySetlistProposal compares them before and after a
 * merge. A song with an empty comment string has no comment.
 */
export function userNoteCounts(setlist) {
  const songs = Array.isArray(setlist) ? setlist : [];
  return {
    rated: songs.filter((x) => x && x.rating != null).length,
    commented: songs.filter((x) => x && (typeof x.comment === 'string' ? x.comment.trim() !== '' : x.comment != null)).length,
  };
}

/**
 * mergeSourceSetlist(existingSetlist, result)
 *   -> { setlist, changed, summary, result }
 *
 * The one way a fetched band-source result is merged into a show: the
 * merge rule (lib/bandSetlistMerge.js) with the band's title aliases, and,
 * on a date the source has more than one show for, the contested shows so
 * the existing setlist can choose between them. The returned `result` is
 * the chosen show's when there was a choice, so bandSetlistShowFields
 * writes its id, permalink and notes rather than the one band-setlist.js
 * happened to put first.
 */
export function mergeSourceSetlist(existingSetlist, result) {
  const merged = mergeBandSetlist(existingSetlist || [], result?.songs || [], {
    aliases: titleAliasesFor(result?.bandKey),
    candidates: result?.contested,
    // Drums, Space and Jam for the Internet Archive; see protectGroup.
    protectedGroup: result?.source === 'archive' ? internetArchive.protectedGroup : undefined,
  });
  const chosen = merged.chosenCandidate;
  const effective = chosen
    ? {
        ...result,
        songs: chosen.songs || [],
        sourceShowId: chosen.sourceShowId || '',
        sourcePermalink: chosen.sourcePermalink || '',
        setlistNotes: chosen.setlistNotes || '',
        tour: chosen.tour || result.tour || '',
        // The Archive's per-show fields: an early/late pick is judged on
        // the show it picked, not the one listed first.
        ...(chosen.confidence !== undefined ? {
          confidence: chosen.confidence || '',
          parsedFrom: chosen.parsedFrom || '',
          partial: !!chosen.partial,
          needsReview: !!chosen.needsReview,
          disagreement: chosen.disagreement || null,
          licenseUrl: chosen.licenseUrl == null ? null : chosen.licenseUrl,
          sourceType: chosen.sourceType || '',
          showSlot: chosen.showSlot || '',
        } : {}),
      }
    : result;
  return {
    setlist: merged.setlist,
    changed: merged.changed,
    summary: merged.summary,
    result: effective,
    chosenByOverlap: !!chosen && merged.summary?.candidates?.reason === 'overlap',
  };
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

  const stamped = { ...showData, setlistSource: showData.setlistSource || SETLISTFM_SOURCE_ID };

  const result = await fetchBandSetlist({
    artist: showData.artist,
    artistMbid: showData.artistMbid,
    date: showData.date,
    venue: showData.venue,
  });

  if (!result) return stamped;

  // Merged rather than assigned even on a fresh add. A "fresh" add is not
  // always fresh — the ticket scanner and the festival lineup modal can
  // both re-add over a show that already has a setlist, and addShow's own
  // duplicate check hands off to mergeTagDataIntoShow rather than creating
  // a second document. Going through the merge rules means there is exactly
  // one code path that can replace a setlist, and it is the one that cannot
  // destroy a rating.
  const merged = mergeSourceSetlist(showData.setlist || [], result);
  // An 'identical' setlist still takes the source's show fields: a show
  // whose songs already match the band source may not say so yet
  // (setlistSource, permalink), and this builds a document, so there is no
  // write to save.
  if (!merged.changed && merged.summary.skipped !== 'identical') return stamped;

  // A Grateful Dead setlist reconstructed from tapes is only taken on an
  // add when it came with explicit set breaks from a complete tape, and on
  // an early/late date only when setlist.fm's setlist picked the show.
  // Otherwise the add keeps whatever setlist.fm gave it, and the user can
  // still review the Archive's version from the show page. Judged after
  // the merge, so an early/late pick is judged on the show it picked.
  if (!canAutoApply(merged.result, { chosenByOverlap: merged.chosenByOverlap })) return stamped;

  const fields = bandSetlistShowFields(merged.result, merged.setlist);

  return {
    ...stamped,
    ...fields,
    // The source's own tour name, but only where the show hasn't already
    // got one. A user-entered or setlist.fm tour name is not worth
    // overwriting with a differently-spelled equivalent.
    tour: showData.tour || merged.result.tour || null,
  };
}
