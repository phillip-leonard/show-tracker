/**
 * admin-send-announcement — the Admin → Announcements tab's server half.
 *
 * POST body: { mode, subject?, html?, extraEmails?, announcementId?, retryFailed? }
 *   mode 'preview'  counts only — who would get it, who's excluded and why.
 *                   Sends nothing, writes nothing.
 *   mode 'test'     sends it to the signed-in admin only, with a real
 *                   signed unsubscribe link and List-Unsubscribe headers.
 *   mode 'send'     without announcementId: creates announcements/{id} and
 *                   one announcements/{id}/recipients/{emailHash} per
 *                   recipient (status pending), then starts sending.
 *                   With announcementId: carries on where the last call
 *                   stopped. retryFailed: true puts failed ones back to
 *                   pending first.
 *   mode 'history'  past announcements with their counts and how many
 *                   people unsubscribed through their links.
 * Auth header: Authorization: Bearer {idToken}   (admin only, else 403)
 *
 * RESUMABLE, AND NEVER TWICE. Netlify kills a function at 10 seconds, so
 * each call works for TIME_BUDGET_MS and returns { remaining }; the tab
 * calls again until it's 0 (the same time-budget-and-resume shape as the
 * 5.33 setlist backfill). What makes a re-run safe:
 *   - a recipient marked `sent` is never selected again
 *   - a batch is claimed (status `sending`, a batchKey) BEFORE it goes to
 *     Resend, and that batchKey is Resend's Idempotency-Key. If a call dies
 *     between Resend accepting and us writing `sent`, the next call finds
 *     the claimed batch and re-posts it with the same key; Resend
 *     recognises the key and doesn't deliver it again.
 *   - a lease on the announcement doc stops two tabs sending the same
 *     announcement at once.
 * Opt-outs are re-read on every call, so someone who unsubscribes
 * mid-send is marked `skipped` rather than mailed.
 *
 * Refuses to send (test or real) without UNSUBSCRIBE_SECRET, or without
 * MAILING_ADDRESS — CAN-SPAM requires a physical address on every
 * commercial email.
 *
 * AUDIENCE 'recap-2026' (Year in Review, lib/yearRecapEmail.js): body
 * { audience: 'recap-2026', template: 'ready' | 'final' } in place of
 * subject/html. Only accounts with a 2026 show, no extra emails, the
 * subject and HTML built here from the template, and a real send refused
 * unless YEAR_RECAP_EMAILS_ENABLED=true. Preview and test always work.
 * Each template sends once: it lives at a fixed announcements/{id}
 * (recapAnnouncementId), created with create(), so a second Send is a 409
 * rather than a second email to everyone. Preview reports `alreadySent`.
 */

