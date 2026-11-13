/**
 * emailPolicy — who may be emailed, and the record of who asked not to be.
 *
 * Every send path runs its recipient through canEmail() on the server.
 * Nothing in the browser decides this any more: the old client-side check
 * read another user's profile and, if that read failed, sent anyway.
 *
 * THE STATE (three places, deliberately):
 *   userProfiles/{uid}.emailOptOut          — blocks every category
 *   userProfiles/{uid}.announcementsOptOut  — blocks announcements only
 *   emailSuppressions/{sha256(email)}       — by address, for people with
 *       no account (scope 'all' | 'announcements'). Checked for account
 *       holders too, so someone who unsubscribed from an invite and then
 *       signed up stays unsubscribed until they say otherwise in Profile.
 *
 * THE LOG: unsubscribeEvents/{autoId}, append-only, one entry per
 * unsubscribe or re-subscribe, whatever the channel. Server-only.
 */

const { normalizeEmail, hashEmail } = require('./unsubscribeToken');

const CATEGORIES = ['transactional', 'notification', 'announcement'];

/**
 * The truth table, as a pure function, so the recipient builder and
 * canEmail() cannot disagree.
 *   profile           — the recipient's userProfiles data, or null
 *   suppressionScope  — 'all' | 'announcements' | null
 */
function decideCanEmail({ profile, suppressionScope, category }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown email category: ${category}`);
  if (profile && profile.emailOptOut === true) return false;
  if (category === 'announcement' && profile && profile.announcementsOptOut === true) return false;
  if (suppressionScope === 'all') return false;
  if (suppressionScope === 'announcements' && category === 'announcement') return false;
  return true;
}

/**
 * Firebase Auth when the function has credentials, else null (unit tests
 * that don't inject one). Since 5.59.7 profiles don't carry `email` (S-01),
 * so Auth is how an address finds its account.
 */
function defaultAuth() {
  try { return require('./firebaseAdmin').getAdminAuth(); } catch { return null; }
}

/**
 * The account behind an address: { uid, data } (data is the profile, or
 * {} if it has none), or null. A profile that still carries the pre-5.59.7
 * `email` field is found directly; otherwise Auth names the uid.
 */
async function findProfileByEmail(db, email, auth = defaultAuth()) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const snap = await db.collection('userProfiles').where('email', '==', e).limit(1).get();
  if (!snap.empty) return { uid: snap.docs[0].id, data: snap.docs[0].data() };
  if (auth) {
    try {
      const u = await auth.getUserByEmail(e);
      if (u && u.uid) {
        const p = await db.doc(`userProfiles/${u.uid}`).get();
        return { uid: u.uid, data: p.exists ? p.data() : {} };
      }
    } catch { /* no such account */ }
  }
  return null;
}

/**
 * The account behind an address, if there is one: profile first (it's
 * what the app writes), then Firebase Auth (in case the profile's email
 * was never stored or differs in case).
 */
async function resolveRecipient(db, auth, email) {
  const e = normalizeEmail(email);
  const byProfile = await findProfileByEmail(db, e);
  if (byProfile) return { uid: byProfile.uid, email: e, profile: byProfile.data };
  if (auth) {
    try {
      const u = await auth.getUserByEmail(e);
      if (u?.uid) {
        const p = await db.doc(`userProfiles/${u.uid}`).get();
        return { uid: u.uid, email: e, profile: p.exists ? p.data() : null };
      }
    } catch { /* no such user */ }
  }
  return { uid: null, email: e, profile: null };
}

async function getSuppressionScope(db, email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const snap = await db.doc(`emailSuppressions/${hashEmail(e)}`).get();
  return snap.exists ? (snap.data().scope || 'all') : null;
}

/**
 * canEmail({ uid, email, category }, { db }) → boolean.
 * Fails closed: if the state can't be read, the answer is no.
 */
async function canEmail({ uid, email, category }, { db }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown email category: ${category}`);
  try {
    let profile = null;
    let address = normalizeEmail(email);
    if (uid) {
      const snap = await db.doc(`userProfiles/${uid}`).get();
      profile = snap.exists ? snap.data() : null;
      if (!address) address = await resolveEmailForUid(db, defaultAuth(), uid, profile);
    } else if (address) {
      profile = (await findProfileByEmail(db, address))?.data || null;
    }
    const suppressionScope = address ? await getSuppressionScope(db, address) : null;
    return decideCanEmail({ profile, suppressionScope, category });
  } catch (e) {
    console.error('[canEmail] could not read opt-out state, not sending:', e.message);
    return false;
  }
}

// ── Writing state ────────────────────────────────────────────────────

const PROFILE_FIELD = { all: 'emailOptOut', announcements: 'announcementsOptOut' };

async function logUnsubscribeEvent(db, { uid = null, email, scope, action, method, source, now = new Date() }) {
  await db.collection('unsubscribeEvents').add({
    uid: uid || null,
    email: normalizeEmail(email) || null,
    scope, action, method, source,
    createdAt: now,
  });
}

async function resolveEmailForUid(db, auth, uid, profile) {
  if (profile?.email) return normalizeEmail(profile.email);
  if (auth) {
    try { return normalizeEmail((await auth.getUser(uid)).email); } catch { /* deleted */ }
  }
  return null;
}

/**
 * Unsubscribe the recipient a verified token names.
 *   payload — { kind, id, scope, source } from unsubscribeToken.verify()
 *   scope   — what to apply; the token's scope, or 'all' when the person
 *             chose the broader option on the confirmation page
 *   method  — 'link' | 'one-click'
 * Idempotent: a repeat is logged but changes nothing.
 * Returns { changed, email }.
 */
async function applyUnsubscribe(db, auth, { payload, scope, method, now = new Date() }) {
  const source = payload.source;
  if (payload.kind === 'uid') {
    const uid = payload.id;
    const ref = db.doc(`userProfiles/${uid}`);
    const snap = await ref.get();
    const profile = snap.exists ? snap.data() : null;
    const email = await resolveEmailForUid(db, auth, uid, profile);
    let changed = false;
    if (profile) {
      const field = PROFILE_FIELD[scope];
      // Already fully opted out covers an announcements request too.
      const already = profile[field] === true || profile.emailOptOut === true;
      if (!already) {
        await ref.set({
          [field]: true,
          [`${field}At`]: now,
          [`${field}Method`]: method,
          [`${field}Source`]: source,
        }, { merge: true });
        changed = true;
      }
    } else if (email) {
      // The account is gone but the address still gets mail — suppress it.
      changed = await suppressEmail(db, { email, scope, source, method, now });
    }
    await logUnsubscribeEvent(db, { uid, email, scope, action: 'unsubscribe', method, source, now });
    return { changed, email };
  }

  const email = normalizeEmail(payload.id);
  const changed = await suppressEmail(db, { email, scope, source, method, now });
  await logUnsubscribeEvent(db, { uid: null, email, scope, action: 'unsubscribe', method, source, now });
  return { changed, email };
}

async function suppressEmail(db, { email, scope, source, method, now }) {
  const ref = db.doc(`emailSuppressions/${hashEmail(email)}`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  // Never narrow: 'all' already covers 'announcements'.
  if (existing && (existing.scope === 'all' || existing.scope === scope)) return false;
  await ref.set({
    email: normalizeEmail(email),
    scope,
    source,
    method,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  return true;
}

module.exports = {
  CATEGORIES, decideCanEmail, canEmail, findProfileByEmail, resolveRecipient,
  getSuppressionScope, applyUnsubscribe, suppressEmail, logUnsubscribeEvent,
  resolveEmailForUid, PROFILE_FIELD,
};
