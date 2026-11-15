// netlify/functions/lib/reviewAccounts.js — the App Review demo accounts
// (scripts/seed-review-account.js), which server jobs that change setlists
// leave alone: their setlists are fixtures Apple's reviewers see. One list,
// for admin-resync-setlists and the scheduled setlist scan (5.60.7).

const REVIEW_ACCOUNT_HANDLES = ['alexreviewer', 'jordanmills'];
const SEED_SHOW_ID_PREFIX = 'seed-';

/** Why this profile is left out ('App Review account (@x)', 'isTestUser'), or null. */
function reviewAccountReason(profile) {
  const p = profile || {};
  const handle = String(p.handleLower || p.handle || '').toLowerCase();
  if (REVIEW_ACCOUNT_HANDLES.includes(handle)) return `App Review account (@${handle})`;
  if (p.isTestUser === true) return 'isTestUser';
  return null;
}

const isSeedShowId = (id) => String(id || '').startsWith(SEED_SHOW_ID_PREFIX);

module.exports = { REVIEW_ACCOUNT_HANDLES, SEED_SHOW_ID_PREFIX, reviewAccountReason, isSeedShowId };
