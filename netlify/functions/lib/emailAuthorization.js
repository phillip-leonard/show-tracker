/**
 * emailAuthorization — may this caller send this email, to whom, and
 * what does it say? The rules behind send-email (S-06, 5.59.6).
 *
 * The browser never supplies HTML, a subject or a free-form recipient.
 * It names a type and the ids of the record that justifies the email; the
 * server loads that record with the Admin SDK, checks the caller is the
 * person it says sent it, looks the recipient's address up itself, and
 * builds the email from netlify/functions/lib/notificationTemplates.js.
 *
 * TWO REQUEST SHAPES.
 *   current  { type, …ids }                 sent by 5.59.6+ (lib/email.js)
 *   legacy   { to, subject, html, type }    sent by the iOS app ≤ 3.13.5,
 *            which keeps running until people update. It carries no ids,
 *            but every legacy email is sent right after the client writes
 *            the record that justifies it, so the server finds that record
 *            from (caller, recipient address, type) instead. The client's
 *            subject and html are never used: the email is rebuilt from the
 *            record exactly as for the current shape. A legacy request with
 *            no matching record sends nothing.
 *
 * Each email also claims a one-time marker in emailSends/{key} (server
 * only), so the same tag, acceptance or notification can't be emailed
 * twice, and invites can't be re-sent to an address within 24 hours.
 *
 * authorizeEmail(ctx, caller, body) resolves to
 *   { ok: true, type, source, recipient: { email, uid }, email: { subject, html }, dedupeKey, dedupeTtlMs }
 *   { ok: false, status, reason }   reason is a short code for the log and tests
 */

const crypto = require('crypto');
const T = require('./notificationTemplates');
const { normalizeEmail, isValidEmail } = require('./unsubscribeToken');

const APP_URL = 'https://mysetlists.net';
const RECENT_MS = 15 * 60 * 1000; // a legacy email follows its record within seconds
const INVITE_RESEND_MS = 24 * 60 * 60 * 1000;

// Per sender per UTC day, by type (the existing 30/hour overall limit in
// send-email applies on top). Admins are exempt from both.
const DAILY_LIMITS = {
  tag: 50,
  tag_email: 10,
  tag_accepted: 50,
  friend_joined: 5,
  invite: 10,
  suggestion_nudge: 30,
  engagement: 100,
  venue_verification: 5,
  admin_message: Infinity,
};

const ENGAGEMENT_TYPES = ['comment_mention', 'comment_reply', 'comment_like', 'photo_like', 'meetup_join'];

// ── Small helpers ────────────────────────────────────────────────────

const deny = (reason, status = 403) => ({ ok: false, status, reason });
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

const isRecent = (v, now) => now - millis(v) <= RECENT_MS && millis(v) <= now + 60 * 1000;