const { withCors } = require('./lib/cors');
const crypto = require('crypto');
const { getDb, getAdminAuth, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
const { withAccountEmails } = require('./lib/accountEmails');
const { buildAnnouncementRecipients } = require('./lib/announcementRecipients');
const { decideCanEmail } = require('./lib/emailPolicy');
const { buildEmail, resendRequest, sendOne } = require('./lib/outgoingEmail');
const { wrapAnnouncement } = require('./lib/emailLayout');
const recapEmails = require('./lib/yearRecapEmail');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIME_BUDGET_MS = 7000;   // of Netlify's 10s
const BATCH_SIZE = 100;         // Resend /emails/batch maximum
const MIN_GAP_MS = 550;         // Resend's default limit is 2 requests/second
const MAX_TRIES = 4;
const MAX_HTML = 500_000;
const MAX_EXTRAS = 5000;

const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function missingConfig() {
  return ['RESEND_API_KEY', 'UNSUBSCRIBE_SECRET', 'MAILING_ADDRESS'].filter((k) => !String(process.env[k] || '').trim());
}

// Addresses come from Firebase Auth: profiles stopped carrying `email` in
// 5.59.7 (S-01). A profile that still has the old field keeps it.
async function loadOptOutState(db, auth = getAdminAuth()) {
  const [profilesSnap, supSnap] = await Promise.all([
    db.collection('userProfiles').select('email', 'emailOptOut', 'announcementsOptOut').get(),
    db.collection('emailSuppressions').get(),
  ]);
  const profiles = await withAccountEmails(auth, profilesSnap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  const suppressions = new Map(supSnap.docs.map((d) => [d.id, d.data().scope || 'all']));
  return { profiles, suppressions };
}

function validateContent({ subject, html }) {
  if (typeof subject !== 'string' || !subject.trim()) return 'Subject is required';
  if (subject.length > 200) return 'Subject is too long (200 characters max)';
  if (typeof html !== 'string' || !html.trim()) return 'HTML body is required';
  if (html.length > MAX_HTML) return 'HTML body is too large';
  return null;
}

// The Year in Review audience: who it may reach, and its fixed content.
// null for an ordinary announcement; { error } for a bad request.
function recapAudienceFor(body) {
  if (!body.audience) return null;
  if (body.audience !== recapEmails.RECAP_AUDIENCE) return { error: 'Unknown audience' };
  const content = recapEmails.recapEmail(body.template, recapEmails.RECAP_YEAR);
  if (!content) return { error: "template must be 'ready' or 'final'" };
  return { audience: body.audience, template: body.template, ...content };
}

// Opt-out state narrowed to the recap audience: accounts with a show in
// the recap year. Extra emails never apply.
async function loadRecapState(db) {
  const [state, uids] = await Promise.all([loadOptOutState(db), recapEmails.loadUidsWithShowsIn(db, recapEmails.RECAP_YEAR)]);
  return { ...state, profiles: state.profiles.filter((p) => uids.has(p.uid)) };
}

// What an earlier send of this recap email looks like, or null.
async function recapAlreadySent(db, template) {
  const id = recapEmails.recapAnnouncementId(template);
  const snap = await db.doc(`announcements/${id}`).get();
  if (!snap.exists) return null;
  const a = snap.data() || {};
  const createdAt = a.createdAt?.toDate?.()?.toISOString?.() || (a.createdAt instanceof Date ? a.createdAt.toISOString() : null);
  return { announcementId: id, status: a.status || null, counts: a.counts || null, createdAt };
}

const isAlreadyExists = (err) => err && (err.code === 6 || err.code === 'already-exists' || /ALREADY_EXISTS/.test(String(err.message || '')));

function replyTo(decoded) {
  return process.env.ANNOUNCEMENT_REPLY_TO || decoded.email;
}

function payloadFor(ann, recipient, decoded) {
  return buildEmail({
    recipient,
    subject: ann.subject,
    html: wrapAnnouncement(ann.html),
    scope: 'announcements',
    source: `announcement:${ann.id}`,
    replyTo: replyTo(decoded),
    mailingAddress: process.env.MAILING_ADDRESS.trim(),
  });
}

async function commitInChunks(db, writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data, opts] of writes.slice(i, i + 400)) batch.set(ref, data, opts || {});
    await batch.commit();
  }
}

async function tally(db, annRef) {
  const snap = await annRef.collection('recipients').get();
  const counts = { total: snap.size, sent: 0, failed: 0, skipped: 0, pending: 0 };
  for (const d of snap.docs) {
    const s = d.data().status;
    if (s === 'sent') counts.sent++;
    else if (s === 'failed') counts.failed++;
    else if (s === 'skipped') counts.skipped++;
    else counts.pending++; // pending or sending
  }
  return counts;
}

/** Post one claimed batch to Resend, retrying 429s and 5xx with the same key. */
async function postBatch(payloads, batchKey, deadline) {
  let last = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    last = await resendRequest('/emails/batch', payloads, { idempotencyKey: batchKey });
    if (last.status >= 200 && last.status < 300) return { ok: true, res: last };
    const retryable = last.status === 429 || last.status >= 500 || last.status === 0;
    if (!retryable) return { ok: false, res: last, final: true };
    const wait = last.retryAfter ? last.retryAfter * 1000 : 1000 * 2 ** attempt;
    if (Date.now() + wait > deadline) return { ok: false, res: last, final: false };
    await sleep(wait);
  }
  // Out of tries on a 429 stays claimed for the next call (same key, safe);
  // persistent 5xx is recorded as a failure.
  return { ok: false, res: last, final: last.status !== 429 };
}

