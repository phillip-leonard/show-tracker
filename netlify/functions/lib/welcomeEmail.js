/**
 * welcomeEmail — the one email a new user gets after saving their first
 * show (5.55.0): the template, and the decision about whether to send it.
 *
 * CommonJS and server-side, like emailLayout.js, because the send happens
 * in netlify/functions/send-welcome-email.js. lib/emailTemplates.js
 * re-exports welcomeEmail() so the browser can render the same thing.
 *
 * WHO GETS IT. Once per account, ever, recorded on
 * userProfiles/{uid}.welcomeEmail:
 *   { status: 'sending' | 'sent' | 'failed' | 'skipped_opt_out'
 *             | 'skipped_no_email' | 'skipped_existing',
 *     at, attempts, resendId?, error? }
 *
 * The browser calls the function when a save takes the account from 0
 * shows to some, but that count is the browser's in-memory list, which is
 * also 0 before the shows have loaded. So the server doesn't take its
 * word for it:
 *   - the account must have been created on or after WELCOME_EMAIL_START,
 *     which is what keeps every existing user out (no backfill, no marker
 *     script to remember)
 *   - it must have at least one show now
 *   - the claim is a transaction on the profile, so two calls at once
 *     send one email
 *   - a field that already exists means no send, except a 'failed' one
 *     with attempts left (MAX_ATTEMPTS in all)
 *
 * A 'sending' claim whose function died mid-send stays as it is: never
 * sending is the safe way for that to go wrong.
 */

const { welcomeEmail, SUBJECT, PREHEADER, LINKS, SAMPLE, showLink } = require('./welcomeEmailTemplate');
const { buildEmail, sendOne } = require('./outgoingEmail');
const { canEmail } = require('./emailPolicy');
const { normalizeEmail } = require('./unsubscribeToken');

// Accounts created before this never get the welcome email. It went out
// in 5.55.0; everyone already signed up by then has seen the app.
const WELCOME_EMAIL_START = Date.parse('2026-11-08T00:00:00Z');
const MAX_ATTEMPTS = 3;

// ── Decision ─────────────────────────────────────────────────────────

function firstNameOf(profile) {
  const fromProfile = String(profile?.firstName || '').trim();
  if (fromProfile) return fromProfile;
  // displayName on the profile is the server-filtered one; Auth's is not,
  // so it isn't used.
  const display = String(profile?.displayName || '').trim();
  return display ? display.split(/\s+/)[0] : '';
}

function accountCreatedAt(authUser) {
  const t = Date.parse(authUser?.metadata?.creationTime || '');
  return Number.isNaN(t) ? null : t;
}

/**
 * The claim, alone: may this call send? Pure, so the transaction and the
 * tests read the same rule.
 *   existing — the profile's welcomeEmail field, or undefined
 * → { claim: true, attempts } | { claim: false, reason }
 */
function decideClaim(existing) {
  if (!existing) return { claim: true, attempts: 1 };
  const attempts = Number(existing.attempts) || 1;
  if (existing.status === 'failed' && attempts < MAX_ATTEMPTS) return { claim: true, attempts: attempts + 1 };
  return { claim: false, reason: existing.status === 'failed' ? 'max_attempts' : 'already_handled' };
}

/**
 * processWelcomeEmail({ db, auth, uid, showId, now, replyTo })
 * → { status, ... }   never throws for an expected outcome.
 *
 * Statuses that write nothing: 'not_eligible' (no shows yet),
 * 'already_handled', 'max_attempts'. Everything else is written to the
 * profile.
 */
async function processWelcomeEmail({ db, auth, uid, showId = null, now = new Date(), replyTo = null }) {
  const profileRef = db.doc(`userProfiles/${uid}`);
  const record = (fields) => profileRef.set({ welcomeEmail: { at: now, ...fields } }, { merge: true });

  // At least one show, now. The named show when it's theirs, for the
  // personal line; otherwise any.
  const showsRef = db.collection(`users/${uid}/shows`);
  let show = null;
  if (showId && typeof showId === 'string' && showId.length <= 200 && !showId.includes('/')) {
    const snap = await showsRef.doc(showId).get();
    if (snap.exists) show = { id: snap.id, ...snap.data() };
  }
  if (!show) {
    const any = await showsRef.limit(1).get();
    if (any.empty) return { status: 'not_eligible', reason: 'no_shows' };
    show = { id: any.docs[0].id, ...any.docs[0].data() };
  }

  let authUser = null;
  try { authUser = await auth.getUser(uid); } catch { /* deleted mid-flight */ }

  // Claim, in a transaction: two calls at once send one email.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    const existing = snap.exists ? snap.data().welcomeEmail : undefined;
    const decision = decideClaim(existing);
    if (!decision.claim) return decision;
    const created = accountCreatedAt(authUser);
    if (!existing && (created == null || created < WELCOME_EMAIL_START)) {
      tx.set(profileRef, { welcomeEmail: { status: 'skipped_existing', at: now, attempts: 0 } }, { merge: true });
      return { claim: false, reason: 'skipped_existing', written: true };
    }
    tx.set(profileRef, { welcomeEmail: { status: 'sending', at: now, attempts: decision.attempts } }, { merge: true });
    return decision;
  });
  if (!claim.claim) return { status: claim.reason };
  const attempts = claim.attempts;

  const profileSnap = await profileRef.get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const email = normalizeEmail(authUser?.email || profile.email || '');

  // Opted out or suppressed: recorded, and never sent later, even if they
  // turn email back on.
  if (!(await canEmail({ uid, email: email || null, category: 'notification' }, { db }))) {
    await record({ status: 'skipped_opt_out', attempts });
    return { status: 'skipped_opt_out' };
  }
  if (!email) {
    await record({ status: 'skipped_no_email', attempts });
    return { status: 'skipped_no_email' };
  }

  const { subject, html } = welcomeEmail({
    firstName: firstNameOf(profile),
    artist: show.artist,
    venue: show.venue,
    showId: show.id,
  });
  const payload = buildEmail({
    recipient: { email, uid },
    subject,
    html,
    scope: 'all',
    source: 'notification:welcome',
    replyTo: replyTo || undefined,
  });

  let result;
  try {
    result = await sendOne(payload);
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  if (result.ok) {
    await record({ status: 'sent', attempts, resendId: result.id || null });
    return { status: 'sent', resendId: result.id || null };
  }
  const error = String(result.error || `Resend ${result.status}`).slice(0, 300);
  await record({ status: 'failed', attempts, error });
  return { status: 'failed', error, attempts };
}

module.exports = {
  welcomeEmail, processWelcomeEmail, decideClaim,
  WELCOME_EMAIL_START, MAX_ATTEMPTS, SUBJECT, PREHEADER, LINKS, SAMPLE, showLink,
};
