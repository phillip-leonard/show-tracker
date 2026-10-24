// netlify/functions/anniversary-notifications.js
//
// Daily scheduled function: finds shows whose date falls on today's
// month-day in a past year, and creates an anniversary notification
// (Firestore doc, optional push, optional email) for the owning user,
// respecting their userProfiles/{uid}.notificationPrefs.anniversaries
// setting (default: enabled, both push and email).
//
// No cron/scheduled-job infrastructure existed in this repo before this —
// see components/ReleaseNotesView.jsx's v5.16.0 note re: digest emails
// needing "a scheduled job that doesn't exist yet". This is that job,
// registered as a Netlify Scheduled Function via the `schedule` setting in
// netlify.toml (this repo's functions use the classic exports.handler
// style, not the v2 `export default` style that takes an inline
// `export const config = { schedule }`).
//
// Scale note: does a single collectionGroup('shows').get() across every
// user rather than an indexed per-day query, since this app is small
// (landing page copy: "14+ fans tracking their shows"). Revisit with a
// stored `monthDay` field + collectionGroup query filtered on it if the
// user base grows enough that a full daily scan gets expensive.

const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { FOOTER_MARKER } = require('./lib/emailLayout');
const { utcIsoDate, anniversaryYearsAgo } = require('./lib/anniversaryMatch');

function initFirebase() {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  if (getApps().length > 0) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) throw new Error('Firebase env vars not configured');
  initializeApp({ credential: cert({ privateKey, clientEmail, projectId }), projectId });
}

// Opt-out check, signed unsubscribe footer and List-Unsubscribe headers
// all live in lib/outgoingEmail.js, shared with every other send path.
function sendEmail(db, uid, { to, subject, html }) {
  return sendNotificationEmail({ db, uid, email: to, subject, html, type: 'anniversary' });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
            <a href="${showUrl}" style="background:#34D399;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">
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

function normalizeShowKey(show) {
  const norm = (v) => (v || '').trim().toLowerCase();
  return show.setlistfmId || `${norm(show.artist)}|${norm(show.venue)}|${norm(show.date)}`;
}

exports.handler = async function () {
  initFirebase();
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore();

  // UTC on purpose; see lib/anniversaryMatch.js for why that is right at
  // this job's hour.
  const todayISO = utcIsoDate();
  const currentYear = Number(todayISO.slice(0, 4));

  const showsSnap = await db.collectionGroup('shows').get();
  const matches = [];
  showsSnap.forEach((docSnap) => {
    const show = docSnap.data();
    const yearsAgo = anniversaryYearsAgo(show.date, todayISO);
    if (!yearsAgo) return;
    const uid = docSnap.ref.parent.parent?.id;
    if (!uid) return;
    matches.push({ uid, showId: docSnap.id, show, yearsAgo });
  });

  if (matches.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0, notified: 0 }) };
  }

  const uids = Array.from(new Set(matches.map((m) => m.uid)));
  const profiles = new Map();
  await Promise.all(uids.map(async (uid) => {
    const snap = await db.collection('userProfiles').doc(uid).get();
    profiles.set(uid, snap.exists ? snap.data() : {});
  }));

  let notified = 0;

  for (const m of matches) {
    const profile = profiles.get(m.uid) || {};
    const prefs = profile.notificationPrefs?.anniversaries;
    const enabled = prefs?.enabled !== false; // default on
    if (!enabled) continue;
    const method = prefs?.method || 'both';

    const message = `${m.yearsAgo} year${m.yearsAgo !== 1 ? 's' : ''} ago today you saw ${m.show.artist} at ${m.show.venue}`;
    const notifId = `anniversary_${m.uid}_${m.showId}_${currentYear}`;

    try {
      await db.collection('notifications').doc(notifId).set({
        uid: m.uid,
        type: 'anniversary',
        message,
        concertKey: normalizeShowKey(m.show),
        artist: m.show.artist,
        venue: m.show.venue,
        date: m.show.date,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      notified++;
    } catch (err) {
      console.error('[anniversary] failed to write notification for', m.uid, m.showId, err.message);
      continue;
    }

    if ((method === 'email' || method === 'both') && profile.email) {
      try {
        await sendEmail(db, m.uid, {
          to: profile.email,
          subject: `${m.yearsAgo} years ago: You saw ${m.show.artist} at ${m.show.venue}`,
          html: anniversaryEmailHtml({
            artist: m.show.artist,
            venue: m.show.venue,
            city: m.show.city,
            date: m.show.date,
            yearsAgo: m.yearsAgo,
            showUrl: 'https://mysetlists.net/shows/',
          }),
        });
      } catch (err) {
        console.warn('[anniversary] email send failed for', m.uid, err.message);
      }
    }

    if ((method === 'push' || method === 'both') && profile.fcmToken) {
      try {
        const { getMessaging } = require('firebase-admin/messaging');
        await getMessaging().send({
          token: profile.fcmToken,
          notification: { title: 'Anniversary', body: message },
        });
      } catch (err) {
        console.warn('[anniversary] push send failed for', m.uid, err.message);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ processed: matches.length, notified }) };
};
