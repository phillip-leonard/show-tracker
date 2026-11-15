// netlify/functions/lib/setlistOps.js — every change to a show's setlist
// from a source, in one place on the server (5.60.7, pre-native server
// moves Part 2).
//
// What it does, and who uses it:
//   propose        the band source's setlist merged into the show's, in
//                  memory (propose-setlist; the Internet Archive review)
//   apply          a proposal written, re-merged against the show as it is
//                  at write time (accept-proposal, resync-show)
//   stored         the Archive backfill's `setlistProposal`: accept
//                  (accept-proposal with no result), decline
//                  (reject-proposal)
//   scan           a show with no setlist: the band source, else setlist.fm
//                  (scan-missing-setlists, its scheduled run, the admin
//                  tools)
//
// THE RATINGS GUARD LIVES HERE AND ONLY HERE (lib/setlistNotes.js
// lostNotes): no write may leave a show with fewer rated or fewer commented
// songs than it had. It runs on every write path below, inside the
// transaction, against the show as it is at that moment; a write that
// fails it is refused and nothing is written. The merge rule
// (lib/bandSetlistMerge.js) already carries notes across; the guard is the
// check that it did.
//
// Until 5.60.7 this lived in the browser (AppContext's
// proposeSetlistFromSource, applySetlistProposal, acceptStoredProposal,
// scanForMissingSetlists), checked the copy of the show the app loaded
// rather than the stored one, and skipped the guard on two of its paths.
// iOS 3.13.22 and earlier still run that code.
//
// Reads that reach the network come in through `deps`, so tests stub them:
//   deps.bandSetlist(params)      -> band-setlist.js's JSON, or null
//   deps.searchSetlists(params)   -> search-setlists.js's JSON, or null

const { resolveSource } = require('../../../lib/setlistSources');
const {
  bandSetlistRequest, bandSetlistResultFrom, bandSetlistShowFields, mergeSourceSetlist, mergeNeedsWrite,
} = require('../../../lib/bandSetlistRules');
const { userNoteCounts, lostNotes } = require('../../../lib/setlistNotes');
const { extractSongsFromSetlist } = require('../../../lib/setlistParser');
const { setlistIsOnShowDate } = require('../../../lib/showIdentity');
const { showYear } = require('../../../lib/showDate');
const { reviewAccountReason, isSeedShowId } = require('./reviewAccounts');

/** What the app needs to know about a source (no functions, no config). */
function sourceSummary(source) {
  if (!source) return null;
  return {
    id: source.id || '',
    label: source.label || '',
    isBandSource: !!source.isBandSource,
    requiresReview: !!source.requiresReview,
    nameKey: source.nameKey || '',
    homeUrl: source.homeUrl || '',
  };
}

const sourceFor = (show) => resolveSource({ name: show.artist, mbid: show.artistMbid });

// ── The band source ───────────────────────────────────────────────────

/** { result, reason, detail } for this show's date, as the app's fetchBandSetlistWithReason. */
async function fetchBandResult(show, deps) {
  const request = bandSetlistRequest({ artist: show.artist, artistMbid: show.artistMbid, date: show.date, venue: show.venue });
  if (!request.source) return request;
  let data;
  try {
    data = await deps.bandSetlist(request.params);
  } catch (err) {
    return { result: null, reason: 'fetch-failed', detail: (err && err.message) || String(err) };
  }
  if (!data) return { result: null, reason: 'http-error', detail: '' };
  return bandSetlistResultFrom(request.source, data, { artist: show.artist, date: show.date });
}

/**
 * propose(show, fetched) -> { ok: true, source, result, setlist, summary }
 *   | { ok: false, reason, detail?, summary?, source }
 * The merge, in memory; nothing is written.
 */
function propose(show, fetched) {
  const source = sourceFor(show);
  if (!source.isBandSource) return { ok: false, reason: 'not-a-band-source', source: sourceSummary(source) };
  if (!fetched || !fetched.result) {
    return { ok: false, reason: (fetched && fetched.reason) || 'no-show', detail: (fetched && fetched.detail) || '', source: sourceSummary(source) };
  }
  const { setlist, changed, summary, result: chosen } = mergeSourceSetlist(show.setlist || [], fetched.result);
  if (!mergeNeedsWrite({ changed, summary }, show, bandSetlistShowFields(chosen, setlist))) {
    return { ok: false, reason: summary.skipped === 'ambiguous-date' ? 'ambiguous-date' : 'nothing-to-change', summary, source: sourceSummary(source) };
  }
  return { ok: true, source: sourceSummary(source), result: chosen, setlist, summary };
}

/**
 * apply(show, result, { onlyIfEmpty, extraFields, now })
 *   -> { ok: true, fields, summary, source, result, ambiguous, message }
 *   | { ok: false, reason, before?, after?, summary?, source }
 * The fields to write: the merge against `show` (the stored show, read in
 * the transaction), the user's review recorded (`reviewed`), the source's
 * tour only where the show has none. Refused by the ratings guard.
 */
