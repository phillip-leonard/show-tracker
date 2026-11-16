// lib/showFieldEdits.js — one show-level field, edited on its own (5.60.25,
// native Stage 1 Part 3a).
//
// The native show page edits the show rating, the venue rating and the
// show's note (`comment`), each as one `updateData` of that field and
// nothing else, so an edit made on another device meanwhile is never erased
// (CLAUDE.md, R-06). This is what that write contains. The Swift app has its
// own copy (`ShowFieldEdit`); `fixtures/show-edits/fields.json` keeps the
// two the same, checked by lib/__tests__/showEditFixtures.test.js and the
// Swift `ShowFieldEditTests`.
//
// A cleared value is removed (`remove`, Firestore's `deleteField()`), the
// canonical shape's "absent when unrated / empty" (lib/showInputs.js;
// STAGE1-AUDIT S-8). The web still writes `rating: 0` and `comment: ''`;
// every reader treats 0, null, '' and absent alike, so both work.
//
// CommonJS, like lib/setlistEdits.js.

/** The fields this edits, and what kind of value each takes. */
const SHOW_FIELDS = Object.freeze({ rating: 'rating', venueRating: 'rating', comment: 'text' });

/**
 * showFieldEdit(field, value)
 *   -> { ok: true, set: { [field]: value } }   write this value
 *    | { ok: true, remove: [field] }           delete the field
 *    | { ok: false, error }                    'bad-field' | 'bad-rating' | 'bad-text'
 *
 * A rating is a whole number 1–10; null, undefined, 0 or '' clears it. A
 * note is trimmed at both ends (line breaks inside it stay); empty, null or
 * undefined clears it.
 */
function showFieldEdit(field, value) {
  const kind = Object.prototype.hasOwnProperty.call(SHOW_FIELDS, field) ? SHOW_FIELDS[field] : null;
  if (!kind) return { ok: false, error: 'bad-field' };

  if (kind === 'rating') {
    if (value === null || value === undefined || value === 0 || value === '') return { ok: true, remove: [field] };
    if (Number.isInteger(value) && value >= 1 && value <= 10) return { ok: true, set: { [field]: value } };
    return { ok: false, error: 'bad-rating' };
  }

  if (value === null || value === undefined) return { ok: true, remove: [field] };
  if (typeof value !== 'string') return { ok: false, error: 'bad-text' };
  const text = value.trim();
  return text ? { ok: true, set: { [field]: text } } : { ok: true, remove: [field] };
}

/**
 * The stored show after the edit, as Firestore would hold it: every other
 * field exactly as it was. For the fixtures; the app writes only the edit.
 */
function applyShowFieldEdit(show, edit) {
  if (!edit || !edit.ok) return show;
  const next = { ...show };
  for (const key of edit.remove || []) delete next[key];
  Object.assign(next, edit.set || {});
  return next;
}

module.exports = { SHOW_FIELDS, showFieldEdit, applyShowFieldEdit };
