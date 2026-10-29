/**
 * followedBandAlerts — the daily "a band you follow announced something"
 * job, minus the network. netlify/functions/followed-band-notifications-
 * background.js supplies Firestore, Ticketmaster, Resend and push; the unit
 * tests (tests/notifications/followedBands.test.js) supply fakes and run
 * the same code twice to prove nobody is told twice.
 *
 * WHO FOLLOWS WHOM. A follow is an entry in userProfiles/{uid}.favoriteArtists
 * ({ name, mbid, addedAt }) — the list the app's Follow buttons toggle
 * (context/AppContext.jsx). Bucket-list venues are bucketListVenues docs
 * (lib/bucketListVenues.js).
 *
 * WHAT COUNTS AS NEWS. Ticketmaster has no "tour" field, so a new tour is
 * a batch of new dates: for every followed band we keep the Ticketmaster
 * event ids already seen, in bandAnnouncementLedger/{ledgerId}. A run that
 * finds TOUR_MIN_NEW_DATES or more ids never seen before is a tour
 * announcement. The first run for a band only records what is on sale
 * (a baseline) and tells nobody: everything is "new" the first time.
 *
 * Separately, any upcoming date at a venue on a follower's bucket list is
 * a venue match, whether or not it is new — the venue may have gone on the
 * list after the date was announced.
 *
 * WHY NOBODY IS TOLD TWICE. Every alert has a fixed notification id:
 *   bandTour_{uid}_{ledgerId}_{batchKey}   batchKey = hash of the new ids
 *   venueMatch_{uid}_{eventId}             same id the pre-5.46 job used
 * and is written with create(), which fails if that id exists. Email and
 * push go out only after a create succeeds. The ledger is written after
 * the alerts, so a run that dies in between finds the same new ids next
 * time, computes the same ids, and every create() fails quietly.
 *
 * PUSH (5.49.0). One alert is one push to each of the user's devices,
 * dead tokens deleted on the spot, push and email switched separately:
 * lib/pushDelivery.js, shared with the anniversary job.
 */

const crypto = require('crypto');
const { escapeHtml, wrapEmail } = require('./emailLayout');
const { unfollowUrl } = require('./unfollowToken');
const { PUSH_TOKENS, prefFor, loadPushTokens, isDeadToken, pushToDevices } = require('./pushDelivery');
const { artistNameKeyLoose } = require('./songfishSites');
const publicArtists = require('../../../config/public-artists.json');

const SITE_URL = 'https://mysetlists.net';
const LEDGER_COLLECTION = 'bandAnnouncementLedger';
const TOUR_MIN_NEW_DATES = 3;
// Ticketmaster ids are ~20 chars; this keeps a ledger doc far below 1 MiB
// while remembering more dates than any band has on sale at once.
const MAX_SEEN_IDS = 1000;
const MAX_DATES_IN_EMAIL = 10;
const GREEN = '#10b981';

function artistKey(name) {
  return String(name || '').trim().toLowerCase();
}