async function runSend(db, annRef, ann, decoded, startedAt) {
  const deadline = startedAt + TIME_BUDGET_MS;
  const { profiles, suppressions } = await loadOptOutState(db);
  const profileByUid = new Map(profiles.map((p) => [p.uid, p]));
  const recipientsCol = annRef.collection('recipients');
  let lastCall = 0;

  while (Date.now() < deadline) {
    // A claimed-but-unconfirmed batch from a call that died goes first,
    // re-posted under its original key.
    let docs = (await recipientsCol.where('status', '==', 'sending').limit(BATCH_SIZE).get()).docs;
    let batchKey;
    if (docs.length) {
      batchKey = docs[0].data().batchKey;
      docs = docs.filter((d) => d.data().batchKey === batchKey);
    } else {
      docs = (await recipientsCol.where('status', '==', 'pending').limit(BATCH_SIZE).get()).docs;
      if (!docs.length) break;
      batchKey = `${ann.id}-${crypto.randomBytes(8).toString('hex')}`;
    }

    const now = new Date();
    const toSend = [];
    const writes = [];
    for (const d of docs) {
      const r = d.data();
      const ok = decideCanEmail({
        profile: r.uid ? profileByUid.get(r.uid) || null : null,
        suppressionScope: suppressions.get(d.id) || null,
        category: 'announcement',
      });
      if (!ok) {
        writes.push([d.ref, { status: 'skipped', error: 'Opted out before sending', updatedAt: now }, { merge: true }]);
      } else {
        toSend.push(d);
        writes.push([d.ref, { status: 'sending', batchKey, updatedAt: now }, { merge: true }]);
      }
    }
    await commitInChunks(db, writes);
    if (!toSend.length) continue;

    const gap = lastCall + MIN_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastCall = Date.now();

    const payloads = toSend.map((d) => payloadFor(ann, { email: d.data().email, uid: d.data().uid || null }, decoded));
    const result = await postBatch(payloads, batchKey, deadline);
    const done = new Date();
    if (result.ok) {
      let ids = [];
      try { ids = JSON.parse(result.res.body).data || []; } catch { /* ids are informational */ }
      await commitInChunks(db, toSend.map((d, i) => [d.ref,
        { status: 'sent', error: null, sentAt: done, resendId: ids[i]?.id || null, updatedAt: done }, { merge: true }]));
    } else if (result.final) {
      const error = `Resend ${result.res.status}: ${String(result.res.body || '').slice(0, 300)}`;
      await commitInChunks(db, toSend.map((d) => [d.ref, { status: 'failed', error, updatedAt: done }, { merge: true }]));
    } else {
      break; // rate-limited past our budget; stays claimed, resumes next call
    }
  }

  const counts = await tally(db, annRef);
  const status = counts.pending > 0 ? 'sending' : (counts.failed > 0 ? 'completed_with_errors' : 'completed');
  await annRef.set({ counts, status, updatedAt: new Date(), leaseUntil: null }, { merge: true });
  return { counts, remaining: counts.pending, status };
}

async function takeLease(db, annRef, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(annRef);
    if (!snap.exists) return { error: 'not_found' };
    const d = snap.data();
    const lease = d.leaseUntil?.toMillis?.() ?? (d.leaseUntil instanceof Date ? d.leaseUntil.getTime() : 0);
    if (lease > now) return { error: 'busy' };
    tx.set(annRef, { leaseUntil: new Date(now + TIME_BUDGET_MS + 15000) }, { merge: true });
    return { data: d };
  });
}

