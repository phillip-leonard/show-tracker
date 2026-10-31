/**
 * onsaleAlerts — "a band you follow has a show going on sale near you", minus
 * the network. onsale-scan-background.js and onsale-reminder.js supply
 * Firestore, Ticketmaster, Resend and push; tests/notifications/
 * onsaleAlerts.test.js supplies fakes and runs the same code repeatedly to
 * prove nobody is told twice.
 *
 * WHERE A SHOW COMES FROM. Ticketmaster's dates for each followed band, merged
 * with the shows the band's own emails announce (presaleIntel, parsed by
 * lib/presaleParser.js). Both become one shape, a candidate, keyed by
 * eventKey = band + date + city, so a show announced by email and listed on
 * Ticketmaster a week later is still one show, and so are the several listings
 * Ticketmaster can carry for one night.
 *
 * WHO HEARS ABOUT IT. A follower with alertSettings/{uid} (home location, radius
 * and time zone; owner-only, because userProfiles is readable by every
 * signed-in user) whose home is within their radius of the venue.
 *
 * WHY NOBODY IS TOLD TWICE. onsaleAlerts/{uid}_{eventKey} is written with
 * create(), which fails if it exists, and channels go out only after a create
 * succeeds. Later changes to the sale update the record and say nothing.
 *
 * WHAT THE ALERT OFFERS (accessFor), best first, and never a guessed code:
 *   1. a code from the band's own email
 *   2. the band's own ticket portal, when it sells through one
 *   3. a sign-up link (newsletter, Seated) to get access themselves
 * Codes in Seated's emails and in Ticketmaster's listing text are not shown.
 *
 * TIMES are UTC ISO on the records, formatted in the user's zone when sent.
 */

const { escapeHtml, wrapEmail } = require('./emailLayout');
const { prefFor, loadPushTokens, pushToDevices } = require('./pushDelivery');
const { artistKey, ledgerId } = require('./followedBandAlerts');

const SITE_URL = 'https://mysetlists.net';
const ONSALE_ALERTS = 'onsaleAlerts';
const ALERT_SETTINGS = 'alertSettings';
const ARTISTS = 'artists';
const PRESALE_INTEL = 'presaleIntel';
const DEFAULT_RADIUS_MILES = 100;
const RECENT_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 60 * 60 * 1000;
const ATTRACTION_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const GREEN = '#10b981';

// ── Keys and distance ───────────────────────────────────────────────────

/** 'new york' from 'New York, NY'. */
function normalizeCity(city) {
  return String(city || '').split(',')[0].trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function eventKeyFor(artistId, date, city) {
  return `${artistId}_${date}_${normalizeCity(city).replace(/ /g, '-') || 'unknown'}`;
}

function haversineMiles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const VENUE_NOISE = new Set(['the', 'at', 'of', 'and', 'theatre', 'theater', 'amphitheatre', 'amphitheater', 'arena', 'center', 'centre', 'hall', 'music', 'pavilion']);

function venueWords(venue) {
  return new Set(String(venue || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !VENUE_NOISE.has(w)));
}

/** "Red Rocks Amphitheatre" and "Red Rocks": every distinctive word of the shorter name is in the longer. */
function venuesMatch(a, b) {
  const x = venueWords(a);
  const y = venueWords(b);
  if (!x.size || !y.size) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
}

// ── Sale windows ────────────────────────────────────────────────────────

function ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
}

/** A sale still worth telling anyone about: ahead, or begun in the last day, or not yet dated. */
function saleIsLive(c, nowMs) {
  const starts = [c.publicOnsaleAt, ...(c.presales || []).map((p) => p.startsAt)].map(ms).filter((t) => t != null);
  if (starts.some((t) => t >= nowMs - RECENT_MS)) return true;
  return !!c.publicOnsaleTBD && !starts.length;
}

