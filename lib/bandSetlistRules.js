// lib/bandSetlistRules.js — the band-source rules with no network in them
// (5.60.5), shared by the app (lib/bandSetlist.js, which does the fetch)
// and the server (normalize-show, which calls band-setlist.js in-process).
//
// Moved out of lib/bandSetlist.js unchanged, so a show built on the server
// is the one the app built: which request to make for a show
// (bandSetlistRequest), what a band-setlist response means
// (bandSetlistResultFrom), whether a setlist may be written unasked
// (canAutoApply), the fields it writes (bandSetlistShowFields), the merge
// (mergeSourceSetlist, mergeNeedsWrite), and the add-path decision
// (applyBandSetlist). CommonJS, like lib/showDate.js and lib/stats.
//
// `now` is a seam for tests and the golden fixtures: setlistFetchedAt is
// the only value here that depends on the clock.

const { toIsoDate } = require('./showDate');
const { resolveSource, SETLISTFM_SOURCE_ID, SETLIST_SOURCES, archiveArtistFor } = require('./setlistSources');
const { mergeBandSetlist, titleAliasesFor } = require('./bandSetlistMerge');
const { userNoteCounts } = require('./setlistNotes');

/**
 * bandSetlistRequest({ artist, artistMbid, date, venue })
 *   -> { source, params } to ask /api/band-setlist with, or
 *      { result: null, reason, detail } when there is nothing to ask.
 * The reasons are fetchBandSetlistWithReason's (lib/bandSetlist.js).
 */
function bandSetlistRequest({ artist, artistMbid, date, venue } = {}) {
  if (!artist || !date) return { result: null, reason: 'missing-artist-or-date', detail: '' };

  const source = resolveSource({ name: artist, mbid: artistMbid });
  if (!source.isBandSource) {
    return { result: null, reason: 'not-a-band-source', detail: '' };
  }

  // Show documents do not all store dates the same way (legacy
  // DD-MM-YYYY), so the request always carries the ISO day.
  const isoDate = toIsoDate(date);
  if (!isoDate) {
    return { result: null, reason: 'bad-date', detail: String(date || '') };
  }

  const params = { source: source.id, artist, date: isoDate };
  if (venue) params.venue = venue;
  if (source.sourceArtistFilter) params.artistId = source.sourceArtistFilter;
  return { source, params };
}

/**
 * bandSetlistResultFrom(source, data) -> { result, reason, detail }
 * What a 200 answer from band-setlist.js means, as fetchBandSetlistWithReason
 * reports it.
 */
function bandSetlistResultFrom(source, data, { artist = '', date = '' } = {}) {
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
function canAutoApply(result, { chosenByOverlap = false } = {}) {
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
function bandSetlistShowFields(result, setlist, { reviewed = false, now = () => new Date() } = {}) {
  const fields = {
    setlist,
    setlistSource: result.source,
    sourceShowId: result.sourceShowId || '',
    sourcePermalink: result.sourcePermalink || '',
    setlistNotes: result.setlistNotes || '',
    setlistFetchedAt: now().toISOString(),
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
function mergeSourceSetlist(existingSetlist, result) {
  const merged = mergeBandSetlist(existingSetlist || [], result?.songs || [], {
    aliases: titleAliasesFor(result?.bandKey),
    candidates: result?.contested,
    // The band's protected titles for the Internet Archive (Drums, Space
    // and Jam for Grateful Dead); see protectGroup.
    protectedGroup: result?.source === 'archive' ? archiveArtistFor(result.bandKey)?.protectedGroup : undefined,
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
 * mergeNeedsWrite(merged, show, fields) -> boolean
 *
 * Whether writing `fields` (bandSetlistShowFields plus anything else the
 * caller adds) would change `show`. The merge's `skipped: 'identical'`
 * covers the songs only: a setlist.fm show whose songs already match El
 * Goose still needs its setlistSource and permalink, and an accepted
 * proposal still needs its decision recorded. setlistFetchedAt alone is
 * not a change. Blank, false and missing count as one value, as in the
 * merge's own comparison.
 */
function mergeNeedsWrite(merged, show, fields) {
  if (merged.changed) return true;
  if (merged.summary?.skipped !== 'identical') return false;
  const blank = (v) => (v == null || v === false ? '' : JSON.stringify(v));
  return Object.entries(fields).some(([k, v]) => (
    k !== 'setlist' && k !== 'setlistFetchedAt' && blank(show?.[k]) !== blank(v)
  ));
}

/**
 * applyBandSetlist(showData, result, { now }) -> the show document to build
 *
 * The add-path decision, given what the band source answered (`result`,
 * or null when it had nothing): the input stamped with
 * `setlistSource: 'setlistfm'`, or the input with the band source's
 * setlist merged in and its fields. lib/bandSetlist.js
 * enrichShowDataWithBandSetlist is the fetch and then this.
 */
function applyBandSetlist(showData, result, { now } = {}) {
  if (!showData) return showData;

  const stamped = { ...showData, setlistSource: showData.setlistSource || SETLISTFM_SOURCE_ID };

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

  const fields = bandSetlistShowFields(merged.result, merged.setlist, { now });

  return {
    ...stamped,
    ...fields,
    // The source's own tour name, but only where the show hasn't already
    // got one. A user-entered or setlist.fm tour name is not worth
    // overwriting with a differently-spelled equivalent.
    tour: showData.tour || merged.result.tour || null,
  };
}

module.exports = {
  bandSetlistRequest,
  bandSetlistResultFrom,
  canAutoApply,
  bandSetlistShowFields,
  userNoteCounts,
  mergeSourceSetlist,
  mergeNeedsWrite,
  applyBandSetlist,
};