async function history(db) {
  const [annSnap, evSnap] = await Promise.all([
    db.collection('announcements').orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('unsubscribeEvents').where('action', '==', 'unsubscribe').get(),
  ]);
  const unsubs = new Map(); // source → Set(email)
  for (const d of evSnap.docs) {
    const e = d.data();
    if (!String(e.source || '').startsWith('announcement:')) continue;
    if (!unsubs.has(e.source)) unsubs.set(e.source, new Set());
    unsubs.get(e.source).add(e.email || d.id);
  }
  return annSnap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      subject: a.subject,
      status: a.status,
      counts: a.counts || null,
      createdBy: a.createdBy || null,
      createdAt: a.createdAt?.toDate?.()?.toISOString?.() || (a.createdAt instanceof Date ? a.createdAt.toISOString() : null),
      unsubscribes: unsubs.get(`announcement:${d.id}`)?.size || 0,
    };
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Unauthorized' });
  if (!isAdminClaims(decoded)) return reply(403, { error: 'Forbidden' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const { mode } = body;
  const startedAt = Date.now();
  const db = getDb();
  let leasedRef = null;

  try {
    if (mode === 'history') return reply(200, { announcements: await history(db) });

    const recap = recapAudienceFor(body);
    if (recap && recap.error) return reply(400, { error: recap.error });

    if (mode === 'preview') {
      const extraEmails = !recap && Array.isArray(body.extraEmails) ? body.extraEmails.slice(0, MAX_EXTRAS) : [];
      const state = recap ? await loadRecapState(db) : await loadOptOutState(db);
      const { counts, invalidSamples } = buildAnnouncementRecipients({ ...state, extraEmails });
      return reply(200, {
        counts,
        invalidSamples,
        missingConfig: missingConfig(),
        ...(recap ? { recapEnabled: recapEmails.recapEmailsEnabled(), alreadySent: await recapAlreadySent(db, recap.template) } : {}),
      });
    }

    if (mode !== 'test' && mode !== 'send') return reply(400, { error: "mode must be 'preview', 'test', 'send' or 'history'" });

    const missing = missingConfig();
    if (missing.length) return reply(412, { error: `Not configured: ${missing.join(', ')}. Set them in Netlify environment variables.`, missingConfig: missing });

    // A recap's content is always the template, whatever the browser sent.
    if (recap) {
      body.subject = recap.subject;
      body.html = recap.html;
      body.extraEmails = [];
    }

    if (mode === 'test') {
      const invalid = validateContent(body);
      if (invalid) return reply(400, { error: invalid });
      if (!decoded.email) return reply(400, { error: 'Your account has no email address' });
      const ann = { id: 'test', subject: `[Test] ${body.subject.trim()}`, html: body.html };
      const result = await sendOne(payloadFor(ann, { email: decoded.email, uid: decoded.uid }, decoded));
      if (!result.ok) return reply(502, { error: `Resend ${result.status}: ${result.error}` });
      return reply(200, { success: true, sentTo: decoded.email });
    }

    // mode === 'send'
    let annRef;
    if (body.announcementId) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(String(body.announcementId))) return reply(400, { error: 'Invalid announcementId' });
      annRef = db.doc(`announcements/${body.announcementId}`);
    } else {
      if (recap && !recapEmails.recapEmailsEnabled()) {
        return reply(412, { error: 'Year in Review emails are switched off. Set YEAR_RECAP_EMAILS_ENABLED=true in Netlify to send them.', recapEnabled: false });
      }
      const alreadySentReply = (sent) => reply(409, {
        error: 'This Year in Review email has already been sent. Use Resume in the history list if it stopped part-way.',
        alreadySent: sent,
        announcementId: sent.announcementId,
      });
      if (recap) {
        const sent = await recapAlreadySent(db, recap.template);
        if (sent) return alreadySentReply(sent);
      }
      const invalid = validateContent(body);
      if (invalid) return reply(400, { error: invalid });
      const extraEmails = Array.isArray(body.extraEmails) ? body.extraEmails.slice(0, MAX_EXTRAS) : [];
      const state = recap ? await loadRecapState(db) : await loadOptOutState(db);
      const { recipients, counts } = buildAnnouncementRecipients({ ...state, extraEmails });
      if (!recipients.length) return reply(400, { error: 'Nobody to send to', counts });
      annRef = recap
        ? db.doc(`announcements/${recapEmails.recapAnnouncementId(recap.template)}`)
        : db.collection('announcements').doc();
      const now = new Date();
      // create(), not set(), for a recap: of two Sends racing past the check
      // above, only one gets the document.
      const write = recap ? (data) => annRef.create(data) : (data) => annRef.set(data);
      try {
        await write({
          subject: body.subject.trim(),
          html: body.html,
          createdBy: decoded.email,
          createdByUid: decoded.uid,
          createdAt: now,
          updatedAt: now,
          status: 'preparing',
          ...(recap ? { audience: recap.audience, template: recap.template } : {}),
          recipientCounts: counts,
          counts: { total: recipients.length, sent: 0, failed: 0, skipped: 0, pending: recipients.length },
          leaseUntil: null,
        });
      } catch (err) {
        if (recap && isAlreadyExists(err)) return alreadySentReply(await recapAlreadySent(db, recap.template));
        throw err;
      }
      await commitInChunks(db, recipients.map((r) => [annRef.collection('recipients').doc(r.hash), {
        email: r.email, uid: r.uid, status: 'pending', error: null, batchKey: null, createdAt: now, updatedAt: now,
      }]));
      await annRef.set({ status: 'sending' }, { merge: true });
    }

    const lease = await takeLease(db, annRef, Date.now());
    if (lease.error === 'not_found') return reply(404, { error: 'Announcement not found' });
    if (lease.error === 'busy') {
      const counts = await tally(db, annRef);
      return reply(409, { error: 'This announcement is already sending in another window', busy: true, announcementId: annRef.id, counts, remaining: counts.pending });
    }
    leasedRef = annRef;
    const ann = { id: annRef.id, subject: lease.data.subject, html: lease.data.html };

    if (body.retryFailed) {
      const failed = await annRef.collection('recipients').where('status', '==', 'failed').get();
      await commitInChunks(db, failed.docs.map((d) => [d.ref, { status: 'pending', error: null, batchKey: null, updatedAt: new Date() }, { merge: true }]));
    }

    const result = await runSend(db, annRef, ann, decoded, startedAt);
    return reply(200, { announcementId: annRef.id, ...result });
  } catch (e) {
    console.error('[admin-send-announcement] error:', e);
    // Hand the lease back so Resume works straight away. Anything claimed
    // stays claimed and is re-posted under its original key.
    if (leasedRef) await leasedRef.set({ leaseUntil: null }, { merge: true }).catch(() => {});
    return reply(500, { error: e.message || 'Server error' });
  }
};

exports.__setSleep = (fn) => { sleep = fn; };
exports.TIME_BUDGET_MS = TIME_BUDGET_MS;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
