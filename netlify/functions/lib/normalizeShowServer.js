// netlify/functions/lib/normalizeShowServer.js — the server half of
// normalize-show (5.60.5): what lib/normalizeShow.js reads, for one
// signed-in user, and the write.
//
// Who may read what is decided here, not in lib/normalizeShow.js:
//   - a show tag only when it is addressed to the caller and still pending
//   - a pending email tag only when it was sent to the caller's own
//     (Firebase Auth) address and is still pending
//   - an upcoming show and the shows only under the caller's own uid
//
// The write (commitShow) runs in a transaction on users/{uid}/shows/{id}:
//   - new document, no duplicate             -> created
//   - 'setlistfm-id' / 'same-show' duplicate -> nothing created; a tag's
//                                                taggedBy goes onto the
//                                                existing show, as
//                                                AppContext.mergeTagDataIntoShow
//                                                did
//   - 'possible' duplicate                   -> nothing written unless the
//                                                caller confirmed (decision
//                                                3: it only ever prompts)
//   - the document exists with needsNormalization (written on the device,
//     offline) -> normalized in place, keeping what the user did to it
//     since: their rating and comment, and their song notes through the
//     merge rule (lib/bandSetlistMerge.js), with the ratings guard
//     (lib/setlistNotes.js) refusing any setlist that would lose one
//   - the document exists and is already normalized -> nothing written
// A tag (tag, email-tag) is marked accepted in the same transaction.

const { normalizeShowInput, InputError, SHOW_SCHEMA_VERSION } = require('../../../lib/normalizeShow');
const { mergeBandSetlist } = require('../../../lib/bandSetlistMerge');
const { lostNotes } = require('../../../lib/setlistNotes');
const { getSetlists } = require('./setlistfmSetlist');
const { internalProxyHeader } = require('./proxyLimit');
const { festivalsForShowFrom } = require('./festivalMatchServer');

const SETLISTFM_BUDGET_MS = 8000;

/** The reads lib/normalizeShow.js needs, scoped to one user. */
function serverDeps(db, user, { bandSetlistHandler } = {}) {
  const uid = user.uid;
  const email = String(user.email || '').trim().toLowerCase();
  return {
    async setlistfmSetlist(id) {
      const { setlists } = await getSetlists(db, [id], { budgetMs: SETLISTFM_BUDGET_MS });
      return setlists[id] || null;
    },
    async bandSetlist(params) {
      // In-process, as admin-resync-setlists does for the Archive: the same
      // code and cache as /api/band-setlist, exempt from its per-IP limit.
      const handler = bandSetlistHandler || require('../band-setlist').handler;
      const res = await handler({ httpMethod: 'GET', headers: { ...internalProxyHeader() }, queryStringParameters: params });
      if (!res || res.statusCode !== 200) return null;
      try { return JSON.parse(res.body); } catch { return null; }
    },
    async showTag(tagId) {
      const snap = await db.collection('showTags').doc(tagId).get();
      const tag = snap.exists ? snap.data() : null;
      return tag && tag.toUid === uid && tag.status === 'pending' ? tag : null;
    },
    async pendingEmailTag(tagId) {
      const snap = await db.collection('pendingEmailTags').doc(tagId).get();
      const tag = snap.exists ? snap.data() : null;
      return tag && email && String(tag.toEmail || '').toLowerCase() === email && tag.status === 'pending' ? tag : null;
    },
    // Which catalog festival the show may belong to (lib/festivalMatch.js
    // festivalsForShow): a suggestion, never written.
    festivalsForShow: (show) => festivalsForShowFrom(db, show),
    async upcomingShow(upcomingId) {
      const snap = await db.collection('users').doc(uid).collection('upcomingShows').doc(upcomingId).get();
      return snap.exists ? snap.data() : null;
    },
  };
}

// Tests replace the network reads (setlist.fm, the band source) here; the
// Firestore reads stay real against the in-memory Firestore.
let testDepsFactory = null;
function __setTestDeps(factory) { testDepsFactory = factory; }

/** serverDeps, or what a test put in its place. */
function depsFor(db, user) {
  const deps = serverDeps(db, user);
  return testDepsFactory ? { ...deps, ...testDepsFactory(db, user) } : deps;
}

