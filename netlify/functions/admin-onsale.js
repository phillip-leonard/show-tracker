/**
 * admin-onsale — Admin → On-sale alerts. Monitoring: nothing here is needed for
 * a high-confidence alert to go out, and there is no way to enter a code.
 *
 * GET → { health, rejected, held, review, global, artists, recentAlerts,
 *         lowConfidenceAttractions, lastScan }
 * POST { action, ... }
 *   approve { id }                     send a held parse; applies venue-only matches
 *   discard { id }                     never send it
 *   releaseEmail { id }                parse an email held for its DMARC result
 *   setGlobalAllowlist { senders }     the global list (Seated)
 *   setArtistAllowlist { artistName, senders }   creates the artist doc if needed
 *   runScan                            start a scan now
 * Auth header: Authorization: Bearer {idToken}   (admin only, else 403)
 */

const { getDb, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
const { artistKey, ledgerId } = require('./lib/followedBandAlerts');
const { startBackgroundJob } = require('./lib/jobTrigger');
const { applyToArtist } = require('./lib/presaleParser');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const EMAIL_LIMIT = 2000;
const LIST_LIMIT = 100;

function cleanSenders(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
  const valid = out.every((s) => /^(?:[^@\s]+@|@)?[a-z0-9.-]+\.[a-z]{2,}$/.test(s));
  return valid ? Array.from(new Set(out)).slice(0, 50) : null;
}

/** Per band: emails received, how parsing went, the last email. A long gap may be a lapsed subscription. */
function buildHealth(emails) {
  const byArtist = new Map();
  emails.filter((e) => e.artistId).forEach((e) => {
    if (!byArtist.has(e.artistId)) byArtist.set(e.artistId, { artistId: e.artistId, artistName: e.artistName, received: 0, parsed: 0, failed: 0, lastEmailAtMs: 0 });
    const row = byArtist.get(e.artistId);
    row.received++;
    if (e.status === 'parsed' || e.status === 'pending_review') row.parsed++;
    if (e.status === 'parse_failed') row.failed++;
    row.lastEmailAtMs = Math.max(row.lastEmailAtMs, e.receivedAtMs || 0);
  });
  return [...byArtist.values()].sort((a, b) => a.lastEmailAtMs - b.lastEmailAtMs);
}

async function overview(db) {
  const [emailSnap, intelSnap, artistSnap, globalSnap, alertSnap, lastScan] = await Promise.all([
    db.collection('inboundEmails').orderBy('receivedAtMs', 'desc').limit(EMAIL_LIMIT).get(),
    db.collection('presaleIntel').orderBy('parsedAtMs', 'desc').limit(EMAIL_LIMIT).get(),
    db.collection('artists').get(),
    db.collection('onsaleConfig').doc('global').get(),
    db.collection('onsaleAlerts').orderBy('notifiedAtMs', 'desc').limit(LIST_LIMIT).get(),
    db.collection('onsaleConfig').doc('lastScan').get(),
  ]);
  const summary = (d) => {
    const e = d.data();
    return { id: d.id, sender: e.sender, subject: e.subject, status: e.status, reason: e.reason || null, receivedAtMs: e.receivedAtMs, artistName: e.artistName || null };
  };
  const emails = emailSnap.docs.map((d) => d.data());
  const artists = artistSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    health: buildHealth(emails),
    rejected: emailSnap.docs.filter((d) => d.data().status === 'rejected').slice(0, LIST_LIMIT).map(summary),
    held: emailSnap.docs.filter((d) => ['held', 'unmapped', 'parse_failed'].includes(d.data().status)).slice(0, LIST_LIMIT).map(summary),
    review: intelSnap.docs
      .filter((d) => d.data().status === 'pending_review' || d.data().needsMatchReview === true || d.data().unlocatedShows === true)
      .slice(0, LIST_LIMIT)
      .map((d) => {
        const i = d.data();
        return {
          id: d.id, artistName: i.artistName, sender: i.sender, subject: i.subject, status: i.status, presaleName: i.presaleName,
          code: i.code || null, startsAt: i.startsAt || null, shows: i.shows || [], confidence: i.confidence, reviewReasons: i.reviewReasons || [],
          needsMatchReview: !!i.needsMatchReview, unlocatedShows: !!i.unlocatedShows,
        };
      }),
    global: globalSnap.exists ? globalSnap.data().senderAllowlist || [] : [],
    artists: artists
      .map((a) => ({ id: a.id, name: a.name, senderAllowlist: a.senderAllowlist || [], ticketingModel: a.ticketingModel || null, hasAttraction: !!a.ticketmasterAttractionId }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    lowConfidenceAttractions: artists.filter((a) => a.attractionConfidence === 'low').map((a) => ({ id: a.id, name: a.name, attractionId: a.ticketmasterAttractionId })),
    recentAlerts: alertSnap.docs.map((d) => {
      const a = d.data();
      return { id: d.id, artistName: a.artistName, venue: a.venue, city: a.city, eventDate: a.eventDate, notifiedAtMs: a.notifiedAtMs, reminderSentAtMs: a.reminderSentAtMs || null, channels: a.channels || [], hasCode: !!a.presaleCode };
    }),
    lastScan: lastScan.exists ? lastScan.data() : null,
  };
}

async function act(db, body) {
  const { action } = body;
  if (action === 'runScan') {
    const status = await startBackgroundJob(db, 'onsale-scan', 'onsale-scan-background');
    return { started: status < 400 };
  }
  if (action === 'setGlobalAllowlist') {
    const senders = cleanSenders(body.senders);
    if (!senders) return { error: 'Senders must be email addresses or domains' };
    await db.collection('onsaleConfig').doc('global').set({ senderAllowlist: senders }, { merge: true });
    return { senders };
  }
  if (action === 'setArtistAllowlist') {
    const senders = cleanSenders(body.senders);
    const name = String(body.artistName || '').trim();
    const key = artistKey(name);
    if (!senders || !key) return { error: 'A band name and valid senders are required' };
    const ref = db.collection('artists').doc(ledgerId(key));
    const existing = (await ref.get()).data();
    await ref.set({ name: existing?.name || name, artistKey: key, senderAllowlist: senders }, { merge: true });
    return { senders };
  }

  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) return { error: 'Bad id' };
  if (action === 'approve' || action === 'discard') {
    const ref = db.collection('presaleIntel').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { error: 'Not found' };
    const intel = snap.data();
    if (action === 'discard') {
      await ref.update({ status: 'discarded', needsMatchReview: false });
      await db.collection('inboundEmails').doc(id).set({ status: 'discarded' }, { merge: true });
    } else {
      await ref.update({ status: 'accepted', adminApproved: true, needsMatchReview: false, approvedAtMs: Date.now() });
      await applyToArtist(db, intel.artistId, intel, Date.now());
      await db.collection('inboundEmails').doc(id).set({ status: 'parsed' }, { merge: true });
    }
    return { ok: true };
  }
  if (action === 'releaseEmail') {
    const ref = db.collection('inboundEmails').doc(id);
    const email = (await ref.get()).data();
    if (!email || !email.artistId || !['held', 'parse_failed'].includes(email.status)) return { error: 'This email can\'t be released' };
    await ref.update({ status: 'queued' });
    await startBackgroundJob(db, 'parse-presale-email', 'parse-presale-email-background', { emailId: id });
    return { ok: true };
  }
  return { error: 'Unknown action' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Unauthorized' });
  if (!isAdminClaims(decoded)) return reply(403, { error: 'Forbidden' });

  try {
    const db = getDb();
    if (event.httpMethod === 'GET') return reply(200, await overview(db));
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
    const result = await act(db, body);
    return reply(result.error ? 400 : 200, result);
  } catch (e) {
    console.error('[admin-onsale] error:', e);
    return reply(500, { error: 'Could not complete that' });
  }
};

exports.buildHealth = buildHealth;
exports.cleanSenders = cleanSenders;
