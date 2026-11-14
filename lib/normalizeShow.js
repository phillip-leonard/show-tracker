// lib/normalizeShow.js — one show input in, the show document every app
// writes out (5.60.5, pre-native server moves Part 1a).
//
// The server's normalize-show (netlify/functions/normalize-show.js) runs
// this for every new show, so the web app and the Swift app write
// byte-identical documents, and the stored shape lives in one place:
//
//   input  ->  show data (lib/showInputs.js)
//          ->  the band source's setlist where the artist has one
//              (lib/bandSetlistRules.js applyBandSetlist, the add path's
//              merge, which can't lose a rating)
//          ->  the canonical shape (lib/showInputs.js canonicalShowData)
//          ->  the document (lib/showDoc.js buildShowDoc)
//          +   the duplicate verdict (lib/showIdentity.js classifyDuplicate)
//
// Pure apart from what `deps` reads, so the golden fixtures
// (fixtures/shows/) run it with every answer stubbed:
//   deps.setlistfmSetlist(id)          -> setlist.fm setlist JSON, or null
//   deps.bandSetlist(params)           -> band-setlist.js response JSON, or null
//   deps.showTag(tagId)                -> showTags doc for this user, or null
//   deps.pendingEmailTag(tagId)        -> pendingEmailTags doc for this user, or null
//   deps.upcomingShow(upcomingId)      -> users/{uid}/upcomingShows doc, or null
// The `deps` decide who may read what; this file trusts their answers.
//
// A stored show is never re-normalized from its stored fields: the sweep
// re-runs a pending show's own saved input (normalizationInput) and fixes
// only the date and isManual on documents older builds wrote
// (canonicalizeStoredShow below).
//
// Input kinds (input.kind):
//   setlistfm    { setlistfmId }, { setlist } or { row } (a row from the
//                app's tour and lineup lists): search, "Add all", tour
//                bulk add, ticket scan with a match
//   manual       { artist, venue, city, date, … } the form, a ticket-scan row
//                with no match, a band-source lookup by artist and date
//   csv-row      importSheet.showDataFor's output
//   festival-row { setlistfmId }, { setlist } or { row }, plus festivalId
//   tag          { tagId, asPastShow? }  a friend's tag the caller accepts;
//                a tag on an upcoming show only with asPastShow, once
//                its date has passed
//   email-tag    { pendingEmailTagId } a tag sent before the caller joined
//   upcoming     { upcomingId, setlistfmId? }  an upcoming show they went to
// Every kind but tag and email-tag also takes the caller's own
// `rating` and `comment`.

const { mintShowId, buildShowDoc } = require('./showDoc');
const { classifyDuplicate } = require('./showIdentity');
const { bandSetlistRequest, bandSetlistResultFrom, applyBandSetlist } = require('./bandSetlistRules');
const {
  canonicalShowData, showDataFromSetlistfm, showDataFromSetlistfmRow, showDataFromFields, showDataFromCsvRow,
  showDataFromTag, upcomingToShowData,
} = require('./showInputs');

/** Bumped when the canonical document changes; stored as normalizedVersion. */
const SHOW_SCHEMA_VERSION = 1;

const KINDS = ['setlistfm', 'manual', 'csv-row', 'festival-row', 'tag', 'email-tag', 'upcoming'];

// A minted show id: 13+ digits, the millisecond scheme every stored show
// uses (lib/showDoc.js). A client-minted id is kept, so a show written on
// the device while offline and normalized later stays one document.
const SHOW_ID = /^\d{13,16}$/;

class InputError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function userFields(input) {
  const out = {};
  if (input.rating !== undefined) out.rating = input.rating;
  if (input.comment !== undefined) out.comment = input.comment;
  return out;
}

async function setlistfmShowData(input, deps, opts) {
  if (input.row && typeof input.row === 'object') return showDataFromSetlistfmRow(input.row, opts);
  let setlist = input.setlist;
  if (!setlist && input.setlistfmId) {
    setlist = await deps.setlistfmSetlist(String(input.setlistfmId));
    if (!setlist) throw new InputError('setlist-not-found', 'setlist.fm has no setlist with that id.');
  }
  if (!setlist || typeof setlist !== 'object') throw new InputError('bad-input', 'A setlist.fm setlist, row or setlistfmId is required.');
  return showDataFromSetlistfm(setlist, opts);
}

