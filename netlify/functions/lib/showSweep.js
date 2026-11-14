// netlify/functions/lib/showSweep.js — the safety net behind normalize-show
// (5.60.5). Two passes, both counts-only:
//
//   pending  documents the app wrote on the device with needsNormalization
//            (offline, or before normalize-show answered): each is
//            normalized from its own saved input (normalizationInput)
//            exactly as normalize-show would, in place, keeping what the
//            user did to it since (normalizeShowServer.commitShow). A
//            pending document with no usable input gets only the stored
//            fixes below and its flag cleared.
//   stored   every show (the full pass): the fixes a document from an older
//            build may need, and nothing a user wrote
//            (lib/normalizeShow.js canonicalizeStoredShow): the date as
//            ISO, isManual by the rule, a missing setlist as [].
//
// Used by the hourly normalize-shows-sweep function (pending every run, the
// full pass once a day) and scripts/normalize-shows.js (dry run by default).

const { normalizeShowInput, canonicalizeStoredShow, KINDS } = require('../../../lib/normalizeShow');
const { depsFor: serverDepsFor, userShows, commitShow } = require('./normalizeShowServer');

const BATCH = 400;

function uidOf(docSnap) {
  const parts = String(docSnap.ref && docSnap.ref.path || '').split('/');
  return parts.length === 4 && parts[0] === 'users' && parts[2] === 'shows' ? parts[1] : null;
}

const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };

/**
 * sweepPending(db, { write, emailFor, FieldValue, deps }) -> counts
 * emailFor(uid) -> the account's address (for an email-tag input).
 */
async function sweepPending(db, { write = false, emailFor = async () => null, FieldValue, depsFor } = {}) {
  const snap = await db.collectionGroup('shows').where('needsNormalization', '==', true).get();
  const counts = { found: 0, normalized: 0, wouldNormalize: 0, noInput: 0, failed: {} };
  const showsByUid = new Map();

  for (const docSnap of snap.docs) {
    const uid = uidOf(docSnap);
    if (!uid) continue;
    counts.found += 1;
    const stored = docSnap.data();
    const input = stored.normalizationInput;

    if (!input || typeof input !== 'object' || !KINDS.includes(input.kind)) {
      counts.noInput += 1;
      if (write) {
        const { fields } = canonicalizeStoredShow(stored);
        await docSnap.ref.update({ ...fields, needsNormalization: false, normalizationInput: null });
      }
      continue;
    }

    try {
      if (!showsByUid.has(uid)) showsByUid.set(uid, await userShows(db, uid));
      const user = { uid, email: await emailFor(uid) };
      const deps = depsFor ? depsFor(user) : serverDepsFor(db, user);
      const normalized = await normalizeShowInput({ ...input, showId: docSnap.id }, { deps, existingShows: showsByUid.get(uid) });
      if (!write) { counts.wouldNormalize += 1; continue; }
      const done = await commitShow(db, uid, normalized, input, { confirmPossible: true, FieldValue });
      if (done.written) counts.normalized += 1;
    } catch (err) {
      bump(counts.failed, (err && err.code) || 'error');
    }
  }
  return counts;
}

/** sweepStored(db, { write }) -> counts of the stored fixes, by field. */
async function sweepStored(db, { write = false } = {}) {
  const snap = await db.collectionGroup('shows').get();
  const counts = { scanned: 0, changed: 0, byField: {} };
  const updates = [];
  for (const docSnap of snap.docs) {
    if (!uidOf(docSnap)) continue;
    counts.scanned += 1;
    const { changes, fields } = canonicalizeStoredShow(docSnap.data());
    if (!changes.length) continue;
    counts.changed += 1;
    changes.forEach((f) => bump(counts.byField, f));
    updates.push([docSnap.ref, fields]);
  }
  if (write) {
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = db.batch();
      updates.slice(i, i + BATCH).forEach(([ref, fields]) => batch.update(ref, fields));
      await batch.commit();
    }
  }
  return counts;
}

/**
 * shapeReport(db) -> how stored shows differ from the canonical shape new
 * documents have (lib/showInputs.js canonicalShowData), by field, counts
 * only. Read-only and informational: the stored pass changes none of
 * these, since every reader treats '', null and absent the same.
 */
async function shapeReport(db) {
  const { canonicalShowData } = require('../../../lib/showInputs');
  const snap = await db.collectionGroup('shows').get();
  const out = { scanned: 0, differ: 0, byField: {} };
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  for (const docSnap of snap.docs) {
    if (!uidOf(docSnap)) continue;
    out.scanned += 1;
    const stored = docSnap.data();
    const canon = canonicalShowData(stored, { idFor: (i) => `__${i}` });
    const fields = new Set([...Object.keys(stored), ...Object.keys(canon)]);
    let differs = false;
    for (const f of fields) {
      if (f === 'setlist') {
        const a = Array.isArray(stored.setlist) ? stored.setlist : [];
        if (a.length !== canon.setlist.length) { bump(out.byField, 'setlist: untitled entries'); differs = true; }
        else if (a.some((x, i) => x && (x.name !== canon.setlist[i].name))) { bump(out.byField, 'setlist: untrimmed song names'); differs = true; }
        else if (a.some((x) => x && typeof x.id !== 'string')) { bump(out.byField, 'setlist: songs without a string id'); differs = true; }
        continue;
      }
      if (!same(stored[f], canon[f])) {
        const empty = (v) => v === undefined || v === null || v === '';
        const kind = empty(stored[f]) && empty(canon[f]) ? `${f}: ${JSON.stringify(stored[f] === undefined ? 'absent' : stored[f])} where the new shape has ${canon[f] === undefined ? 'it absent' : JSON.stringify(canon[f])}`
          : canon[f] === undefined ? `${f}: '' or null, absent in the new shape`
          : stored[f] === undefined ? `${f}: absent, ${JSON.stringify(canon[f])} in the new shape`
            : `${f}: ${typeof stored[f] === 'string' && stored[f].trim() === canon[f] ? 'untrimmed' : 'differs'}`;
        bump(out.byField, kind);
        differs = true;
      }
    }
    if (differs) out.differ += 1;
  }
  return out;
}

module.exports = { sweepPending, sweepStored, shapeReport };