function apply(show, result, { onlyIfEmpty = false, extraFields = {}, now } = {}) {
  const source = sourceSummary(sourceFor(show));
  if (!result || !Array.isArray(result.songs)) return { ok: false, reason: 'no-songs', source };
  if (onlyIfEmpty && (show.setlist || []).length > 0) return { ok: false, reason: 'has-setlist', source };

  const { setlist, changed, summary, result: chosen } = mergeSourceSetlist(show.setlist || [], result);
  const fields = {
    ...bandSetlistShowFields(chosen, setlist, { reviewed: true, now }),
    ...extraFields,
    ...(show.tour ? {} : (chosen.tour ? { tour: chosen.tour } : {})),
  };
  if (!mergeNeedsWrite({ changed, summary }, show, fields)) {
    return { ok: false, reason: summary.skipped === 'ambiguous-date' ? 'ambiguous-date' : 'nothing-to-change', summary, source };
  }
  if (lostNotes(show.setlist, setlist)) {
    return { ok: false, reason: 'would-lose-notes', before: userNoteCounts(show.setlist), after: userNoteCounts(setlist), summary, source };
  }
  return { ok: true, fields, summary, source, result: chosen, ambiguous: !!result.ambiguous, message: result.message || '' };
}

// ── The stored proposal (the Internet Archive backfill) ───────────────

/** The proposal on the show as a band-source result, as the app's acceptStoredProposal built it. */
function storedProposalResult(show) {
  const p = show.setlistProposal || {};
  return {
    source: p.source || 'archive',
    songs: p.songs || [],
    sourceShowId: p.sourceShowId || '',
    sourcePermalink: p.sourcePermalink || '',
    setlistNotes: p.setlistNotes || '',
    licenseUrl: p.licenseUrl == null ? null : p.licenseUrl,
    needsReview: !!p.needsReview,
    disagreement: p.disagreement || null,
    confidence: p.confidence || '',
    partial: !!p.partial,
    bandKey: sourceFor(show).nameKey || '',
    contested: [],
  };
}

function decided(show, status, now = () => new Date()) {
  return { ...(show.setlistProposal || {}), status, decidedAt: now().toISOString() };
}

// ── setlist.fm, for a show with no setlist ────────────────────────────

/**
 * The setlist.fm setlist for this show's night: setlist.fm has no date
 * search, so up to three pages of the artist's year, under the name as
 * stored, with "&" as "and", and with or without a leading "The" (the
 * app's scanForMissingSetlists, unchanged).
 */
async function findSetlistfmMatch(show, deps, { pause = () => new Promise((r) => setTimeout(r, 300)) } = {}) {
  const year = showYear(show.date);
  if (!show.artist || !year) return null;
  const variants = [show.artist];
  if (show.artist.includes('&')) variants.push(show.artist.replace(/&/g, 'and'));
  variants.push(/^the /i.test(show.artist) ? show.artist.slice(4) : `The ${show.artist}`);

  for (const artistName of variants) {
    for (let page = 1; page <= 3; page++) {
      const data = await deps.searchSetlists({ artistName, year, p: String(page) });
      // No answer at all (no key, setlist.fm down, a 5xx) is not "no
      // setlist": it is an error, so the show isn't recorded as checked and
      // is asked about again next time.
      if (data == null) throw Object.assign(new Error('setlist.fm search failed'), { code: 'search-failed' });
      const list = data.setlist || [];
      if (!list.length) break;
      const match = list.find((s) => setlistIsOnShowDate(s.eventDate, show.date));
      if (match) return match;
      if (list.length < 20) break;
      await pause();
    }
    await pause();
  }
  return null;
}

/** A setlist.fm setlist as the fields a scan writes (no user notes to carry: the show had no setlist). */
function setlistfmFields(match, { idFor } = {}) {
  const fields = {
    setlist: extractSongsFromSetlist(match, idFor ? { idFor } : {}),
    setlistfmId: match.id,
    setlistfmUrl: match.url || null,
    isManual: false,
    setlistSource: 'setlistfm',
  };
  if (match.tour && match.tour.name) fields.tour = match.tour.name;
  return fields;
}

/**
 * scanShow(show, deps) -> { via, kind, result? , match? } or { via: null }
 * What a scan would write for a show with no setlist, fetched outside the
 * transaction: the band source's setlist (sources whose setlists may be
 * written unasked; the Internet Archive's go through review), else
 * setlist.fm's.
 */
async function scanShow(show, deps, opts = {}) {
  const source = sourceFor(show);
  if (source.isBandSource && !source.requiresReview) {
    const fetched = await fetchBandResult(show, deps);
    if (fetched.result) return { via: source.id, kind: 'band', result: fetched.result };
  }
  const match = await findSetlistfmMatch(show, deps, opts);
  return match ? { via: 'setlistfm', kind: 'setlistfm', match } : { via: null };
}

