// lib/setlistSourceAnswer.js — where a band's setlists come from, and the
// re-sync control the show page offers for it, as one answer (5.60.22,
// native Stage 1). Served by netlify/functions/setlist-source.js, so the
// native app asks rather than keeping its own copy of the band registry
// (docs/ios-native/DECISIONS.md, "Stage 1").
//
// The decision is lib/setlistSources.js resolveSource, unchanged. The
// wording is the web show page's (components/shows/ShowDetailView.jsx: the
// re-fetch button, its busy label and the hint under it), which keeps its
// own copy for now; change both together.
//
// CommonJS, like lib/setlistSources.js, so the function requires it.

const { resolveSource, sourceLabel, sourceHomeUrl, SETLISTFM_SOURCE_ID } = require('./setlistSources');

const MAX_NAME = 200;
const MAX_MBID = 64;

/** Trimmed text, or '' for anything that isn't a string. */
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Checks the request: the band's name (required), its MusicBrainz id and the
 * show's stored `setlistSource` (both optional).
 * -> { ok: true, artist, mbid, setlistSource } | { ok: false, error }
 */
function readSetlistSourceRequest(params = {}) {
  const artist = text(params.artist);
  const mbid = text(params.mbid);
  const setlistSource = text(params.setlistSource);
  if (!artist) return { ok: false, error: 'artist is required.' };
  if (artist.length > MAX_NAME) return { ok: false, error: `artist is at most ${MAX_NAME} characters.` };
  if (mbid && (mbid.length > MAX_MBID || !/^[0-9a-f-]+$/i.test(mbid))) return { ok: false, error: 'mbid is not a MusicBrainz id.' };
  if (setlistSource && (setlistSource.length > 40 || !/^[a-z0-9_-]+$/i.test(setlistSource))) return { ok: false, error: 'setlistSource is not a source id.' };
  return { ok: true, artist, mbid, setlistSource };
}

/**
 * The re-sync control for a band and, when given, the show's current source.
 *
 *   offered    whether the show page has the control at all (a band source)
 *   action     'resync'  -> resync-show { showId }, writes at once
 *              'review'  -> propose-setlist { showId }, show the user the
 *                           result, then accept-proposal { showId, result }
 *   label      the button: "Re-fetch from X" when the show's setlist
 *              already came from a band source, "Get setlist from X" otherwise
 *   busyLabel  while the request runs
 *   hint       the line under the button, or null
 */
function resyncOffer(source, setlistSource = '') {
  if (!source || !source.isBandSource) {
    return { offered: false, action: null, label: null, busyLabel: null, hint: null };
  }
  // An absent setlistSource means setlist.fm: every show written before
  // 5.33.0 has none (ShowDetailView isBandSourced).
  const fromBandSource = !!setlistSource && setlistSource !== SETLISTFM_SOURCE_ID;
  let hint = null;
  if (!fromBandSource) {
    hint = source.requiresReview
      ? "Reads the setlist from fan recordings of this show on the Internet Archive. You'll see it before anything changes, and your ratings and any songs you added are kept."
      : `This setlist came from setlist.fm. ${source.label} is the band's own archive — it has segues, footnotes and jam charts. Your ratings and any songs you added are kept.`;
  }
  return {
    offered: true,
    action: source.requiresReview ? 'review' : 'resync',
    label: fromBandSource ? `Re-fetch from ${source.label}` : `Get setlist from ${source.label}`,
    busyLabel: `Asking ${source.label}...`,
    hint,
  };
}

/**
 * setlistSourceAnswer({ artist, mbid?, setlistSource? }) -> the function's
 * 200 body (see netlify/functions/setlist-source.js).
 */
function setlistSourceAnswer({ artist, mbid = '', setlistSource = '' }) {
  const s = resolveSource({ name: artist, mbid });
  const answer = {
    ok: true,
    artist,
    source: {
      id: s.id,
      label: s.label,
      homeUrl: s.homeUrl,
      isBandSource: s.isBandSource,
      requiresReview: !!s.requiresReview,
      matchedOn: s.matchedOn,
    },
    resync: resyncOffer(s, setlistSource),
  };
  // The credit for the setlist the show has now, which is where it came
  // from, not where the registry would send the band today
  // (lib/setlistSources.js sourceLabel).
  if (setlistSource) {
    answer.stored = { id: setlistSource, label: sourceLabel(setlistSource), homeUrl: sourceHomeUrl(setlistSource) };
  }
  return answer;
}

module.exports = { readSetlistSourceRequest, resyncOffer, setlistSourceAnswer };