/** When the earliest window still ahead opens, or null: a TBA sale gets no reminder. */
function nextSaleAtMs(c, nowMs) {
  const starts = [...(c.publicOnsaleTBD ? [] : [c.publicOnsaleAt]), ...(c.presales || []).map((p) => p.startsAt)]
    .map(ms).filter((t) => t != null && t > nowMs);
  return starts.length ? Math.min(...starts) : null;
}

// ── Matching email to shows ─────────────────────────────────────────────

/**
 * Does this parsed email cover this show? 'high' on date and city, 'low' when
 * only the date and venue agree (a low match is applied only after the admin
 * approves it), or null. A tour-wide email covers every date in its range.
 */
function intelMatch(intel, show) {
  const shows = intel.shows || [];
  let best = null;
  for (const s of shows) {
    if (s.date !== show.date) continue;
    if (s.city && normalizeCity(s.city) === normalizeCity(show.city)) return 'high';
    if (venuesMatch(s.venue, show.venue)) best = 'low';
  }
  if (best) return best;
  if (intel.tourWide && shows.length) {
    const dates = shows.map((s) => s.date).sort();
    if (show.date >= dates[0] && show.date <= dates[dates.length - 1]) return 'high';
  }
  return null;
}

/** Accepted, and about a sale: a newsletter listing tour dates in passing alerts nobody. */
function usable(intel) {
  return intel.status === 'accepted' && intel.isSaleEmail !== false;
}

function intelApplies(intel, show) {
  if (!usable(intel)) return false;
  const match = intelMatch(intel, show);
  return match === 'high' || (match === 'low' && intel.adminApproved === true);
}

function presaleWindow(intel) {
  return intel.startsAt
    ? { name: intel.presaleName || 'Presale', startsAt: intel.startsAt, endsAt: intel.endsAt || null, url: intel.signupUrl || intel.ticketUrl || null }
    : null;
}

function mergePresales(a, b) {
  const seen = new Set();
  return [...a, ...b].filter((p) => {
    const k = `${p.name}|${p.startsAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The code, portal or sign-up link for one show, from everything known now.
 * Only a band's own email can supply a code; the parser enforces that too, so
 * this check is the second lock on the door.
 */
function accessFor({ artist, intelList, show }) {
  const applied = intelList.filter((i) => intelApplies(i, show)).sort((a, b) => (b.parsedAtMs || 0) - (a.parsedAtMs || 0));
  const coded = applied.find((i) => i.code && i.senderKind === 'band' && !i.codeIsPersonal);
  const portal = applied.find((i) => i.ticketingModel === 'bandPortal' && i.ticketUrl);
  const urls = artist.presaleSignupUrls || [];
  const signup = applied.find((i) => i.signupUrl)?.signupUrl
    || urls.find((u) => u.kind === 'seated')?.url
    || urls[0]?.url
    || null;
  return {
    presaleCode: coded ? coded.code : null,
    codeSource: coded ? `From ${artist.name}'s newsletter` : null,
    signupUrl: signup,
    portalUrl: portal ? portal.ticketUrl : null,
    ticketingModel: portal ? 'bandPortal' : artist.ticketingModel || 'ticketmaster',
    presales: applied.map(presaleWindow).filter(Boolean),
  };
}

// ── Candidates ──────────────────────────────────────────────────────────

/** Every show for one band with a live sale, Ticketmaster and email merged by eventKey. */
async function buildCandidates({ artist, events, intelList, locate, nowMs }) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const byKey = new Map();
  const add = (c) => {
    const prev = byKey.get(c.eventKey);
    if (!prev) { byKey.set(c.eventKey, c); return; }
    prev.presales = mergePresales(prev.presales, c.presales);
    prev.publicOnsaleAt = prev.publicOnsaleAt || c.publicOnsaleAt;
    prev.publicOnsaleTBD = prev.publicOnsaleTBD && !c.publicOnsaleAt;
    prev.lat = prev.lat ?? c.lat;
    prev.lng = prev.lng ?? c.lng;
  };

  for (const e of events) {
    if (!e.date || e.date < today || e.status === 'cancelled') continue;
    add({
      eventKey: eventKeyFor(artist.id, e.date, e.city),
      tmEventId: e.id,
      artistId: artist.id,
      artistName: artist.name,
      venue: e.venue,
      city: e.city,
      state: e.state || null,
      eventDate: e.date,
      lat: e.lat,
      lng: e.lng,
      url: e.url,
      timezone: e.timezone || null,
      publicOnsaleAt: e.publicOnsaleAt ? new Date(e.publicOnsaleAt).toISOString() : null,
      publicOnsaleTBD: !!e.publicOnsaleTBD,
      presales: e.presales || [],
    });
  }

  for (const intel of intelList.filter(usable)) {
    for (const s of intel.shows || []) {
      if (s.date < today) continue;
      const key = eventKeyFor(artist.id, s.date, s.city);
      if (!byKey.has(key)) {
        if (s.lat == null || s.lng == null) {
          const at = await locate(s);
          if (!at) continue;
          s.lat = at.lat;
          s.lng = at.lng;
        }
        add({
          eventKey: key,
          tmEventId: null,
          artistId: artist.id,
          artistName: artist.name,
          venue: s.venue,
          city: s.city,
          state: s.state || null,
          eventDate: s.date,
          lat: s.lat,
          lng: s.lng,
          url: intel.ticketUrl || null,
          timezone: null,
          publicOnsaleAt: null,
          publicOnsaleTBD: !intel.startsAt,
          presales: [],
        });
      }
    }
  }

  const out = [];
  for (const c of byKey.values()) {
    const access = accessFor({ artist, intelList, show: { date: c.eventDate, city: c.city, venue: c.venue } });
    const merged = { ...c, ...access, presales: mergePresales(c.presales, access.presales) };
    if (saleIsLive(merged, nowMs)) out.push(merged);
  }
  return out;
}

