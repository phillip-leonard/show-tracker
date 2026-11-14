/**
 * guestMerge — move shows saved on this device into the signed-in account
 * (5.59.10, guest rescue).
 *
 * A guest's shows live only in localStorage ('guest-shows', and the very
 * old 'concert-shows'). Until 5.59.10 signing up showed an "Import
 * Existing Shows?" dialog whose Skip button, and its Escape / back
 * gesture, deleted them for good. Now they are moved automatically, and
 * nothing on this device is removed until Firestore has confirmed the
 * write of each show.
 *
 * mergeGuestShows({ localShows, accountShows, writeShow }) →
 *   { saved, duplicates, failed }
 *     saved       documents written (built through buildShowDoc)
 *     duplicates  local shows the account already has (same id, or same
 *                 artist, venue and day in any date format): safe to drop
 *     failed      local shows whose write threw: KEEP these on the device
 *                 and try again next launch
 *
 * Pure apart from writeShow, so the partial-failure rules are unit tested.
 * Idempotent: a show written on an earlier, interrupted run is found again
 * (same artist, venue and day) and counted as a duplicate, not written twice.
 */

import { buildShowDoc, mintShowId } from '@/lib/showDoc';
import { findDuplicate } from '@/lib/showIdentity';

/** Parse a localStorage value that should hold a list of shows. */
export function readLocalShows(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((s) => s && typeof s === 'object') : [];
  } catch {
    return [];
  }
}

export async function mergeGuestShows({ localShows = [], accountShows = [], writeShow } = {}) {
  const saved = [];
  const duplicates = [];
  const failed = [];
  const known = [...accountShows];
  const takenIds = new Set(accountShows.map((s) => s.id));

  for (const local of localShows) {
    if (!local) continue;
    // Written on an earlier run that was interrupted before the device
    // copy was cleared.
    // findDuplicate also covers that case: the written copy is the same
    // artist, venue and day. A different show that merely has the same id
    // is not a duplicate; this one gets a fresh id below.
    if (findDuplicate(known, local)) {
      duplicates.push(local);
      continue;
    }

    // The guest's own id when it's a free, normal show id (guest shows are
    // built by addShow with mintShowId), so a retry finds it by id.
    const id = /^\d{13}$/.test(String(local.id || '')) && !takenIds.has(local.id) ? local.id : mintShowId();
    const { id: _ignored, createdAt: _created, isManual: _manual, ...data } = local;
    const doc = { ...buildShowDoc(data, id), migratedFromLocal: true };

    try {
      await writeShow(doc);
      saved.push(doc);
      known.push(doc);
      takenIds.add(id);
    } catch (error) {
      failed.push(local);
    }
  }
  return { saved, duplicates, failed };
}

/** The confirmation line for the toast, or null when there was nothing to move. */
export function mergeMessage({ saved = [], duplicates = [], failed = [] }) {
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (failed.length) {
    return {
      type: 'error',
      message: `${saved.length ? `${n(saved.length, 'show')} saved to your account. ` : ''}${n(failed.length, 'show')} couldn't be saved yet. They're still on this device, and we'll try again next time you open the app.`,
    };
  }
  if (saved.length) return { type: 'success', message: `${n(saved.length, 'show')} saved to your account.` };
  if (duplicates.length) return { type: 'success', message: 'The shows on this device were already in your account.' };
  return null;
}

// ── The rescue prompt ─────────────────────────────────────────────────

/** How long a dismissed "keep your shows" banner stays away. */
export const RESCUE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const RESCUE_DISMISSED_KEY = 'mysetlists_guest_rescue_dismissed_at';

/**
 * The banner shows to a guest with at least one show on this device,
 * unless they dismissed it in the last seven days.
 */
export function shouldShowRescue({ guestMode, showCount, dismissedAt, now = Date.now() }) {
  if (!guestMode || !(showCount > 0)) return false;
  const at = Number(dismissedAt);
  return !(at > 0 && now - at < RESCUE_SNOOZE_MS);
}
