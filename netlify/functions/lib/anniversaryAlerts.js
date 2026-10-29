/**
 * anniversaryAlerts — the daily "X years ago today you saw…" job, minus
 * the network. netlify/functions/anniversary-notifications.js supplies
 * Firestore, Resend and FCM; tests/notifications/anniversaries.test.js
 * supplies fakes and runs it twice to prove nobody is told twice.
 *
 * WHY NOBODY IS TOLD TWICE. A reminder's notification id is fixed,
 * anniversary_{uid}_{showId}_{year}, and written with create(), which
 * fails if that id exists; email and push go out only after a create
 * succeeds. Before 5.49.2 it was set(merge) and the email went out
 * regardless, so a second run on the same day (a retry, or "Run now" in
 * Netlify) emailed everyone again and marked their reminder unread.
 *
 * PUSH (5.49.2). Every device the user has (lib/pushDelivery.js), the iOS
 * app included; before, only the legacy web token. A tap opens the show
 * (/shows/?show=<id>). Push and email are switched separately
 * (notificationPrefs.anniversaries.push / .email).
 */

const { escapeHtml, FOOTER_MARKER } = require('./emailLayout');
const { anniversaryYearsAgo } = require('./anniversaryMatch');
const { prefFor, pushToDevices } = require('./pushDelivery');

const SITE_URL = 'https://mysetlists.net';

/** The shows whose anniversary is today: [{ uid, showId, show, yearsAgo }]. */
function findAnniversaries(shows, todayISO) {
  const matches = [];
  shows.forEach(({ uid, showId, show }) => {
    if (!uid || !show) return;
    const yearsAgo = anniversaryYearsAgo(show.date, todayISO);
    if (yearsAgo) matches.push({ uid, showId, show, yearsAgo });
  });
  return matches;
}

function normalizeShowKey(show) {
  const norm = (v) => (v || '').trim().toLowerCase();
  return show.setlistfmId || `${norm(show.artist)}|${norm(show.venue)}|${norm(show.date)}`;
}

/** The show in the app (lib/showRouting.js's showHref), as a universal link. */
function showLink(showId) {
  return `${SITE_URL}/shows/?show=${encodeURIComponent(showId)}`;
}

function anniversaryMessage(m) {
  return `${m.yearsAgo} year${m.yearsAgo !== 1 ? 's' : ''} ago today you saw ${m.show.artist} at ${m.show.venue}`;
}

function anniversaryPush(m) {
  return { title: 'Anniversary', body: anniversaryMessage(m), link: showLink(m.showId), threadId: 'anniversary' };
}

function anniversaryEmailHtml({ artist, venue, city, date, yearsAgo, showUrl }) {
  const a = escapeHtml(artist);
  const v = escapeHtml(venue);
  const loc = city ? `, ${escapeHtml(city)}` : '';
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <tr><td style="padding:24px 32px 16px;text-align:center;border-bottom:1px solid #e5e7eb">
          <img src="https://mysetlists.net/logo.svg" alt="MySetlists" width="160" style="display:inline-block;max-width:160px;height:auto" />
        </td></tr>
        <tr><td style="padding:28px 32px;color:#374151;font-size:15px;line-height:1.6">
          <h2 style="color:#059669;margin:0 0 16px;font-size:22px">${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago today...</h2>
          <p style="margin:0 0 16px">You saw <strong style="color:#111827">${a}</strong> at <strong style="color:#111827">${v}</strong>${loc}.</p>
          <div style="border:1px solid #e5e7eb;border-left:4px solid #34D399;border-radius:8px;padding:16px 20px;margin:16px 0;background:#f9fafb">
            <p style="margin:0;font-weight:700;color:#111827;font-size:17px">${a}</p>
            <p style="margin:4px 0 0;color:#6b7280;font-size:14px">${v}${loc}</p>
            <p style="margin:4px 0 0;color:#6b7280;font-size:14px">${escapeHtml(date)}</p>
          </div>
          <p style="margin:24px 0;text-align:center">
            <a href="${escapeHtml(showUrl)}" style="background:#34D399;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">
              Relive this show &rarr;
            </a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;text-align:center;border-top:1px solid #e5e7eb;background:#f9fafb">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            <a href="https://mysetlists.net" style="color:#9ca3af;text-decoration:none">mysetlists.net</a> &mdash; track all your shows
          </p>
          ${FOOTER_MARKER}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function anniversaryEmail(m) {
  return {
    subject: `${m.yearsAgo} years ago: You saw ${m.show.artist} at ${m.show.venue}`,
    html: anniversaryEmailHtml({
      artist: m.show.artist,
      venue: m.show.venue,
      city: m.show.city,
      date: m.show.date,
      yearsAgo: m.yearsAgo,
      showUrl: showLink(m.showId),
    }),
  };
}

function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === 'already-exists' || /already exists/i.test(err?.message || '');
}

/**
 * Write each reminder's notification, then email/push it — only if the
 * write created it. Everything outside this file is injected:
 *   sendEmail({ uid, email, subject, html, type }) → 'sent'|'skipped'|'failed'
 *   sendPush(token, { title, body, link, threadId, notificationId })
 *   tokens     — lib/pushDelivery.js loadPushTokens()
 *   createdAt  — FieldValue.serverTimestamp() in production
 * Resolves { created, duplicates, emailed, pushed, deadTokens, failed }.
 */
async function deliverAnniversaries({ db, matches, profiles, tokens = new Map(), year, createdAt, sendEmail, sendPush }) {
  const out = { created: 0, duplicates: 0, emailed: 0, pushed: 0, deadTokens: 0, failed: 0 };
  for (const m of matches) {
    const profile = profiles.get(m.uid) || {};
    const pref = prefFor(profile, 'anniversaries');
    if (!pref.enabled) continue;

    const id = `anniversary_${m.uid}_${m.showId}_${year}`;
    try {
      await db.collection('notifications').doc(id).create({
        uid: m.uid,
        type: 'anniversary',
        message: anniversaryMessage(m),
        concertKey: normalizeShowKey(m.show),
        showId: m.showId,
        artist: m.show.artist,
        venue: m.show.venue,
        date: m.show.date,
        read: false,
        createdAt,
      });
    } catch (err) {
      if (isAlreadyExists(err)) { out.duplicates++; continue; }
      out.failed++;
      console.error('[anniversary] notification write failed', id, err.message);
      continue;
    }
    out.created++;

    if (pref.email && profile.email && sendEmail) {
      try {
        const { subject, html } = anniversaryEmail(m);
        const r = await sendEmail({ uid: m.uid, email: profile.email, subject, html, type: 'anniversary' });
        if (r === 'sent') out.emailed++;
      } catch (err) {
        console.warn('[anniversary] email send failed for', m.uid, err.message);
      }
    }

    const devices = tokens.get(m.uid) || [];
    if (pref.push && devices.length && sendPush) {
      const msg = { ...anniversaryPush(m), notificationId: id };
      const r = await pushToDevices({ db, devices, sendPush, msg, tag: 'anniversary' });
      if (r.reached) out.pushed++;
      out.deadTokens += r.dead;
    }
  }
  return out;
}

module.exports = {
  findAnniversaries, anniversaryPush, anniversaryEmail, deliverAnniversaries, showLink,
};