async function userShows(db, uid) {
  const snap = await db.collection('users').doc(uid).collection('shows').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** The document as stored: no id, a server createdAt on create. */
function storedFields(show) {
  const { id: _id, ...rest } = show;
  return rest;
}

/**
 * A pending document (written on the device while offline) normalized in
 * place: the canonical fields, plus what the user did to it since.
 */
function mergePending(stored, show) {
  const merged = storedFields(show);
  delete merged.createdAt; // keep the document's own
  if (stored.rating != null) merged.rating = stored.rating;
  if (stored.comment) merged.comment = stored.comment;

  const existing = Array.isArray(stored.setlist) ? stored.setlist : [];
  const result = mergeBandSetlist(existing, show.setlist || []);
  // The merge carries the user's song notes onto the incoming songs; an
  // empty incoming setlist keeps the stored one outright.
  merged.setlist = result.setlist;
  if (lostNotes(existing, merged.setlist)) merged.setlist = existing;
  return merged;
}

/**
 * commitShow(db, uid, normalized, input, { confirmPossible, FieldValue })
 *   -> { written, showId, created?, updated?, duplicate?, mergedInto?,
 *        needsConfirmation?, alreadyNormalized? }
 */
async function commitShow(db, uid, normalized, input, { confirmPossible = false, FieldValue } = {}) {
  const { show, duplicate } = normalized;
  const shows = db.collection('users').doc(uid).collection('shows');
  const ref = shows.doc(show.id);
  const tagRef = input.kind === 'tag' ? db.collection('showTags').doc(String(input.tagId))
    : input.kind === 'email-tag' ? db.collection('pendingEmailTags').doc(String(input.pendingEmailTagId))
      : null;
  const ts = () => (FieldValue ? FieldValue.serverTimestamp() : new Date());

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const accept = () => { if (tagRef) tx.update(tagRef, { status: 'accepted' }); };

    if (snap.exists) {
      const stored = snap.data();
      if (!stored.needsNormalization) return { written: false, showId: show.id, alreadyNormalized: true, duplicate };
      // The flags are cleared, not deleted: the sweep asks for
      // needsNormalization == true, and the input stays readable as null.
      tx.set(ref, { ...mergePending(stored, show), normalizedAt: ts(), needsNormalization: false, normalizationInput: null }, { merge: true });
      accept();
      return { written: true, updated: true, showId: show.id, duplicate };
    }

    if (duplicate && duplicate.rule !== 'possible') {
      const existingRef = shows.doc(duplicate.showId);
      const existing = (await tx.get(existingRef)).data() || {};
      if (show.taggedBy && !existing.taggedBy) {
        tx.update(existingRef, { taggedBy: show.taggedBy, taggedByUid: show.taggedByUid || null });
      }
      accept();
      return { written: false, showId: duplicate.showId, mergedInto: duplicate.showId, duplicate };
    }
    if (duplicate && duplicate.rule === 'possible' && !confirmPossible) {
      return { written: false, showId: show.id, needsConfirmation: true, duplicate };
    }

    tx.set(ref, { ...storedFields(show), createdAt: ts() });
    accept();
    return { written: true, created: true, showId: show.id, duplicate };
  });
}

/**
 * normalizeOne(db, user, input, { mode, existingShows, deps, FieldValue })
 *   -> the endpoint's answer for one input (errors as { error: { code } })
 */
async function normalizeOne(db, user, input, { mode = 'preview', existingShows, deps, FieldValue, now } = {}) {
  try {
    const normalized = await normalizeShowInput(input, { deps, existingShows, now });
    const out = { show: normalized.show, duplicate: normalized.duplicate, band: normalized.band, festivalMatches: [] };
    // A show not already attached to a festival: which one it may belong to
    // (5.60.8). Only a suggestion; a failed lookup never fails the add.
    if (!normalized.show.festivalId && deps.festivalsForShow) {
      try { out.festivalMatches = await deps.festivalsForShow(normalized.show); } catch (err) {
        console.warn('normalize-show: festival lookup failed:', err && err.message);
      }
    }
    if (mode !== 'commit') return out;
    const committed = await commitShow(db, user.uid, normalized, input, { confirmPossible: input.confirmPossible === true, FieldValue });
    if (committed.written && committed.created) existingShows.push(normalized.show);
    return { ...out, ...committed };
  } catch (err) {
    if (err instanceof InputError) {
      return { error: { code: err.code, message: err.message } };
    }
    throw err;
  }
}

module.exports = { serverDeps, depsFor, __setTestDeps, userShows, commitShow, mergePending, normalizeOne, SHOW_SCHEMA_VERSION };
