/**
 * friends — every write that puts someone into another user's friends
 * list, plus finding a user by email. (5.59.7, S-04 and S-01.)
 *
 * WHY THIS IS A FUNCTION. Being someone's friend lets you read their
 * shows (firestore.rules, users/{uid}/shows). Until 5.59.7 the rules let
 * any signed-in user write users/{X}/friends/{me}, i.e. add themselves to
 * anyone's friends list, because accepting a request, an email invite and
 * a referral link all did that from the browser. The rules now let a
 * client write only its own list (and remove itself from someone else's);
 * the edge in the other person's list is written here, and only after
 * checking the thing that justifies it:
 *
 *   accept        { requestId }  a pending friendRequests doc to the caller
 *   claimInvites  {}             a pending invite to the caller's own
 *                                (token) email address (the client then
 *                                asks send-email for the friend-joined
 *                                email)
 *   referral      { ref }        a signed referral token (lib/referralToken.js);
 *                                a bare uid from an old link becomes a
 *                                friend request instead
 *   referralLink  {}             the caller's own signed referral link
 *   lookupByEmail { email }      the account behind an address: uid and
 *                                display name only. Replaces reading every
 *                                profile's email in the browser (S-01).
 *
 * Auth header: Authorization: Bearer {idToken}
 */

const { getDb, getAdminAuth, verifyUser } = require('./lib/firebaseAdmin');
const { normalizeEmail, isValidEmail } = require('./lib/unsubscribeToken');
const { signReferral, readReferral } = require('./lib/referralToken');
const { corsHeaders: baseCors } = require('./lib/cors');
const { takeDailyQuota } = require('./lib/rateLimit');

const APP_URL = 'https://mysetlists.net';
// A referral or invite names its inviter on the new account's profile
// only if the account is this new (the referrer is parked in storage
// until the next sign-in, and an existing user who once opened a friend's
// link was not invited by them).
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
// lookupByEmail answers at most this many times per user per day
// (rateLimits/friend_lookup_{uid}_{day}, lib/rateLimit.js).
const LOOKUPS_PER_DAY = 50;

const corsHeaders = (event) => baseCors(event, { methods: 'POST, OPTIONS' });

class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const refuse = (status, message) => { throw new Refusal(status, message); };

function profileName(p, fallback) {
  return String((p && (p.displayName || p.firstName)) || fallback).slice(0, 80);
}

async function getProfile(db, uid) {
  const snap = await db.doc(`userProfiles/${uid}`).get();
  return snap.exists ? snap.data() : {};
}

async function authEmail(auth, uid) {
  try {
    const u = await auth.getUser(uid);
    return u && u.email ? normalizeEmail(u.email) : '';
  } catch {
    return '';
  }
}

/** True if either has blocked the other (userBlocks/{uid}.blockedUserIds). */
async function blockedBetween(db, a, b) {
  const [sa, sb] = await Promise.all([db.doc(`userBlocks/${a}`).get(), db.doc(`userBlocks/${b}`).get()]);
  const list = (s) => (s.exists && Array.isArray(s.data().blockedUserIds) ? s.data().blockedUserIds : []);
  return list(sa).includes(b) || list(sb).includes(a);
}

/** The friend-list entry `owner` keeps for `friendUid`. */
async function friendEntry(db, auth, friendUid) {
  const p = await getProfile(db, friendUid);
  return {
    friendUid,
    friendName: profileName(p, 'Friend'),
    friendEmail: await authEmail(auth, friendUid),
    friendPhotoURL: String(p.photoURL || ''),
    addedAt: new Date(),
  };
}

/**
 * Writes the edge both ways (a batch, so never half a friendship).
 * Returns false if they were already friends.
 */
async function makeFriends(db, auth, a, b) {
  const refA = db.doc(`users/${a}/friends/${b}`);
  const refB = db.doc(`users/${b}/friends/${a}`);
  const [hasA, hasB] = await Promise.all([refA.get(), refB.get()]);
  if (hasA.exists && hasB.exists) return false;
  const batch = db.batch();
  if (!hasA.exists) batch.set(refA, await friendEntry(db, auth, b));
  if (!hasB.exists) batch.set(refB, await friendEntry(db, auth, a));
  await batch.commit();
  return true;
}

/** Records who invited a brand new account, never overwriting one. */
async function recordInviter(db, auth, uid, inviterUid) {
  let created = 0;
  try {
    const u = await auth.getUser(uid);
    created = Date.parse((u && u.metadata && u.metadata.creationTime) || '') || 0;
  } catch { /* unknown age: treat as not new */ }
  if (!created || Date.now() - created > NEW_ACCOUNT_MS) return false;
  const ref = db.doc(`userProfiles/${uid}`);
  const snap = await ref.get();
  if (snap.exists && snap.data().invitedByUid) return false;
  const inviter = await getProfile(db, inviterUid);
  await ref.set({
    invitedByUid: inviterUid,
    invitedByName: profileName(inviter, ''),
    inviteAcceptedAt: new Date(),
  }, { merge: true });
  return true;
}

/** A pending request from `from` to `to`, unless one exists either way. */
async function requestFriendship(db, from, to) {
  const col = db.collection('friendRequests');
  const [mine, theirs] = await Promise.all([
    col.where('from', '==', from).where('to', '==', to).where('status', '==', 'pending').limit(1).get(),
    col.where('from', '==', to).where('to', '==', from).where('status', '==', 'pending').limit(1).get(),
  ]);
  if (!mine.empty || !theirs.empty) return false;
  const [fromProfile, toProfile] = await Promise.all([getProfile(db, from), getProfile(db, to)]);
  await col.doc().set({
    from, to,
    fromName: profileName(fromProfile, 'Anonymous'),
    toName: profileName(toProfile, ''),
    status: 'pending',
    createdAt: new Date(),
  });
  return true;
}