/** Which Ticketmaster ids each parsed email now covers, and whether a venue-only match wants review. */
function matchesForIntel(intel, events) {
  const ids = [];
  let needsReview = false;
  for (const e of events) {
    const m = intelMatch(intel, { date: e.date, city: e.city, venue: e.venue });
    if (m === 'high') ids.push(e.id);
    if (m === 'low') {
      if (intel.adminApproved) ids.push(e.id);
      else needsReview = true;
    }
  }
  return { ids, needsReview };
}

// ── Formatting ──────────────────────────────────────────────────────────

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return !!tz;
  } catch {
    return false;
  }
}

/** 'Fri, Nov 6, 10:00 AM EST'. */
function formatWhen(iso, tz) {
  const zone = validZone(tz) ? tz : 'UTC';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso));
}

/** The user's time, then the venue's when that reads differently. */
function formatSaleTime(iso, userTz, venueTz) {
  const mine = formatWhen(iso, userTz);
  if (!validZone(venueTz)) return mine;
  const theirs = formatWhen(iso, venueTz);
  return theirs === mine ? mine : `${mine} (${theirs} at the venue)`;
}

function showDate(date) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!y) return String(date || '');
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** [{ label, when }] for every window, soonest first, the public on-sale last. */
function windowLines(alert, userTz) {
  const lines = (alert.presales || [])
    .filter((p) => p.startsAt)
    .slice()
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt))
    .map((p) => ({
      label: p.name || 'Presale',
      when: formatSaleTime(p.startsAt, userTz, alert.timezone)
        + (p.endsAt ? `, until ${formatWhen(p.endsAt, userTz)}` : ''),
    }));
  if (alert.publicOnsaleTBD && !alert.publicOnsaleAt) lines.push({ label: 'Public on-sale', when: 'On-sale time TBA' });
  else if (alert.publicOnsaleAt) lines.push({ label: 'Public on-sale', when: formatSaleTime(alert.publicOnsaleAt, userTz, alert.timezone) });
  return lines;
}

function place(alert) {
  return [alert.venue, alert.city].filter(Boolean).join(', ');
}

