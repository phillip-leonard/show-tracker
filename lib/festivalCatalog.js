// lib/festivalCatalog.js
//
// Festivals that came from the MySetlists catalog rather than from a user.
//
// The seeder (netlify/functions/admin-seed-festivals.js, document shape in
// netlify/functions/lib/festivalSeed.js) writes ordinary canonical
// festivals with createdBy "system:seed" and source "seed". Nobody created
// them, so the creator-only edit rule leaves them editable by the admin
// account alone, and the UI says so in place of "someone else created this".
//
// Two seed fields reach the screen, renamed on the way:
//   status "cut_short" → catalogStatus, a small note on the festival header.
//   notes             → catalogNote. Renamed because a user's own notes are
//                       `notes` on their attendance record, and the joined
//                       festival object carries both.

export const SEED_SOURCE = 'seed';

/** True for a canonical festival document (or a joined festival) from the catalog. */
export function isSeededFestival(festival) {
  return festival?.source === SEED_SOURCE || festival?.isSeeded === true;
}

/**
 * The catalog fields loadFestivals and joinFestival copy from a canonical
 * document onto the joined festival. Empty-ish for a user-created festival.
 */
export function catalogFields(canonical) {
  return {
    isSeeded: canonical?.source === SEED_SOURCE,
    catalogStatus: canonical?.status || null,
    catalogNote: canonical?.notes || null,
  };
}

export function isCutShort(festival) {
  return festival?.catalogStatus === 'cut_short';
}