const ACTIONS = {
  // Accept a pending friend request sent to the caller.
  async accept({ db, auth, uid, body }) {
    const id = body.requestId;
    if (typeof id !== 'string' || !id || id.includes('/')) refuse(400, 'requestId is required');
    const ref = db.collection('friendRequests').doc(id);
    const snap = await ref.get();
    if (!snap.exists) refuse(404, 'Request not found');
    const req = snap.data();
    if (req.to !== uid) refuse(403, 'Not your request');
    if (req.status !== 'pending') refuse(409, 'Request is no longer pending');
    if (!req.from || req.from === uid) refuse(400, 'Invalid request');
    if (await blockedBetween(db, uid, req.from)) refuse(403, 'Request is no longer available');
    await makeFriends(db, auth, uid, req.from);
    await ref.update({ status: 'accepted', acceptedAt: new Date() });
    return { friendUid: req.from };
  },

  // Email invites to the caller's own address: befriend the newest
  // inviter, mark the invite accepted and record the inviter on the
  // profile. The client then sends { type: 'friend_joined' } to
  // send-email, which finds the inviter from that invitedByUid.
  async claimInvites({ db, auth, uid, email }) {
    if (!email) return { claimed: false };
    const snap = await db.collection('invites')
      .where('inviteeEmail', '==', email).where('status', '==', 'pending').get();
    const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t instanceof Date ? t.getTime() : 0));
    const docs = snap.docs
      .filter((d) => d.data().inviterUid && d.data().inviterUid !== uid)
      .sort((a, b) => millis(b.data().createdAt) - millis(a.data().createdAt));
    if (docs.length === 0) return { claimed: false };
    const invite = docs[0];
    const inviterUid = invite.data().inviterUid;
    if (await blockedBetween(db, uid, inviterUid)) return { claimed: false };
    const isNew = await makeFriends(db, auth, uid, inviterUid);
    await invite.ref.update({ status: 'accepted', acceptedAt: new Date(), acceptedByUid: uid });
    // Matches the old client behaviour: the invite names the inviter on
    // the profile whatever the account's age, but never overwrites one.
    const profileRef = db.doc(`userProfiles/${uid}`);
    const own = await profileRef.get();
    if (!own.exists || !own.data().invitedByUid) {
      await profileRef.set({
        invitedByUid: inviterUid,
        invitedByName: profileName(await getProfile(db, inviterUid), ''),
        inviteAcceptedAt: new Date(),
      }, { merge: true });
    }
    return { claimed: true, newFriend: isNew, inviterUid, inviterName: profileName(await getProfile(db, inviterUid), 'your friend') };
  },

  // Someone signed up (or in) from a referral link.
  async referral({ db, auth, uid, body }) {
    const ref = readReferral(body.ref);
    if (!ref || ref.uid === uid) return { result: 'ignored' };
    const referrer = await auth.getUser(ref.uid).catch(() => null);
    if (!referrer) return { result: 'ignored' };
    if (await blockedBetween(db, uid, ref.uid)) return { result: 'ignored' };
    if (!ref.signed) {
      const already = (await db.doc(`users/${uid}/friends/${ref.uid}`).get()).exists;
      if (already) return { result: 'already-friends' };
      const sent = await requestFriendship(db, uid, ref.uid);
      return { result: sent ? 'requested' : 'already-requested', friendUid: ref.uid };
    }
    const isNew = await makeFriends(db, auth, uid, ref.uid);
    if (isNew) await recordInviter(db, auth, uid, ref.uid);
    return { result: isNew ? 'friends' : 'already-friends', friendUid: ref.uid };
  },

  async referralLink({ uid }) {
    return { url: `${APP_URL}?ref=${encodeURIComponent(signReferral(uid))}` };
  },

  // The account behind an address, for "add friend by email".
  async lookupByEmail({ db, auth, uid, body }) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) refuse(400, 'Enter a valid email address');
    if (!(await takeDailyQuota(db, `friend_lookup_${uid}`, LOOKUPS_PER_DAY, { uid })).allowed) {
      refuse(429, 'Too many lookups today. Please try again tomorrow.');
    }
    let found = null;
    try {
      found = await auth.getUserByEmail(email);
    } catch { /* no account */ }
    if (!found || !found.uid) return { found: false };
    if (found.uid === uid) return { found: false, self: true };
    if (await blockedBetween(db, uid, found.uid)) return { found: false };
    return { found: true, uid: found.uid, displayName: profileName(await getProfile(db, found.uid), '') };
  },
};

exports.handler = async function (event) {
  const headers = corsHeaders(event);
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Sign in required' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) {
    return reply(400, { error: 'Unknown action' });
  }

  try {
    const result = await ACTIONS[body.action]({
      db: getDb(),
      auth: getAdminAuth(),
      uid: decoded.uid,
      email: normalizeEmail(decoded.email || ''),
      body,
    });
    return reply(200, { success: true, ...result });
  } catch (e) {
    if (e instanceof Refusal) return reply(e.status, { error: e.message });
    console.error(`[friends] ${body.action} failed:`, e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.ACTIONS = ACTIONS;
exports.LOOKUPS_PER_DAY = LOOKUPS_PER_DAY;