/** What the alert sends you to, in order: portal, event page. */
function primaryLink(alert) {
  if (alert.portalUrl) return { url: alert.portalUrl, text: `Go to ${alert.artistName}'s ticket portal` };
  if (alert.url) return { url: alert.url, text: 'See the event' };
  return null;
}

// ── Email ───────────────────────────────────────────────────────────────

function emailCard(alert, userTz) {
  const windows = windowLines(alert, userTz).map((w) => `
      <tr>
        <td style="padding:2px 12px 2px 0;color:#6b7280;font-size:14px;vertical-align:top">${escapeHtml(w.label)}</td>
        <td style="padding:2px 0;color:#111827;font-size:14px">${escapeHtml(w.when)}</td>
      </tr>`).join('');

  let access = '';
  if (alert.presaleCode) {
    access = `
      <p style="margin:12px 0 4px;color:#6b7280;font-size:13px">Presale code</p>
      <p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:1px;color:#111827">${escapeHtml(alert.presaleCode)}</p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px">${escapeHtml(alert.codeSource || '')}</p>`;
  } else if (alert.signupUrl && !alert.portalUrl) {
    access = `
      <p style="margin:12px 0 0;font-size:14px;color:#111827">
        <a href="${escapeHtml(alert.signupUrl)}" style="color:#059669;font-weight:600">Sign up for ${escapeHtml(alert.artistName)}'s presale to get the code.</a>
      </p>`;
  }

  const link = primaryLink(alert);
  return `
    <div style="border:1px solid #e5e7eb;border-left:4px solid ${GREEN};border-radius:8px;padding:16px 20px;margin:16px 0;background:#f9fafb">
      <p style="margin:0;font-weight:700;color:#111827;font-size:17px">${escapeHtml(alert.artistName)}</p>
      <p style="margin:4px 0 12px;color:#6b7280;font-size:14px">${escapeHtml(showDate(alert.eventDate))} · ${escapeHtml(place(alert))}</p>
      <table role="presentation" style="border-collapse:collapse">${windows}</table>
      ${access}
      ${link ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link.url)}" style="background:${GREEN};color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:14px">${escapeHtml(link.text)} &rarr;</a></p>` : ''}
    </div>`;
}

/** One email however many alerts: a user gets one digest per run. */
function onsaleEmail(alerts, { userTz, reminder = false }) {
  const first = alerts[0];
  const subject = alerts.length === 1
    ? `${reminder ? 'On sale in an hour' : 'On sale soon'}: ${first.artistName} – ${first.city || first.venue}`
    : `${alerts.length} shows going on sale near you`;
  const heading = reminder ? 'Going on sale soon' : 'On sale near you';
  const intro = reminder
    ? 'The sale you were told about opens within the hour.'
    : 'A band you follow has a show going on sale near you.';
  const html = wrapEmail(`
    <h2 style="color:#059669;margin:0 0 16px;font-size:22px">${heading}</h2>
    <p style="margin:0 0 8px">${intro}</p>
    ${alerts.map((a) => emailCard(a, userTz)).join('')}
    <p style="margin:24px 0 0;text-align:center;font-size:13px;color:#6b7280">
      Times are shown in ${escapeHtml(validZone(userTz) ? userTz : 'UTC')}.
      <a href="${SITE_URL}/profile/" style="color:#6b7280">Change your on-sale alert preferences</a>
    </p>`);
  return { subject, html };
}

// ── Push and in-app ─────────────────────────────────────────────────────

function pushForAlerts(alerts, { reminder = false } = {}) {
  const first = alerts[0];
  const link = `${SITE_URL}/notifications/`;
  if (alerts.length === 1) {
    return {
      title: `On sale soon: ${first.artistName} – ${first.city || first.venue}`,
      body: reminder
        ? `Sale opens within the hour${first.presaleCode ? `. Code: ${first.presaleCode}` : ''}`
        : `${showDate(first.eventDate)} at ${first.venue || first.city}`,
      link,
      threadId: first.artistId,
    };
  }
  return { title: 'On sale near you', body: `${alerts.length} shows from bands you follow`, link, threadId: 'onsale' };
}

function notificationIdFor(alertId) {
  return `onsale_${alertId}`;
}

/** The in-app row. Display strings are built here, in the user's zone. */
function notificationFields(alert, userTz) {
  return {
    uid: alert.uid,
    type: 'onsale_alert',
    artist: alert.artistName,
    message: `${alert.artistName} is going on sale at ${place(alert)} for ${showDate(alert.eventDate)}.`,
    eventDate: alert.eventDate,
    venue: alert.venue || null,
    city: alert.city || null,
    windows: windowLines(alert, userTz),
    presaleCode: alert.presaleCode || null,
    codeSource: alert.codeSource || null,
    signupUrl: alert.signupUrl || null,
    portalUrl: alert.portalUrl || null,
    url: alert.url || null,
  };
}

function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === 'already-exists' || /already exists/i.test(err?.message || '');
}

/** On-sale prefs: prefFor's three, plus the in-app switch this alert adds. */
function onsalePref(profile) {
  const pref = prefFor(profile, 'onsaleAlerts');
  return { ...pref, inApp: profile?.notificationPrefs?.onsaleAlerts?.inApp !== false };
}

function channelsFor(pref, profile, devices) {
  const channels = [];
  if (pref.inApp) channels.push('inApp');
  if (pref.email && profile.email) channels.push('email');
  if (pref.push && devices.length) channels.push('push');
  return channels;
}

// What changes on a record without a new announcement.
const MUTABLE_FIELDS = ['publicOnsaleAt', 'publicOnsaleTBD', 'presales', 'presaleCode', 'codeSource', 'signupUrl', 'portalUrl', 'ticketingModel', 'url', 'tmEventId', 'timezone', 'nextSaleAtMs'];

function changedFields(existing, next) {
  const update = {};
  MUTABLE_FIELDS.forEach((k) => {
    if (JSON.stringify(existing[k] ?? null) !== JSON.stringify(next[k] ?? null)) update[k] = next[k] ?? null;
  });
  return update;
}

function alertRecord(uid, c, nowMs) {
  const next = nextSaleAtMs(c, nowMs);
  return {
    uid,
    eventKey: c.eventKey,
    tmEventId: c.tmEventId || null,
    artistId: c.artistId,
    artistName: c.artistName,
    venue: c.venue || null,
    city: c.city || null,
    state: c.state || null,
    eventDate: c.eventDate,
    timezone: c.timezone || null,
    publicOnsaleAt: c.publicOnsaleAt || null,
    publicOnsaleTBD: !!c.publicOnsaleTBD,
    presales: c.presales || [],
    presaleCode: c.presaleCode || null,
    codeSource: c.codeSource || null,
    signupUrl: c.signupUrl || null,
    portalUrl: c.portalUrl || null,
    ticketingModel: c.ticketingModel || 'ticketmaster',
    url: c.url || null,
    nextSaleAtMs: next,
  };
}

async function sendChannels({ db, uid, alerts, reminder, profile, settings, pref, tokens, sendEmail, sendPush, totals }) {
  const userTz = settings?.timezone || 'UTC';
  if (pref.email && profile.email && sendEmail) {
    const { subject, html } = onsaleEmail(alerts, { userTz, reminder });
    const r = await sendEmail({ uid, email: profile.email, subject, html, type: 'onsale_alert' });
    if (r === 'sent') totals.emailed++;
  }
  const devices = tokens.get(uid) || [];
  if (pref.push && devices.length && sendPush) {
    const msg = { ...pushForAlerts(alerts, { reminder }), notificationId: notificationIdFor(alerts[0].id) };
    const r = await pushToDevices({ db, devices, sendPush, msg, tag: 'onsale' });
    if (r.reached) totals.pushed++;
    totals.deadTokens += r.dead;
  }
}

/** Keep the in-app row in step with its record, leaving read and createdAt alone. */
async function refreshNotification(db, alert, userTz) {
  try {
    await db.collection('notifications').doc(notificationIdFor(alert.id)).update(notificationFields(alert, userTz));
  } catch {
    // No row: in-app is off for this user, or they had it when it was off.
  }
}

// ── The scan ────────────────────────────────────────────────────────────

/**
 * One full scan. Everything outside this file is injected:
 *   fetchEvents(name, { attractionId }) → { events, attractionId, attractionConfidence } | null
 *   locate(show) → { lat, lng } | null
 *   sendEmail({ uid, email, subject, html, type }) → 'sent'|'skipped'|'failed'
 *   sendPush(token, msg)
 *   deadline, maxBands — bands not reached go first next run: the cursor is
 *   each artist's onsaleCheckedAtMs
 */
async function runOnsaleScan({ db, fetchEvents, locate = async () => null, sendEmail, sendPush, createdAt, now = () => Date.now(), deadline = Infinity, maxBands = Infinity, pause = async () => {} }) {
  const totals = { bands: 0, created: 0, updated: 0, emailed: 0, pushed: 0, deadTokens: 0, failed: 0, skippedForTime: 0 };

  const [profileSnap, settingsSnap, artistSnap] = await Promise.all([
    db.collection('userProfiles').select('favoriteArtists', 'notificationPrefs', 'email', 'fcmToken').get(),
    db.collection(ALERT_SETTINGS).get(),
    db.collection(ARTISTS).get(),
  ]);
  const settings = new Map(settingsSnap.docs.map((d) => [d.id, d.data()]));
  const artists = new Map(artistSnap.docs.map((d) => [d.id, d.data()]));

  const profiles = new Map();
  const followersByBand = new Map();
  profileSnap.docs.forEach((d) => {
    const data = d.data() || {};
    const home = settings.get(d.id)?.homeLocation;
    if (!onsalePref(data).enabled || !Number.isFinite(home?.lat) || !Number.isFinite(home?.lng)) return;
    const follows = Array.isArray(data.favoriteArtists) ? data.favoriteArtists : [];
    if (!follows.length) return;
    profiles.set(d.id, data);
    follows.forEach((f) => {
      const key = artistKey(f?.name);
      if (!key) return;
      const id = ledgerId(key);
      if (!followersByBand.has(id)) followersByBand.set(id, { name: String(f.name).trim(), key, uids: new Set() });
      followersByBand.get(id).uids.add(d.id);
    });
  });

  const tokens = sendPush ? await loadPushTokens(db, profiles) : new Map();

  const bands = [...followersByBand.entries()]
    .map(([id, b]) => ({ ...b, id, artist: artists.get(id) || null }))
    .sort((a, b) => (a.artist?.onsaleCheckedAtMs || 0) - (b.artist?.onsaleCheckedAtMs || 0));

  const newAlerts = new Map(); // uid -> [record with id]

  for (const b of bands) {
    if (now() > deadline || totals.bands >= maxBands) { totals.skippedForTime = bands.length - totals.bands; break; }
    totals.bands++;
    const nowMs = now();
    const artistRef = db.collection(ARTISTS).doc(b.id);
    const artist = { id: b.id, name: b.artist?.name || b.name, artistKey: b.key, ...(b.artist || {}) };

    // A band Ticketmaster doesn't know is asked about weekly, not every run.
    let fetched = { events: [], attractionId: null };
    const known = artist.ticketmasterAttractionId;
    if (known || nowMs - (artist.attractionCheckedAtMs || 0) > ATTRACTION_RETRY_MS) {
      try {
        fetched = await fetchEvents(artist.name, { attractionId: known || null });
      } catch (err) {
        console.warn('[onsale] fetch failed for', artist.name, err.message);
        fetched = null;
      }
      await pause();
      if (!fetched) continue; // Ticketmaster could not be asked: first in line next run.
    }

    const update = { name: artist.name, artistKey: b.key, onsaleCheckedAtMs: nowMs };
    if (!known) {
      update.attractionCheckedAtMs = nowMs;
      if (fetched.attractionId) {
        update.ticketmasterAttractionId = fetched.attractionId;
        update.attractionConfidence = fetched.attractionConfidence || 'high';
        if (fetched.attractionConfidence === 'low') console.warn('[onsale] low-confidence attraction match', artist.name, fetched.attractionId);
      }
    }
    await artistRef.set(update, { merge: true });

    const events = fetched.events || [];
    const intelSnap = await db.collection(PRESALE_INTEL).where('artistId', '==', b.id).get();
    const intelList = intelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const showsBefore = new Map(intelList.map((i) => [i.id, JSON.stringify(i.shows || [])]));
    const candidates = await buildCandidates({ artist, events, intelList, locate, nowMs });

    for (const intel of intelList.filter(usable)) {
      const { ids, needsReview } = matchesForIntel(intel, events);
      const unlocated = (intel.shows || []).some((s) => s.date >= new Date(nowMs).toISOString().slice(0, 10) && !candidates.some((c) => c.eventDate === s.date) && s.lat == null);
      const patch = {};
      if (JSON.stringify(ids) !== JSON.stringify(intel.matchedTmEventIds || [])) patch.matchedTmEventIds = ids;
      if (needsReview !== !!intel.needsMatchReview) patch.needsMatchReview = needsReview;
      if (unlocated !== !!intel.unlocatedShows) patch.unlocatedShows = unlocated;
      // The locations just found, so they're not looked up again.
      if (JSON.stringify(intel.shows || []) !== showsBefore.get(intel.id)) patch.shows = intel.shows;
      if (Object.keys(patch).length) await db.collection(PRESALE_INTEL).doc(intel.id).update(patch);
    }

    const existingSnap = await db.collection(ONSALE_ALERTS).where('artistId', '==', b.id).get();
    const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

    for (const uid of b.uids) {
      const profile = profiles.get(uid);
      const userSettings = settings.get(uid);
      const pref = onsalePref(profile);
      const radius = Number(userSettings.alertRadiusMiles) || DEFAULT_RADIUS_MILES;
      const devices = tokens.get(uid) || [];
      const channels = channelsFor(pref, profile, devices);

      for (const c of candidates) {
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
        if (haversineMiles(userSettings.homeLocation, c) > radius) continue;

        const id = `${uid}_${c.eventKey}`;
        const record = alertRecord(uid, c, nowMs);
        const prev = existing.get(id);
        if (prev) {
          const changes = changedFields(prev, record);
          if (Object.keys(changes).length) {
            await db.collection(ONSALE_ALERTS).doc(id).update(changes);
            await refreshNotification(db, { ...prev, ...changes, id }, userSettings.timezone);
            totals.updated++;
          }
          continue;
        }
        // A user with every channel off isn't recorded, so turning one on still tells them.
        if (!channels.length) continue;

        const opening = record.nextSaleAtMs;
        const full = {
          ...record,
          channels,
          notifiedAtMs: nowMs,
          // Opening inside the reminder window: the announcement is the reminder.
          reminderSentAtMs: opening != null && opening - nowMs <= REMINDER_WINDOW_MS ? nowMs : null,
        };
        try {
          await db.collection(ONSALE_ALERTS).doc(id).create(full);
        } catch (err) {
          if (!isAlreadyExists(err)) {
            totals.failed++;
            console.error('[onsale] alert write failed', id, err.message);
          }
          continue;
        }
        totals.created++;
        const alert = { ...full, id };
        if (pref.inApp) {
          await db.collection('notifications').doc(notificationIdFor(id)).set({
            ...notificationFields(alert, userSettings.timezone),
            read: false,
            createdAt,
          });
        }
        if (!newAlerts.has(uid)) newAlerts.set(uid, []);
        newAlerts.get(uid).push(alert);
      }
    }
  }

  // After every band, so one user hears once however many shows there were.
  for (const [uid, alerts] of newAlerts) {
    await sendChannels({
      db, uid, alerts, reminder: false, profile: profiles.get(uid), settings: settings.get(uid), pref: onsalePref(profiles.get(uid)), tokens, sendEmail, sendPush, totals,
    });
  }
  return totals;
}

// ── The reminder ────────────────────────────────────────────────────────

/**
 * Alerts whose earliest sale opens within the hour. Reads presaleIntel again
 * first, because codes often come by email the morning of. A record is marked
 * before anything is sent, so a crash loses a reminder rather than doubling it.
 */
async function runOnsaleReminders({ db, sendEmail, sendPush, now = () => Date.now(), deadline = Infinity }) {
  const totals = { due: 0, reminded: 0, emailed: 0, pushed: 0, deadTokens: 0, skippedForTime: 0 };
  const nowMs = now();
  const snap = await db.collection(ONSALE_ALERTS)
    .where('nextSaleAtMs', '>=', nowMs)
    .where('nextSaleAtMs', '<=', nowMs + REMINDER_WINDOW_MS)
    .get();
  const due = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => !a.reminderSentAtMs);
  totals.due = due.length;
  if (!due.length) return totals;

  const artistCache = new Map();
  const context = async (artistId) => {
    if (!artistCache.has(artistId)) {
      const [artistSnap, intelSnap] = await Promise.all([
        db.collection(ARTISTS).doc(artistId).get(),
        db.collection(PRESALE_INTEL).where('artistId', '==', artistId).get(),
      ]);
      artistCache.set(artistId, {
        artist: { id: artistId, ...(artistSnap.data() || {}) },
        intelList: intelSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      });
    }
    return artistCache.get(artistId);
  };

  for (const alert of due) {
    if (now() > deadline) { totals.skippedForTime = due.length - totals.reminded; break; }
    const profileSnap = await db.collection('userProfiles').doc(alert.uid).get();
    const profile = profileSnap.data() || {};
    const settingsSnap = await db.collection(ALERT_SETTINGS).doc(alert.uid).get();
    const settings = settingsSnap.data() || {};
    const pref = onsalePref(profile);
    const { artist, intelList } = await context(alert.artistId);
    const access = accessFor({ artist: { name: alert.artistName, ...artist }, intelList, show: { date: alert.eventDate, city: alert.city, venue: alert.venue } });
    const updated = {
      ...alert,
      presaleCode: access.presaleCode || null,
      codeSource: access.codeSource || null,
      signupUrl: access.signupUrl || alert.signupUrl || null,
      portalUrl: access.portalUrl || alert.portalUrl || null,
      presales: mergePresales(alert.presales || [], access.presales),
      reminderSentAtMs: nowMs,
    };
    await db.collection(ONSALE_ALERTS).doc(alert.id).update({
      presaleCode: updated.presaleCode,
      codeSource: updated.codeSource,
      signupUrl: updated.signupUrl,
      portalUrl: updated.portalUrl,
      presales: updated.presales,
      reminderSentAtMs: nowMs,
    });
    totals.reminded++;

    if (!pref.enabled) continue;
    await refreshNotification(db, updated, settings.timezone);
    const tokens = new Map();
    if (sendPush) {
      const tokenMap = await loadPushTokens(db, new Map([[alert.uid, profile]]));
      tokens.set(alert.uid, tokenMap.get(alert.uid) || []);
    }
    await sendChannels({ db, uid: alert.uid, alerts: [updated], reminder: true, profile, settings, pref, tokens, sendEmail, sendPush, totals });
  }
  return totals;
}

module.exports = {
  ONSALE_ALERTS, ALERT_SETTINGS, ARTISTS, PRESALE_INTEL, DEFAULT_RADIUS_MILES,
  normalizeCity, eventKeyFor, haversineMiles, venuesMatch, saleIsLive, nextSaleAtMs, intelMatch, intelApplies,
  accessFor, buildCandidates, matchesForIntel, formatWhen, formatSaleTime, windowLines, onsaleEmail, pushForAlerts,
  notificationFields, notificationIdFor, onsalePref, changedFields, alertRecord, runOnsaleScan, runOnsaleReminders,
};