// Artist keys can contain "/" (AC/DC), which a doc id cannot.
function ledgerId(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

// Same shape as lib/venues.js's venueKeyFor, which this CommonJS file
// can't import.
function venueKeyFor(name, city) {
  const key = `${String(name || '').trim().toLowerCase()}::${String(city || '').trim().toLowerCase()}`;
  return key === '::' ? null : key;
}

function newEventsSince(ledger, events) {
  if (!ledger) return { baseline: true, newEvents: [] };
  const seen = new Set(ledger.seenEventIds || []);
  return { baseline: false, newEvents: events.filter((e) => e.id && !seen.has(e.id)) };
}

function isNewTour(newEvents) {
  return newEvents.length >= TOUR_MIN_NEW_DATES;
}

function batchKey(newEvents) {
  const ids = newEvents.map((e) => e.id).sort().join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

/** Today's ids first, then older ones, capped. */
function nextSeenIds(ledger, events) {
  const ids = [...events.map((e) => e.id).filter(Boolean), ...(ledger?.seenEventIds || [])];
  return Array.from(new Set(ids)).slice(0, MAX_SEEN_IDS);
}

function byDate(a, b) {
  return String(a.date || '').localeCompare(String(b.date || ''));
}

function dateLine(e) {
  return [e.date, e.venue, e.city].filter(Boolean).join(' · ');
}

/**
 * Decide every alert for one band on one run.
 *
 * @param {object} p
 * @param {{ key: string, name: string }} p.band
 * @param {Array} p.events     every upcoming Ticketmaster date for the band
 * @param {Array} p.newEvents  the ones not in the ledger
 * @param {boolean} p.baseline first run for this band
 * @param {Array<{ uid, profile, venueKeys: Set<string> }>} p.followers
 */
function planAlerts({ band, events, newEvents, baseline, followers }) {
  const alerts = [];
  const lid = ledgerId(band.key);
  const tour = !baseline && isNewTour(newEvents);
  const tourBatch = tour ? batchKey(newEvents) : null;
  const newIds = new Set(newEvents.map((e) => e.id));

  for (const f of followers) {
    const tourPref = prefFor(f.profile, 'followedBands');
    const venuePref = prefFor(f.profile, 'venueBucketList');
    const tourAlertSent = tour && tourPref.enabled;

    const bucketHits = venuePref.enabled
      ? events.filter((e) => f.venueKeys.has(venueKeyFor(e.venue, e.city)))
      : [];

    if (tourAlertSent) {
      const dates = [...newEvents].sort(byDate);
      alerts.push({
        id: `bandTour_${f.uid}_${lid}_${tourBatch}`,
        uid: f.uid,
        kind: 'tour',
        push: tourPref.push,
        email: tourPref.email,
        band,
        dates,
        bucketListEventIds: bucketHits.filter((e) => newIds.has(e.id)).map((e) => e.id),
        notification: {
          uid: f.uid,
          type: 'followed_band_tour',
          artist: band.name,
          artistKey: band.key,
          message: `${band.name} announced ${dates.length} new dates.`,
          dates: dates.slice(0, MAX_DATES_IN_EMAIL).map((e) => ({
            date: e.date || null, venue: e.venue || null, city: e.city || null, url: e.url || null,
          })),
          dateCount: dates.length,
          read: false,
        },
      });
    }

    for (const e of bucketHits) {
      alerts.push({
        id: `venueMatch_${f.uid}_${e.id}`,
        uid: f.uid,
        kind: 'venue',
        push: venuePref.push,
        email: venuePref.email,
        // Already in today's tour email, marked as a bucket-list venue:
        // one email, not two, on the morning a tour lands there.
        inAppOnly: tourAlertSent && newIds.has(e.id),
        band,
        event: e,
        notification: {
          uid: f.uid,
          type: 'venue_bucket_list_match',
          message: `${band.name} is playing at ${e.venue} on ${e.date} — on your bucket list!`,
          venueKey: venueKeyFor(e.venue, e.city),
          artist: band.name,
          artistKey: band.key,
          venue: e.venue,
          date: e.date,
          url: e.url || null,
          read: false,
        },
      });
    }
  }
  return alerts;
}

// ── Email ───────────────────────────────────────────────────────────────

function unfollowFooter(uid, band) {
  return `
  <p style="margin:24px 0 0;text-align:center;font-size:13px;color:#6b7280">
    You follow ${escapeHtml(band.name)} on MySetlists.
    <a href="${unfollowUrl({ uid, artistKey: band.key })}" style="color:#6b7280">Unfollow ${escapeHtml(band.name)}</a>
  </p>`;
}

function button(text, url) {
  return `
  <p style="margin:24px 0;text-align:center">
    <a href="${url}" style="background:${GREEN};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">${text}</a>
  </p>`;
}

function tourEmail(alert) {
  const { band, dates, uid } = alert;
  const bucket = new Set(alert.bucketListEventIds || []);
  const shown = dates.slice(0, MAX_DATES_IN_EMAIL);
  const rows = shown.map((e) => {
    const onList = bucket.has(e.id)
      ? ' <span style="color:#059669;font-weight:700">· on your bucket list</span>'
      : '';
    const line = escapeHtml(dateLine(e));
    const linked = e.url ? `<a href="${escapeHtml(e.url)}" style="color:#111827;text-decoration:none">${line}</a>` : line;
    return `<li style="margin:0 0 8px">${linked}${onList}</li>`;
  }).join('');
  const more = dates.length > shown.length
    ? `<p style="margin:0;color:#6b7280;font-size:14px">…and ${dates.length - shown.length} more.</p>`
    : '';
  const subject = bucket.size
    ? `${band.name} announced ${dates.length} new dates — including one on your bucket list`
    : `${band.name} announced ${dates.length} new dates`;
  const html = wrapEmail(`
    <h2 style="color:#059669;margin:0 0 16px;font-size:22px">${escapeHtml(band.name)} announced new dates</h2>
    <p style="margin:0 0 16px">${escapeHtml(band.name)}, a band you follow, just put ${dates.length} new dates on sale:</p>
    <ul style="margin:0 0 16px;padding-left:20px">${rows}</ul>
    ${more}
    ${button('See all dates &rarr;', `${SITE_URL}/notifications/`)}
    ${unfollowFooter(uid, band)}`);
  return { subject, html };
}

function venueEmail(alert) {
  const { band, event: e, uid } = alert;
  const venueUrl = `${SITE_URL}/venues/?venue=${encodeURIComponent(venueKeyFor(e.venue, e.city))}`;
  const subject = `${band.name} is playing ${e.venue} — on your bucket list`;
  const html = wrapEmail(`
    <h2 style="color:#059669;margin:0 0 16px;font-size:22px">Bucket list match</h2>
    <p style="margin:0 0 16px"><strong style="color:#111827">${escapeHtml(band.name)}</strong> is playing at <strong style="color:#111827">${escapeHtml(e.venue)}</strong>${e.city ? `, ${escapeHtml(e.city)}` : ''} — a venue on your bucket list.</p>
    <div style="border:1px solid #e5e7eb;border-left:4px solid ${GREEN};border-radius:8px;padding:16px 20px;margin:16px 0;background:#f9fafb">
      <p style="margin:0;font-weight:700;color:#111827;font-size:17px">${escapeHtml(band.name)}</p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:14px">${escapeHtml(dateLine(e))}</p>
    </div>
    ${button(e.url ? 'Get Tickets &rarr;' : 'View Venue &rarr;', e.url ? escapeHtml(e.url) : venueUrl)}
    ${unfollowFooter(uid, band)}`);
  return { subject, html };
}

// ── Push ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];

function monthOf(date) {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(String(date || ''));
  return m ? Number(m[1]) - 1 : null;
}

/** 'spring' when at least two thirds of the dates fall in one season, else null. */
function tourSeason(dates) {
  const counts = {};
  let known = 0;
  dates.forEach((e) => {
    const m = monthOf(e.date);
    if (m == null) return;
    known++;
    counts[SEASONS[m]] = (counts[SEASONS[m]] || 0) + 1;
  });
  const [season, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  return season && n * 3 >= known * 2 ? season : null;
}

/** 'Jun 3', or 'Jun 3, 2027' outside the current year. */
function shortDate(date, nowMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return String(date || '');
  const day = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return Number(m[1]) === new Date(nowMs).getUTCFullYear() ? day : `${day}, ${m[1]}`;
}

// The band screens in the app (/bands/?band=<slug>) exist for the bands in
// config/public-artists.json; lib/bandScreens.js matches names the same way.
const BAND_SLUGS = new Map(publicArtists.artists.map((a) => [artistNameKeyLoose(a.name), a.slug]));

/**
 * Where tapping the push goes, as a universal link: the iOS app routes it
 * through lib/deepLinks.js, the web through the service worker. A tour
 * opens the band's screen when it has one; everything else opens
 * Notifications, where the alert lists its dates and ticket links.
 */
function pushLink(alert) {
  const slug = alert.kind === 'tour' ? BAND_SLUGS.get(artistNameKeyLoose(alert.band.name)) : null;
  return slug ? `${SITE_URL}/bands/?band=${encodeURIComponent(slug)}` : `${SITE_URL}/notifications/`;
}

/** { title, body, link, threadId }. Alerts only: there are no marketing pushes. */
function pushFor(alert, nowMs = Date.now()) {
  const name = alert.band.name;
  if (alert.kind === 'tour') {
    const season = tourSeason(alert.dates);
    const n = alert.dates.length;
    return {
      title: 'Tour announced',
      body: `${name} announced ${season ? `a ${season}` : 'a'} tour: ${n} date${n === 1 ? '' : 's'}`,
      link: pushLink(alert),
      threadId: alert.band.key,
    };
  }
  return {
    title: 'Bucket-list venue',
    body: `${name} plays ${alert.event.venue} on ${shortDate(alert.event.date, nowMs)}`,
    link: pushLink(alert),
    threadId: alert.band.key,
  };
}

function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === 'already-exists' || /already exists/i.test(err?.message || '');
}

/**
 * Write each alert's notification, then email/push it — only if the write
 * created it. Resolves { created, duplicates, emailed, pushed, deadTokens,
 * failed }; `pushed` counts alerts that reached at least one device.
 */
async function deliverAlerts({ db, alerts, profiles, tokens = new Map(), createdAt, sendEmail, sendPush, now = () => Date.now() }) {
  const out = { created: 0, duplicates: 0, emailed: 0, pushed: 0, deadTokens: 0, failed: 0 };
  for (const alert of alerts) {
    try {
      await db.collection('notifications').doc(alert.id).create({ ...alert.notification, createdAt });
    } catch (err) {
      if (isAlreadyExists(err)) { out.duplicates++; continue; }
      out.failed++;
      console.error('[followedBands] notification write failed', alert.id, err.message);
      continue;
    }
    out.created++;
    if (alert.inAppOnly) continue;

    const profile = profiles.get(alert.uid) || {};
    if (alert.email && profile.email && sendEmail) {
      const { subject, html } = alert.kind === 'tour' ? tourEmail(alert) : venueEmail(alert);
      const type = alert.kind === 'tour' ? 'followed_band_tour' : 'venue_bucket_list';
      const r = await sendEmail({ uid: alert.uid, email: profile.email, subject, html, type });
      if (r === 'sent') out.emailed++;
    }
    const devices = tokens.get(alert.uid) || [];
    if (alert.push && devices.length && sendPush) {
      const msg = { ...pushFor(alert, now()), notificationId: alert.id };
      const r = await pushToDevices({ db, devices, sendPush, msg, tag: 'followedBands' });
      if (r.reached) out.pushed++;
      out.deadTokens += r.dead;
    }
  }
  return out;
}

// ── The run ─────────────────────────────────────────────────────────────

/**
 * One full run. Everything outside this file is injected:
 *   fetchEvents(name, ledger) → { events: [...], attractionId|null }
 *   sendEmail({ uid, email, subject, html, type }) → 'sent'|'skipped'|'failed'
 *   sendPush(token, { title, body, link, threadId, notificationId }) —
 *     rejects with FCM's error; a dead-token code removes the token
 *   createdAt  — FieldValue.serverTimestamp() in production
 *   deadline   — ms timestamp; bands not reached are first in line next run
 */
async function runFollowedBandJob({ db, fetchEvents, sendEmail, sendPush, createdAt, now = () => Date.now(), deadline = Infinity, pause = async () => {} }) {
  const profileSnap = await db.collection('userProfiles')
    .select('favoriteArtists', 'notificationPrefs', 'email', 'fcmToken').get();
  const profiles = new Map();
  const followersByBand = new Map(); // key -> { name, uids: Set }
  profileSnap.docs.forEach((d) => {
    const data = d.data() || {};
    const follows = Array.isArray(data.favoriteArtists) ? data.favoriteArtists : [];
    if (!follows.length) return;
    profiles.set(d.id, data);
    follows.forEach((f) => {
      const key = artistKey(f?.name);
      if (!key) return;
      if (!followersByBand.has(key)) followersByBand.set(key, { name: String(f.name).trim(), uids: new Set() });
      followersByBand.get(key).uids.add(d.id);
    });
  });

  const venuesByUid = new Map();
  const bucketSnap = await db.collection('bucketListVenues').get();
  bucketSnap.docs.forEach((d) => {
    const v = d.data() || {};
    if (!v.userId || !v.venueKey || !profiles.has(v.userId)) return;
    if (!venuesByUid.has(v.userId)) venuesByUid.set(v.userId, new Set());
    venuesByUid.get(v.userId).add(v.venueKey);
  });

  const ledgerSnap = await db.collection(LEDGER_COLLECTION).get();
  const ledgers = new Map(ledgerSnap.docs.map((d) => [d.id, d.data()]));

  const tokens = sendPush ? await loadPushTokens(db, profiles) : new Map();

  // Least recently checked first, so a run that hits its deadline picks up
  // where the last one stopped instead of re-checking the same bands.
  const bands = [...followersByBand.entries()]
    .map(([key, v]) => ({ key, name: v.name, uids: v.uids, ledger: ledgers.get(ledgerId(key)) || null }))
    .sort((a, b) => (a.ledger?.checkedAtMs || 0) - (b.ledger?.checkedAtMs || 0));

  const totals = { bands: 0, baselines: 0, tours: 0, created: 0, duplicates: 0, emailed: 0, pushed: 0, deadTokens: 0, failed: 0, skippedForTime: 0 };

  for (const b of bands) {
    if (now() > deadline) { totals.skippedForTime = bands.length - totals.bands; break; }
    let fetched;
    try {
      fetched = await fetchEvents(b.name, b.ledger);
    } catch (err) {
      console.warn('[followedBands] fetch failed for', b.name, err.message);
      totals.bands++;
      continue;
    }
    await pause();
    if (!fetched) { totals.bands++; continue; } // lookup failed: try again next run, ledger untouched
    const events = fetched.events || [];

    const { baseline, newEvents } = newEventsSince(b.ledger, events);
    const followers = [...b.uids].map((uid) => ({
      uid, profile: profiles.get(uid), venueKeys: venuesByUid.get(uid) || new Set(),
    }));
    const alerts = planAlerts({ band: { key: b.key, name: b.name }, events, newEvents, baseline, followers });
    const r = await deliverAlerts({ db, alerts, profiles, tokens, createdAt, sendEmail, sendPush, now });
    Object.keys(r).forEach((k) => { totals[k] += r[k]; });
    if (baseline) totals.baselines++;
    if (!baseline && isNewTour(newEvents)) totals.tours++;

    await db.collection(LEDGER_COLLECTION).doc(ledgerId(b.key)).set({
      artistKey: b.key,
      name: b.name,
      tmAttractionId: fetched.attractionId || b.ledger?.tmAttractionId || null,
      seenEventIds: nextSeenIds(b.ledger, events),
      baselineAtMs: b.ledger?.baselineAtMs || now(),
      checkedAtMs: now(),
    });
    totals.bands++;
  }
  return totals;
}

module.exports = {
  LEDGER_COLLECTION, PUSH_TOKENS, TOUR_MIN_NEW_DATES,
  artistKey, ledgerId, venueKeyFor, newEventsSince, isNewTour, batchKey, nextSeenIds,
  prefFor, planAlerts, deliverAlerts, runFollowedBandJob, tourEmail, venueEmail,
  pushFor, tourSeason, isDeadToken,
};