/**
 * scanFields(show, scanned, { now, idFor }) -> { ok, fields } or { ok: false, reason }
 * Against the stored show, in the transaction: a show that has gained a
 * setlist since is merged (band) or left alone (setlist.fm), and the
 * guard runs either way.
 */
function scanFields(show, scanned, { now, idFor } = {}) {
  const current = Array.isArray(show.setlist) ? show.setlist : [];
  if (scanned.kind === 'band') {
    const { setlist, changed, summary, result: chosen } = mergeSourceSetlist(current, scanned.result);
    const fields = bandSetlistShowFields(chosen, setlist, { now });
    if (!mergeNeedsWrite({ changed, summary }, show, fields)) {
      return { ok: false, reason: summary.skipped === 'identical' ? 'already' : 'nothing-to-change' };
    }
    if (lostNotes(current, setlist)) return { ok: false, reason: 'would-lose-notes' };
    return { ok: true, fields };
  }
  if (scanned.kind === 'setlistfm') {
    if (current.length > 0) return { ok: false, reason: 'has-setlist' };
    const fields = setlistfmFields(scanned.match, { idFor });
    if (!fields.setlist.length) return { ok: false, reason: 'no-songs' };
    return { ok: true, fields };
  }
  return { ok: false, reason: 'none' };
}

// ── Writes ────────────────────────────────────────────────────────────

/**
 * inTransaction(db, uid, showId, decide) -> decide's answer
 * Reads users/{uid}/shows/{showId} in a transaction and calls
 * decide(show) -> { update?, ...answer }. `update` is written in the same
 * transaction; the rest is returned. A missing show is
 * { ok: false, reason: 'show-not-found' }.
 */
async function inTransaction(db, uid, showId, decide) {
  const ref = db.collection('users').doc(uid).collection('shows').doc(String(showId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'show-not-found' };
    const { update, ...answer } = decide({ id: snap.id, ...snap.data() });
    if (update && Object.keys(update).length) tx.update(ref, update);
    return answer;
  });
}

