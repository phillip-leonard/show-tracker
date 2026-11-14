// lib/showAdd.js — the app's half of adding a show (5.60.6, pre-native
// server moves Part 1b).
//
// Every add path sends an input to normalize-show
// (netlify/functions/normalize-show.js), which builds and writes the
// document; the app shows what the server wrote. When the server can't be
// reached (no signal at the venue, a timeout, a 5xx), the show is not
// lost and the user doesn't wait:
//
//   1. the app builds the document itself with the same code
//      (lib/normalizeShow.js, without the band-source lookup), shows it,
//      and writes it to Firestore with needsNormalization and the input
//   2. the input goes into this device's outbox (localStorage, per user)
//   3. when the app is back online it commits the outbox to normalize-show
//      under the same show id, which normalizes the document in place and
//      keeps whatever the user did to it meanwhile; the hourly
//      normalize-shows-sweep catches anything the device never sends
//
// Firestore's own offline cache stays off (lib/firebase.js), so the write
// in step 1 lives only in memory until the network returns: the outbox is
// what survives the app being closed. An outbox entry is committed only
// once that write has reached the server, or after a restart (when the
// in-memory write is gone), so a late device write can never land on top
// of the server's document.

import { authedFetch } from '@/lib/api';
import { storage } from '@/lib/storage';

export const OUTBOX_PREFIX = 'mysetlists_show_outbox:';
export const COMMIT_TIMEOUT_MS = 20000;
export const MAX_INPUTS_PER_REQUEST = 25;

/** Why normalize-show couldn't answer: the show goes to the outbox. */
export class OfflineError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new OfflineError('normalize-show timed out')), ms)),
  ]);
}

/**
 * commitShowInputs(inputs, { mode, fetchImpl, timeoutMs }) -> results[]
 *
 * One request per MAX_INPUTS_PER_REQUEST, in order. Each result is
 * normalize-show's (`{ show, duplicate, created | mergedInto |
 * needsConfirmation | updated | alreadyNormalized }` or `{ error: { code,
 * message } }`). Throws OfflineError when the server can't be reached or
 * answers with a status that says "try again later" (401 token trouble,
 * 429, 5xx); the caller keeps the inputs it hasn't got results for.
 */
export async function commitShowInputs(inputs, { mode = 'commit', fetchImpl = authedFetch, timeoutMs = COMMIT_TIMEOUT_MS, onProgress } = {}) {
  const results = [];
  for (let i = 0; i < inputs.length; i += MAX_INPUTS_PER_REQUEST) {
    const chunk = inputs.slice(i, i + MAX_INPUTS_PER_REQUEST);
    let response;
    try {
      response = await withTimeout(fetchImpl('/.netlify/functions/normalize-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, inputs: chunk }),
      }), timeoutMs);
    } catch (err) {
      if (err instanceof OfflineError) throw Object.assign(err, { done: results });
      throw Object.assign(new OfflineError(err?.message || 'network error'), { done: results });
    }
    if (!response.ok) throw Object.assign(new OfflineError(`normalize-show answered ${response.status}`, response.status), { done: results });
    const data = await response.json();
    results.push(...(data.results || []));
    if (onProgress) onProgress(results.length);
  }
  return results;
}

// ── The outbox ────────────────────────────────────────────────────────

const outboxKey = (uid) => `${OUTBOX_PREFIX}${uid}`;

/** [{ showId, input, at }] for this user on this device. */
export function readOutbox(uid) {
  if (!uid) return [];
  const list = storage.getJSON(outboxKey(uid));
  return Array.isArray(list) ? list.filter((e) => e && e.showId && e.input && e.input.kind) : [];
}

export function addToOutbox(uid, entry) {
  const list = readOutbox(uid).filter((e) => e.showId !== entry.showId);
  list.push({ at: new Date().toISOString(), ...entry });
  storage.setJSON(outboxKey(uid), list);
  return list;
}

export function removeFromOutbox(uid, showIds) {
  const gone = new Set(showIds);
  const list = readOutbox(uid).filter((e) => !gone.has(e.showId));
  if (list.length) storage.setJSON(outboxKey(uid), list);
  else storage.remove(outboxKey(uid));
  return list;
}

/**
 * The input as it is stored with a pending show and in the outbox: the
 * kind and its fields, never the show id (the document's own id is used).
 */
export function storedInput(input) {
  const { showId: _showId, ...rest } = input || {};
  return rest;
}

/**
 * deviceShowWrite(show, input) -> what the app writes when normalize-show
 * can't be reached: the Firestore fields (no id; the caller adds
 * createdAt), the copy the app holds in `shows`, and the outbox entry. The
 * input is stored with the show so the sweep can finish it if this device
 * never does; a possible duplicate was already confirmed (or wasn't one)
 * by the time this is written.
 */
export function deviceShowWrite(show, input) {
  const normalizationInput = { ...storedInput(input), confirmPossible: true };
  const { id, ...fields } = show;
  return {
    id,
    fields: { ...fields, needsNormalization: true, normalizationInput },
    local: { ...show, needsNormalization: true, normalizationInput },
    outboxEntry: { showId: id, input: normalizationInput },
  };
}

/**
 * The question for a "possible duplicate" (same artist and day, venue
 * spelled differently): it is only ever asked, never decided for the user.
 */
export function possibleDuplicateQuestion(existing, show) {
  const where = (s) => [s?.venue, s?.city].filter(Boolean).join(', ') || 'another venue';
  return `You already have ${existing?.artist || show?.artist || 'this band'} on ${show?.date || 'this date'} at ${where(existing)}.\n\n`
    + `Add ${where(show)} as a separate show?`;
}
