/**
 * notificationTemplates — the emails send-email builds, by type.
 *
 * Moved here from lib/emailTemplates.js in 5.59.6, when send-email
 * stopped accepting HTML from the browser (S-06): the client now names a
 * type and the ids, and the server builds the email from the records.
 * lib/emailTemplates.js re-exports these, so there is one copy.
 *
 * EVERY VALUE IS ESCAPED. Names, artist and venue strings, personal
 * messages and notification text all come from user input; the browser
 * versions interpolated them raw. Only this file's own markup is HTML.
 *
 * Templates are pure functions that return { subject, html }. Subjects
 * are plain text (Resend sends them as a header), so they are not
 * escaped, only stripped of line breaks.
 */

const { wrapEmail, escapeHtml } = require('./emailLayout');

const APP_URL = 'https://mysetlists.net';
const GREEN = '#34D399';
const GREEN_DARK = '#059669'; // darker green for button text contrast
const ORANGE = '#FB923C';

const e = escapeHtml;
const subjectText = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

/** A show date as the app shows it: M/D/YYYY for YYYY-MM-DD and DD-MM-YYYY, anything else as given. */
function formatShowDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${Number(m[2])}/${Number(m[1])}/${m[3]}`;
  return s;
}

function venueDashboardHref(venueKey) {
  return `/venue-dashboard/?venue=${encodeURIComponent(venueKey)}`;
}

function wrap(content) {
  return wrapEmail(content);
}

// `url` is always built here from constants and encoded ids, never taken
// from a request; escaped anyway because it sits in an attribute.
function button(text, url) {
  return `
  <p style="margin:24px 0;text-align:center">
    <a href="${e(url)}" style="background:${GREEN};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">
      ${text}
    </a>
  </p>`;
}

function showCard(artist, venue, date) {
  return `
  <div style="border:1px solid #e5e7eb;border-left:4px solid ${GREEN};border-radius:8px;padding:16px 20px;margin:16px 0;background:#f9fafb">
    <p style="margin:0;font-weight:700;color:#111827;font-size:17px">${e(artist)}</p>
    ${venue ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px">${e(venue)}</p>` : ''}
    ${date ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px">${e(date)}</p>` : ''}
  </div>`;
}

const strong = (s) => `<strong style="color:#111827">${e(s)}</strong>`;

// ── Invite ───────────────────────────────────────────────────────────
function inviteEmail({ inviterName, inviteUrl }) {
  return {
    subject: subjectText(`${inviterName} invited you to MySetlists!`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">You're invited!</h2>
    <p style="margin:0 0 12px">${strong(inviterName)} has been tracking all their concerts on MySetlists — saving setlists, rating songs, and seeing their all-time stats. They think you'd love it too.</p>
    <p style="margin:0 0 4px">Here's what you can do:</p>
    <ul style="color:#4b5563;padding-left:20px;margin:8px 0 16px">
      <li>Log every show you've ever been to</li>
      <li>Scan a ticket stub to import a show automatically</li>
      <li>See stats like total shows, top artists, and top venues</li>
      <li>Share shows with friends and compare concert histories</li>
    </ul>
    ${button('Join MySetlists &rarr;', inviteUrl)}
    <p style="color:#6b7280;font-size:13px;text-align:center;margin:0">When you sign up, you and ${e(inviterName)} will automatically be friends on the app.</p>
  `),
  };
}

// ── Friend joined (to the inviter) ───────────────────────────────────
function friendJoinedEmail({ newUserName }) {
  return {
    subject: subjectText(`${newUserName} joined MySetlists via your invite!`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Your invite worked!</h2>
    <p style="margin:0 0 16px">${strong(newUserName)} just joined MySetlists via your invite link — you're now friends on the app!</p>
    <p style="margin:0 0 16px">Head over to MySetlists to check out their profile and see which shows you've both been to.</p>
    ${button('Go to MySetlists &rarr;', APP_URL)}
  `),
  };
}

// ── Tag by email (to someone without an account) ─────────────────────
function tagByEmailNotification({ taggerName, artist, venue, date, personalMessage, signupUrl }) {
  return {
    subject: subjectText(`${taggerName} tagged you in a show on MySetlists!`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">${e(taggerName)} tagged you in a show!</h2>
    <p style="margin:0 0 8px">${strong(taggerName)} tagged you in a show you attended together:</p>
    ${showCard(artist, venue, date)}
    ${personalMessage ? `<blockquote style="border-left:3px solid ${ORANGE};padding:12px 16px;color:#4b5563;font-style:italic;margin:16px 0;background:#fff7ed;border-radius:0 8px 8px 0">"${e(personalMessage)}"</blockquote>` : ''}
    <p style="margin:0 0 4px">Join MySetlists to confirm the show and start tracking your concert history:</p>
    ${button('Join MySetlists &rarr;', signupUrl)}
  `),
  };
}