async function readShow(db, uid, showId) {
  const snap = await db.collection('users').doc(uid).collection('shows').doc(String(showId)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// ── The operations ────────────────────────────────────────────────────

async function proposeSetlist(db, uid, showId, deps) {
  const show = await readShow(db, uid, showId);
  if (!show) return { ok: false, reason: 'show-not-found' };
  return propose(show, await fetchBandResult(show, deps));
}

/**
 * acceptProposal: with `result` (what propose-setlist returned, after the
 * user looked at it), that result; with none, the stored setlistProposal,
 * recorded as accepted, or as blocked when the guard refuses it.
 */
async function acceptProposal(db, uid, showId, { result = null, onlyIfEmpty = false, now } = {}) {
  return inTransaction(db, uid, showId, (show) => {
    if (result) {
      const out = apply(show, result, { onlyIfEmpty, now });
      return out.ok ? { ...out, update: out.fields } : out;
    }
    const p = show.setlistProposal;
    if (!p || p.status !== 'pending') return { ok: false, reason: 'no-proposal' };
    const out = apply(show, storedProposalResult(show), { extraFields: { setlistProposal: decided(show, 'accepted', now) }, now });
    if (out.ok) return { ...out, update: out.fields };
    if (out.reason === 'would-lose-notes') {
      // Flagged, so the review list shows it and an admin can see why.
      const blocked = decided(show, 'blocked', now);
      return { ...out, fields: { setlistProposal: blocked }, update: { setlistProposal: blocked } };
    }
    return out;
  });
}

async function rejectProposal(db, uid, showId, { now } = {}) {
  return inTransaction(db, uid, showId, (show) => {
    if (!show.setlistProposal) return { ok: false, reason: 'no-proposal' };
    const setlistProposal = decided(show, 'declined', now);
    return { ok: true, fields: { setlistProposal }, update: { setlistProposal } };
  });
}

/** resync-show: propose, then apply against the stored show. Never an Archive setlist unreviewed. */
async function resyncShow(db, uid, showId, deps, { now } = {}) {
  const proposal = await proposeSetlist(db, uid, showId, deps);
  if (!proposal.ok) return proposal;
  if (proposal.source.requiresReview) return { ok: false, reason: 'needs-review', source: proposal.source };
  return inTransaction(db, uid, showId, (show) => {
    const out = apply(show, proposal.result, { now });
    return out.ok ? { ...out, update: out.fields } : out;
  });
}

/**
 * scanMissingSetlists(db, uid, deps, { showIds, budgetMs, write, mark })
 *   -> { scanned, found, results: [{ showId, status, via }], remaining }
 * The caller's shows with no setlist (or `showIds`), one at a time until
 * the time budget is spent; `remaining` are the ones not reached. `mark`
 * records setlistScanAt on every show scanned (the scheduled run uses it
 * to skip recently scanned shows).
 */
async function scanMissingSetlists(db, uid, deps, { showIds = null, budgetMs = 8000, write = true, mark = false, now = () => new Date(), clock = Date.now, pause } = {}) {
  const started = clock();
  let ids = showIds;
  if (!ids) {
    const snap = await db.collection('users').doc(uid).collection('shows').get();
    ids = snap.docs.filter((d) => !(d.data().setlist || []).length).map((d) => d.id);
  }
  const results = [];
  let i = 0;
  for (; i < ids.length; i++) {
    if (i > 0 && clock() - started > budgetMs) break;
    const showId = String(ids[i]);
    const show = await readShow(db, uid, showId);
    if (!show) { results.push({ showId, status: 'show-not-found' }); continue; }
    if ((show.setlist || []).length > 0) { results.push({ showId, status: 'has-setlist' }); continue; }
    if (!show.artist || !showYear(show.date)) { results.push({ showId, status: 'no-artist-or-date' }); continue; }
    let scanned;
    try {
      scanned = await scanShow(show, deps, pause ? { pause } : {});
    } catch (err) {
      // Nothing written, not even setlistScanAt: tried again next time.
      results.push({ showId, status: 'error', detail: err && (err.code || err.message) });
      continue;
    }
    if (!write) {
      results.push({ showId, status: scanned.via ? 'would-find' : 'none', via: scanned.via });
      continue;
    }
    const answer = await inTransaction(db, uid, showId, (current) => {
      const out = scanned.via ? scanFields(current, scanned, { now }) : { ok: false, reason: 'none' };
      const update = { ...(out.ok ? out.fields : {}), ...(mark ? { setlistScanAt: now().toISOString() } : {}) };
      return { ok: out.ok, reason: out.reason, fields: out.ok ? out.fields : null, update };
    });
    results.push({ showId, status: answer.ok ? 'found' : (answer.reason || 'none'), via: scanned.via, fields: answer.fields || undefined });
  }
  return {
    scanned: results.length,
    found: results.filter((r) => r.status === 'found').length,
    results,
    remaining: ids.slice(i).map(String),
  };
}

/**
 * scheduledScan(db, deps, { budgetMs, staleDays, write, now, clock })
 *   -> { candidates, scanned, found, byStatus, excludedUsers }
 * Every account's shows with no setlist, the longest unchecked first,
 * leaving out the App Review accounts and seed shows; each one scanned is
 * marked setlistScanAt and not asked about again for `staleDays`. Stops
 * when the time budget is spent; the next run carries on. Counts only.
 */
async function scheduledScan(db, deps, { budgetMs = 20000, staleDays = 30, write = true, now = () => new Date(), clock = Date.now, pause } = {}) {
  const started = clock();
  const [showsSnap, profilesSnap] = await Promise.all([db.collectionGroup('shows').get(), db.collection('userProfiles').get()]);
  const excluded = new Set(profilesSnap.docs.filter((d) => reviewAccountReason(d.data())).map((d) => d.id));
  const cutoff = now().getTime() - staleDays * 86400000;
  const candidates = [];
  for (const d of showsSnap.docs) {
    const parts = String(d.ref && d.ref.path || '').split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'shows') continue;
    const show = d.data();
    if ((show.setlist || []).length || excluded.has(parts[1]) || isSeedShowId(d.id)) continue;
    const at = Date.parse(show.setlistScanAt || '') || 0;
    if (at > cutoff) continue;
    candidates.push({ uid: parts[1], showId: d.id, at });
  }
  candidates.sort((a, b) => a.at - b.at || (a.uid < b.uid ? -1 : 1));
  const out = { candidates: candidates.length, scanned: 0, found: 0, byStatus: {}, excludedUsers: excluded.size };
  for (const c of candidates) {
    const left = budgetMs - (clock() - started);
    if (left <= 0) break;
    const res = await scanMissingSetlists(db, c.uid, deps, { showIds: [c.showId], budgetMs: left, write, mark: write, now, clock, pause });
    for (const r of res.results) {
      out.scanned += 1;
      if (r.status === 'found') out.found += 1;
      out.byStatus[r.status] = (out.byStatus[r.status] || 0) + 1;
    }
  }
  return out;
}

module.exports = {
  scheduledScan,
  sourceSummary,
  fetchBandResult,
  propose,
  apply,
  storedProposalResult,
  decided,
  findSetlistfmMatch,
  setlistfmFields,
  scanShow,
  scanFields,
  inTransaction,
  proposeSetlist,
  acceptProposal,
  rejectProposal,
  resyncShow,
  scanMissingSetlists,
};