/** The input as show data, before the band source and the canonical shape. */
async function showDataFor(input, deps, opts) {
  switch (input.kind) {
    case 'setlistfm':
      return { ...(await setlistfmShowData(input, deps, opts)), ...userFields(input) };
    case 'festival-row': {
      if (!input.festivalId) throw new InputError('bad-input', 'festivalId is required.');
      return { ...(await setlistfmShowData(input, deps, opts)), ...userFields(input), festivalId: String(input.festivalId) };
    }
    case 'manual':
      return { ...showDataFromFields(input), ...userFields(input) };
    case 'csv-row':
      return { ...showDataFromCsvRow(input), ...userFields(input) };
    case 'tag': {
      const tag = input.tagId && await deps.showTag(String(input.tagId));
      if (!tag) throw new InputError('tag-not-found', 'That tag isn’t yours or no longer exists.');
      if (tag.showData?.upcoming && input.asPastShow !== true) {
        throw new InputError('upcoming-tag', 'A tag on an upcoming show goes to the upcoming list.');
      }
      // An upcoming show's tag carries no setlist; accepted after its date,
      // it becomes an ordinary show with none yet.
      const data = showDataFromTag(tag.showData, { fromName: tag.fromName, fromUid: tag.fromUid });
      return tag.showData?.upcoming ? { ...data, setlist: [] } : data;
    }
    case 'email-tag': {
      const tag = input.pendingEmailTagId && await deps.pendingEmailTag(String(input.pendingEmailTagId));
      if (!tag) throw new InputError('tag-not-found', 'That tag isn’t yours or no longer exists.');
      return showDataFromTag(tag.showData, { fromName: tag.fromName, fromUid: tag.fromUid });
    }
    case 'upcoming': {
      const upcoming = input.upcomingId && await deps.upcomingShow(String(input.upcomingId));
      if (!upcoming) throw new InputError('upcoming-not-found', 'That upcoming show no longer exists.');
      const setlistData = input.setlistfmId || input.setlist ? await setlistfmShowData(input, deps, opts) : null;
      return { ...upcomingToShowData(upcoming, setlistData), ...userFields(input) };
    }
    default:
      throw new InputError('bad-kind', `input.kind must be one of: ${KINDS.join(', ')}.`);
  }
}

async function bandResultFor(showData, deps) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const request = bandSetlistRequest({
    artist: trim(showData.artist), artistMbid: trim(showData.artistMbid), date: trim(showData.date), venue: trim(showData.venue),
  });
  if (!request.source) return { result: null, reason: request.reason };
  let data = null;
  try {
    data = await deps.bandSetlist(request.params);
  } catch (err) {
    return { result: null, reason: 'fetch-failed', detail: err && err.message };
  }
  if (!data) return { result: null, reason: 'http-error' };
  return bandSetlistResultFrom(request.source, data, { artist: showData.artist, date: showData.date });
}

/**
 * normalizeShowInput(input, { deps, existingShows, now, idFor })
 *   -> { show, duplicate, band }
 *
 * show       the canonical document, with `id` (input.showId when it is a
 *            minted id, else a new one) and normalizedVersion
 * duplicate  null, or { showId, rule: 'setlistfm-id' | 'same-show' |
 *            'possible' } against existingShows (the caller's own shows)
 * band       { reason } from the band-source lookup ('ok', 'not-a-band-
 *            source', 'no-show', …), so a caller can say what happened
 * Throws InputError (with .code) for input it can't use.
 */
async function normalizeShowInput(input, { deps = {}, existingShows = [], now, idFor } = {}) {
  if (!input || typeof input !== 'object') throw new InputError('bad-input', 'An input is required.');
  if (!KINDS.includes(input.kind)) throw new InputError('bad-kind', `input.kind must be one of: ${KINDS.join(', ')}.`);
  const opts = idFor ? { idFor } : {};

  const raw = await showDataFor(input, deps, opts);
  if (!String(raw.artist || '').trim()) throw new InputError('bad-input', 'A show needs an artist.');
  if (!String(raw.date || '').trim()) throw new InputError('bad-input', 'A show needs a date.');

  const band = await bandResultFor(raw, deps);
  const enriched = applyBandSetlist(raw, band.result, { now });
  const canonical = canonicalShowData(enriched, opts);

  const id = input.showId && SHOW_ID.test(String(input.showId)) ? String(input.showId) : mintShowId();
  const show = { ...buildShowDoc(canonical, id, now ? { now } : {}), normalizedVersion: SHOW_SCHEMA_VERSION };

  const match = classifyDuplicate(existingShows, show);
  return {
    show,
    duplicate: match ? { showId: match.show.id, rule: match.rule } : null,
    band: { reason: band.reason || (band.result ? 'ok' : 'none') },
  };
}

/**
 * canonicalizeStoredShow(stored) -> { changes, fields } for a document an
 * older build wrote: only what a reader can get wrong, never what a user
 * wrote. The date as ISO when it can be read (B-06), `isManual` by the
 * buildShowDoc rule, and `setlist: []` when there is none. `changes` lists
 * the fields that differ; empty means nothing to write.
 */
function canonicalizeStoredShow(stored) {
  const { toIsoDate } = require('./showDate');
  const { isBandSourced } = require('./showDoc');
  const fields = {};
  const iso = toIsoDate(stored.date);
  if (iso && iso !== stored.date) fields.date = iso;
  const isManual = !stored.setlistfmId && !isBandSourced(stored);
  if (stored.isManual !== isManual) fields.isManual = isManual;
  if (!Array.isArray(stored.setlist)) fields.setlist = [];
  return { changes: Object.keys(fields), fields };
}

module.exports = { normalizeShowInput, canonicalizeStoredShow, InputError, SHOW_SCHEMA_VERSION, KINDS, SHOW_ID };