async function getDoc(db, path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function queryDocs(db, collection, filters, max = 25) {
  let q = db.collection(collection);
  for (const [field, op, value] of filters) q = q.where(field, op, value);
  const snap = await q.limit(max).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function claimed(db, key) {
  if (!key) return false;
  return (await db.doc(`emailSends/${key}`).get()).exists;
}

/** Newest first by `field`, skipping any whose dedupe marker is taken. */
async function newestUnsent(db, docs, field, keyFor) {
  const sorted = [...docs].sort((a, b) => millis(b[field]) - millis(a[field]));
  for (const d of sorted) if (!(await claimed(db, keyFor(d)))) return d;
  return null;
}

async function userEmail(auth, uid) {
  if (!uid) return null;
  try {
    const u = await auth.getUser(uid);
    return u && u.email ? normalizeEmail(u.email) : null;
  } catch {
    return null;
  }
}

async function uidForEmail(auth, email) {
  try {
    const u = await auth.getUserByEmail(email);
    return u && u.uid ? u.uid : null;
  } catch {
    return null;
  }
}

/** The sender's name as their account has it — never a name the request supplies. */
async function senderName(auth, caller, fallback) {
  try {
    const u = await auth.getUser(caller.uid);
    if (u && u.displayName) return str(u.displayName, 80);
  } catch { /* fall through */ }
  return str(caller.name, 80) || fallback;
}

function showFields(showData) {
  const s = showData || {};
  return { artist: str(s.artist) || 'a show', venue: str(s.venue), date: T.formatShowDate(str(s.date, 40)) };
}

function ok({ type, source, recipient, email, dedupeKey = null, dedupeTtlMs = null }) {
  return { ok: true, type, source: source || type, recipient, email, dedupeKey, dedupeTtlMs };
}

// ── Types ────────────────────────────────────────────────────────────
// Each takes (ctx, caller, req) where req is { ids… } for the current
// shape or { legacyTo } for the legacy one, and returns the result above.

/** A member tagged you at a show (past or upcoming). showTags/{tagId}. */
async function tag(ctx, caller, req) {
  const { db, auth, now } = ctx;
  let doc;
  if (req.legacyTo) {
    const toUid = await uidForEmail(auth, req.legacyTo);
    if (!toUid) return tagEmail(ctx, caller, req); // not a member: tag-by-email
    const docs = await queryDocs(db, 'showTags', [['fromUid', '==', caller.uid], ['toUid', '==', toUid]]);
    doc = await newestUnsent(db, docs.filter((d) => d.status === 'pending' && isRecent(d.createdAt, now)), 'createdAt', (d) => `tag_${d.id}`);
    if (!doc) return tagEmail(ctx, caller, req);
  } else {
    if (!isId(req.tagId)) return deny('bad_request', 400);
    doc = await getDoc(db, `showTags/${req.tagId}`);
  }
  if (!doc) return deny('no_record');
  if (doc.fromUid !== caller.uid || doc.status !== 'pending' || !doc.toUid) return deny('not_sender');
  const to = await userEmail(auth, doc.toUid);
  if (!to) return deny('no_recipient');
  const taggerName = await senderName(auth, caller, 'A friend');
  return ok({
    type: 'tag',
    recipient: { email: to, uid: doc.toUid },
    email: T.showTagNotification({ taggerName, ...showFields(doc.showData), upcoming: !!(doc.upcomingShowId || doc.showData?.upcoming) }),
    dedupeKey: `tag_${doc.id}`,
  });
}

/** You tagged someone without an account. pendingEmailTags/{pendingTagId}. */
async function tagEmail(ctx, caller, req) {
  const { db, auth, now } = ctx;
  let doc;
  if (req.legacyTo) {
    const docs = await queryDocs(db, 'pendingEmailTags', [['fromUid', '==', caller.uid], ['toEmail', '==', req.legacyTo]]);
    doc = await newestUnsent(db, docs.filter((d) => d.status === 'pending' && isRecent(d.createdAt, now)), 'createdAt', (d) => `tag_email_${d.id}`);
  } else {
    if (!isId(req.pendingTagId)) return deny('bad_request', 400);
    doc = await getDoc(db, `pendingEmailTags/${req.pendingTagId}`);
  }
  if (!doc) return deny('no_record');
  if (doc.fromUid !== caller.uid || doc.status !== 'pending') return deny('not_sender');
  const to = normalizeEmail(doc.toEmail);
  if (!to || !isValidEmail(to)) return deny('no_recipient');
  const taggerName = await senderName(auth, caller, 'A friend');
  return ok({
    type: 'tag_email',
    source: 'tag',
    recipient: { email: to, uid: null },
    email: T.tagByEmailNotification({
      taggerName,
      ...showFields(doc.showData),
      personalMessage: str(doc.personalMessage, 500),
      signupUrl: `${APP_URL}?ref=${encodeURIComponent(caller.uid)}`,
    }),
    dedupeKey: `tag_email_${doc.id}`,
  });
}

/** You (new member) confirmed a show someone tagged you in by email; tell them. */
async function tagAccepted(ctx, caller, req) {
  const { db, auth } = ctx;
  const myEmail = normalizeEmail(caller.email);
  if (!myEmail) return deny('no_caller_email');
  let doc;
  if (req.legacyTo) {
    const docs = await queryDocs(db, 'pendingEmailTags', [['toEmail', '==', myEmail], ['status', '==', 'accepted']]);
    const candidates = [];
    for (const d of docs) {
      const tagger = (await userEmail(auth, d.fromUid)) || normalizeEmail(d.fromEmail);
      if (tagger === req.legacyTo) candidates.push(d);
    }
    doc = await newestUnsent(db, candidates, 'createdAt', (d) => `tag_accepted_${d.id}`);
  } else {
    if (!isId(req.pendingTagId)) return deny('bad_request', 400);
    doc = await getDoc(db, `pendingEmailTags/${req.pendingTagId}`);
  }
  if (!doc) return deny('no_record');
  if (normalizeEmail(doc.toEmail) !== myEmail || doc.status !== 'accepted') return deny('not_recipient');
  const to = await userEmail(auth, doc.fromUid);
  if (!to) return deny('no_recipient');
  const confirmerName = await senderName(auth, caller, 'Your friend');
  return ok({
    type: 'tag_accepted',
    recipient: { email: to, uid: doc.fromUid },
    email: T.tagAcceptedEmail({ confirmerName, ...showFields(doc.showData) }),
    dedupeKey: `tag_accepted_${doc.id}`,
  });
}

/** You joined through someone's invite; tell them. userProfiles/{you}.invitedByUid. */
async function friendJoined(ctx, caller, req) {
  const { db, auth } = ctx;
  const profile = await getDoc(db, `userProfiles/${caller.uid}`);
  const inviterUid = profile && profile.invitedByUid;
  if (!inviterUid || inviterUid === caller.uid) return deny('no_record');
  const to = await userEmail(auth, inviterUid);
  if (!to) return deny('no_recipient');
  if (req.legacyTo && req.legacyTo !== to) return deny('not_inviter');
  const newUserName = await senderName(auth, caller, 'Your friend');
  return ok({
    type: 'friend_joined',
    recipient: { email: to, uid: inviterUid },
    email: T.friendJoinedEmail({ newUserName }),
    dedupeKey: `friend_joined_${caller.uid}`,
  });
}

/** You invited someone. invites/{inviteId}. One email per address per 24h. */
async function invite(ctx, caller, req) {
  const { db, auth } = ctx;
  let doc;
  if (req.legacyTo) {
    const docs = await queryDocs(db, 'invites', [['inviterUid', '==', caller.uid], ['inviteeEmail', '==', req.legacyTo]]);
    doc = docs[0] || null;
  } else {
    if (!isId(req.inviteId)) return deny('bad_request', 400);
    doc = await getDoc(db, `invites/${req.inviteId}`);
  }
  if (!doc) return deny('no_record');
  if (doc.inviterUid !== caller.uid) return deny('not_sender');
  const to = normalizeEmail(doc.inviteeEmail);
  if (!to || !isValidEmail(to)) return deny('no_recipient');
  const inviterName = await senderName(auth, caller, 'A friend');
  return ok({
    type: 'invite',
    recipient: { email: to, uid: null },
    email: T.inviteEmail({ inviterName, inviteUrl: `${APP_URL}?ref=${encodeURIComponent(caller.uid)}` }),
    dedupeKey: `invite_${caller.uid}_${hash(to)}`,
    dedupeTtlMs: INVITE_RESEND_MS,
  });
}

/** You confirmed a suggested shared show; nudge the friend who hasn't answered. */
async function suggestionNudge(ctx, caller, req) {
  const { db, auth } = ctx;
  const valid = (d) => {
    const parts = Array.isArray(d.participants) ? d.participants : [];
    const other = parts.find((u) => u !== caller.uid);
    return parts.includes(caller.uid) && other
      && d.responses && d.responses[caller.uid] === 'confirmed' && d.responses[other] === 'pending'
      && !d.emailSentToUid;
  };
  let doc;
  if (req.legacyTo) {
    const toUid = await uidForEmail(auth, req.legacyTo);
    if (!toUid) return deny('no_recipient');
    const docs = await queryDocs(db, 'showSuggestions', [['participants', 'array-contains', caller.uid]], 200);
    const other = (d) => (d.participants || []).find((u) => u !== caller.uid);
    doc = await newestUnsent(db, docs.filter((d) => other(d) === toUid && valid(d)), 'updatedAt', (d) => `suggestion_${d.id}`);
  } else {
    if (!isId(req.suggestionId)) return deny('bad_request', 400);
    doc = await getDoc(db, `showSuggestions/${req.suggestionId}`);
  }
  if (!doc) return deny('no_record');
  if (!valid(doc)) return deny('not_participant');
  const friendUid = doc.participants.find((u) => u !== caller.uid);
  const to = await userEmail(auth, friendUid);
  if (!to) return deny('no_recipient');
  const fromName = await senderName(auth, caller, 'A friend');
  const s = doc.showData || {};
  return ok({
    type: 'suggestion_nudge',
    recipient: { email: to, uid: friendUid },
    // The date as stored, as the browser template had it.
    email: T.suggestionNudgeEmail({ fromName, artist: str(s.artist) || 'a show', venue: str(s.venue), date: str(s.date, 40) }),
    dedupeKey: `suggestion_${doc.id}`,
  });
}

/** A reply, like, mention or meetup join; only for recipients who chose immediate email. */
async function engagement(ctx, caller, req) {
  const { db, auth, now } = ctx;
  let doc;
  if (req.legacyTo) {
    if (!ENGAGEMENT_TYPES.includes(req.legacyType)) return deny('bad_type', 400);
    const toUid = await uidForEmail(auth, req.legacyTo);
    if (!toUid) return deny('no_recipient');
    const docs = await queryDocs(db, 'notifications', [['uid', '==', toUid], ['fromUid', '==', caller.uid], ['type', '==', req.legacyType]]);
    doc = await newestUnsent(db, docs.filter((d) => isRecent(d.createdAt, now)), 'createdAt', (d) => `engagement_${d.id}`);
  } else {
    if (!isId(req.notificationId)) return deny('bad_request', 400);
    doc = await getDoc(db, `notifications/${req.notificationId}`);
  }
  if (!doc) return deny('no_record');
  if (doc.fromUid !== caller.uid || !doc.uid || doc.uid === caller.uid || !ENGAGEMENT_TYPES.includes(doc.type)) return deny('not_sender');
  // Immediate email is opt-in on the recipient's Profile; the check that
  // used to run in the sender's browser runs here now.
  const profile = await getDoc(db, `userProfiles/${doc.uid}`);
  const prefs = (profile && profile.notificationPrefs) || {};
  if (prefs.emailFrequency !== 'immediate' || prefs.engagementNotifications === false) return deny('recipient_not_opted_in', 200);
  const to = await userEmail(auth, doc.uid);
  if (!to) return deny('no_recipient');
  const fromName = await senderName(auth, caller, 'Someone');
  return ok({
    type: 'engagement',
    source: doc.type,
    recipient: { email: to, uid: doc.uid },
    email: T.engagementNotificationEmail({
      fromName,
      message: str(doc.message, 500),
      artist: str(doc.artist),
      venue: str(doc.venue),
      date: T.formatShowDate(str(doc.date, 40)),
    }),
    dedupeKey: `engagement_${doc.id}`,
  });
}

/** Venue verification: "received" to the applicant; approved/rejected from an admin. */
async function venueVerification(ctx, caller, req) {
  const { db } = ctx;
  let doc;
  if (req.legacyTo) {
    const filters = caller.isAdmin
      ? [['applicantEmail', '==', req.legacyTo]]
      : [['applicantUid', '==', caller.uid], ['applicantEmail', '==', req.legacyTo]];
    const docs = await queryDocs(db, 'venueVerificationApplications', filters);
    const eligible = docs.filter((d) => (caller.isAdmin ? ['approved', 'rejected'].includes(d.status) : d.status === 'pending'));
    doc = await newestUnsent(db, eligible, caller.isAdmin ? 'reviewedDate' : 'submittedDate', (d) => `venue_${d.id}_${d.status}`);
  } else {
    if (!isId(req.applicationId)) return deny('bad_request', 400);
    doc = await getDoc(db, `venueVerificationApplications/${req.applicationId}`);
  }
  if (!doc) return deny('no_record');
  const to = normalizeEmail(doc.applicantEmail);
  if (!to || !isValidEmail(to)) return deny('no_recipient');
  const venueName = str(doc.venueName) || 'your venue';
  let email;
  if (doc.status === 'pending') {
    if (doc.applicantUid !== caller.uid) return deny('not_applicant');
    email = T.venueVerificationSubmittedEmail({ venueName });
  } else if (doc.status === 'approved' || doc.status === 'rejected') {
    if (!caller.isAdmin) return deny('admin_only');
    email = doc.status === 'approved'
      ? T.venueVerificationApprovedEmail({ venueName, venueKey: str(doc.venueKey, 300) })
      : T.venueVerificationRejectedEmail({ venueName, rejectionReason: str(doc.rejectionReason, 500) });
  } else {
    return deny('bad_status');
  }
  return ok({
    type: 'venue_verification',
    recipient: { email: to, uid: doc.applicantUid || null },
    email,
    dedupeKey: `venue_${doc.id}_${doc.status}`,
  });
}

/** Admin → a user, plain text. */
async function adminMessage(ctx, caller, req) {
  const { auth } = ctx;
  if (!caller.isAdmin) return deny('admin_only');
  let to;
  let uid = null;
  let subject;
  let body;
  if (req.legacyTo) {
    to = req.legacyTo;
    uid = await uidForEmail(auth, to);
    subject = str(req.legacySubject, 200);
    // The old admin form sent its text with newlines turned into <br />.
    body = String(req.legacyHtml || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').slice(0, 20000);
  } else {
    if (!isId(req.toUid)) return deny('bad_request', 400);
    uid = req.toUid;
    to = await userEmail(auth, uid);
    subject = str(req.subject, 200);
    body = typeof req.body === 'string' ? req.body.slice(0, 20000) : '';
  }
  if (!to) return deny('no_recipient');
  if (!subject || !body.trim()) return deny('bad_request', 400);
  return ok({ type: 'admin_message', recipient: { email: to, uid }, email: T.adminMessageEmail({ subject, body }) });
}

const HANDLERS = {
  tag,
  tag_email: tagEmail,
  tag_accepted: tagAccepted,
  friend_joined: friendJoined,
  invite,
  suggestion_nudge: suggestionNudge,
  engagement,
  venue_verification: venueVerification,
  admin_message: adminMessage,
};

// The `type` strings the legacy client sends → the handler that rebuilds them.
const LEGACY_TYPES = {
  tag: 'tag', // to a member, or to a pending email tag
  tag_accepted: 'tag_accepted',
  friend_joined: 'friend_joined',
  invite: 'invite',
  suggestion_nudge: 'suggestion_nudge',
  venue_verification: 'venue_verification',
  admin_message: 'admin_message',
  ...Object.fromEntries(ENGAGEMENT_TYPES.map((t) => [t, 'engagement'])),
};

/** True for the ≤3.13.5 shape: an address, and no ids. */
function isLegacyRequest(body) {
  return !!body && typeof body.to === 'string' && ('html' in body || 'subject' in body);
}

/**
 * authorizeEmail({ db, auth, now }, caller, body)
 *   caller — { uid, email, name, isAdmin } from lib/requestAuth.js
 */
async function authorizeEmail(ctx, caller, body) {
  const c = { now: Date.now(), ...ctx };
  if (!body || typeof body !== 'object') return deny('bad_request', 400);
  if (isLegacyRequest(body)) {
    const to = normalizeEmail(body.to);
    if (!to || !isValidEmail(to)) return deny('bad_recipient', 400);
    const legacyType = String(body.type || '');
    const handlerName = LEGACY_TYPES[legacyType];
    if (!handlerName) return { ...deny('legacy_unknown_type', 200), legacy: true };
    const result = await HANDLERS[handlerName](c, caller, {
      legacyTo: to, legacyType, legacySubject: body.subject, legacyHtml: body.html,
    });
    return { ...result, legacy: true };
  }
  const handler = HANDLERS[body.type];
  if (!handler || !Object.prototype.hasOwnProperty.call(HANDLERS, body.type)) return deny('unknown_type', 400);
  return handler(c, caller, body);
}

module.exports = { authorizeEmail, isLegacyRequest, DAILY_LIMITS, ENGAGEMENT_TYPES, RECENT_MS, INVITE_RESEND_MS, millis };