// ── Tag (to a member) ────────────────────────────────────────────────
// `upcoming` (5.43.0): "going to", not "attended". One template with a
// branch, so the 'tag' unsubscribe source covers both.
function showTagNotification({ taggerName, artist, venue, date, upcoming = false }) {
  return {
    subject: subjectText(upcoming
      ? `${taggerName} tagged you as going to ${artist} on MySetlists!`
      : `${taggerName} tagged you in a show on MySetlists!`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">${upcoming ? `${e(taggerName)} says you’re going!` : `${e(taggerName)} tagged you in a show!`}</h2>
    <p style="margin:0 0 8px">${strong(taggerName)} ${upcoming ? 'tagged you as going to an upcoming show together:' : 'tagged you in a show you attended together:'}</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 16px">Open MySetlists to confirm or dismiss this tag.</p>
    ${button('Open MySetlists &rarr;', `${APP_URL}/friends?tab=requests`)}
  `),
  };
}

// ── Tag accepted (to the tagger) ─────────────────────────────────────
function tagAcceptedEmail({ confirmerName, artist, venue, date }) {
  return {
    subject: subjectText(`${confirmerName} confirmed they were at ${artist} with you!`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">They were there!</h2>
    <p style="margin:0 0 8px">${strong(confirmerName)} just confirmed they were at this show with you:</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 16px">The show has been added to their setlist history on MySetlists.</p>
    ${button('View on MySetlists &rarr;', `${APP_URL}/friends`)}
  `),
  };
}

// ── Show suggestion nudge ────────────────────────────────────────────
function suggestionNudgeEmail({ fromName, artist, venue, date }) {
  return {
    subject: subjectText(`${fromName} thinks you were both at ${artist}!`),
    html: wrap(`
    <h2 style="color:${ORANGE};margin:0 0 16px;font-size:22px">Were you there?</h2>
    <p style="margin:0 0 8px">${strong(fromName)} confirmed they were at this show and thinks you might have been there too:</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 4px">Were you there together? Head to MySetlists to confirm or dismiss:</p>
    ${button('Check it out &rarr;', `${APP_URL}/friends`)}
  `),
  };
}

// ── Engagement (reply / like / mention / meetup) ─────────────────────
// `message` is the notification's own text ("Alice replied to your
// comment on Goose"), escaped like everything else.
function engagementNotificationEmail({ fromName, message, artist, venue, date }) {
  return {
    subject: subjectText(`${fromName} — activity on MySetlists`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Someone's talking about your show</h2>
    <p style="margin:0 0 8px">${e(message)}</p>
    ${artist ? showCard(artist, venue, date) : ''}
    ${button('Open MySetlists &rarr;', `${APP_URL}/notifications`)}
  `),
  };
}

// ── Venue verification ───────────────────────────────────────────────
function venueVerificationSubmittedEmail({ venueName }) {
  return {
    subject: subjectText(`Verification application received — ${venueName}`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Application received</h2>
    <p style="margin:0 0 12px">Thanks for applying to verify ${strong(venueName)} on MySetlists. Our team will review your submitted documents and get back to you within a few days.</p>
    <p style="margin:0;color:#6b7280;font-size:14px">You'll receive another email as soon as a decision is made.</p>
  `),
  };
}

function venueVerificationApprovedEmail({ venueName, venueKey }) {
  return {
    subject: subjectText(`${venueName} is now verified on MySetlists`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">You're verified! ✔</h2>
    <p style="margin:0 0 12px">${strong(venueName)} now shows a verification badge across MySetlists. You can manage venue info, upload official photos, and post announcements from your venue dashboard.</p>
    ${button('Open Venue Dashboard &rarr;', `${APP_URL}${venueDashboardHref(venueKey)}`)}
  `),
  };
}

function venueVerificationRejectedEmail({ venueName, rejectionReason }) {
  return {
    subject: subjectText(`Update on your ${venueName} verification application`),
    html: wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Application not approved</h2>
    <p style="margin:0 0 12px">We weren't able to verify ${strong(venueName)} at this time.</p>
    ${rejectionReason ? `<p style="margin:0 0 12px;color:#4b5563"><strong>Reason:</strong> ${e(rejectionReason)}</p>` : ''}
    <p style="margin:0;color:#6b7280;font-size:14px">You're welcome to reapply once you're able to provide clearer proof of ownership or management.</p>
  `),
  };
}

// ── Admin one-off message ────────────────────────────────────────────
// Plain text from the admin's form: escaped, line breaks kept.
function adminMessageEmail({ subject, body }) {
  return {
    subject: subjectText(subject),
    html: wrap(`<div style="margin:0">${e(body).replace(/\r?\n/g, '<br />')}</div>`),
  };
}

module.exports = {
  formatShowDate,
  inviteEmail,
  friendJoinedEmail,
  tagByEmailNotification,
  showTagNotification,
  tagAcceptedEmail,
  suggestionNudgeEmail,
  engagementNotificationEmail,
  venueVerificationSubmittedEmail,
  venueVerificationApprovedEmail,
  venueVerificationRejectedEmail,
  adminMessageEmail,
};
