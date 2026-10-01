/**
 * Email templates for MySetlists notifications.
 * Light, professional design with MySetlists branding.
 *
 * Brand colors:
 *   Green  #34D399 — primary buttons, highlights
 *   Orange #FB923C — "setlists" accent, secondary highlights
 *
 * Templates are pure functions that return { subject, html } objects.
 */

import { wrapEmail } from '@/netlify/functions/lib/emailLayout';

const APP_URL = 'https://mysetlists.net';
const GREEN = '#34D399';
const GREEN_DARK = '#059669'; // darker green for button text contrast
const ORANGE = '#FB923C';

// ── Shared layout wrapper ────────────────────────────────────────────
// The wrapper lives in netlify/functions/lib/emailLayout.js so the server
// uses the same one. It leaves a marker where the unsubscribe footer goes;
// /api/send-email swaps in the recipient's own signed link. Tokens are
// never computed here — the signing secret only exists on the server.
function wrap(content) {
  return wrapEmail(content);
}

function button(text, url) {
  return `
  <p style="margin:24px 0;text-align:center">
    <a href="${url}" style="background:${GREEN};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:15px">
      ${text}
    </a>
  </p>`;
}

function showCard(artist, venue, date) {
  return `
  <div style="border:1px solid #e5e7eb;border-left:4px solid ${GREEN};border-radius:8px;padding:16px 20px;margin:16px 0;background:#f9fafb">
    <p style="margin:0;font-weight:700;color:#111827;font-size:17px">${artist}</p>
    ${venue ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px">${venue}</p>` : ''}
    ${date ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px">${date}</p>` : ''}
  </div>`;
}

// ── Template: Invite Email ───────────────────────────────────────────
// Sent when a user invites a friend to join MySetlists
export function inviteEmail({ inviterName, inviteUrl }) {
  const subject = `${inviterName} invited you to MySetlists!`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">You're invited!</h2>
    <p style="margin:0 0 12px"><strong style="color:#111827">${inviterName}</strong> has been tracking all their concerts on MySetlists — saving setlists, rating songs, and seeing their all-time stats. They think you'd love it too.</p>
    <p style="margin:0 0 4px">Here's what you can do:</p>
    <ul style="color:#4b5563;padding-left:20px;margin:8px 0 16px">
      <li>Log every show you've ever been to</li>
      <li>Scan a ticket stub to import a show automatically</li>
      <li>See stats like total shows, top artists, and top venues</li>
      <li>Share shows with friends and compare concert histories</li>
    </ul>
    ${button('Join MySetlists &rarr;', inviteUrl)}
    <p style="color:#6b7280;font-size:13px;text-align:center;margin:0">When you sign up, you and ${inviterName} will automatically be friends on the app.</p>
  `);
  return { subject, html };
}

// ── Template: Friend Joined ──────────────────────────────────────────
// Sent to the inviter when their friend signs up
export function friendJoinedEmail({ inviterName, newUserName }) {
  const subject = `${newUserName} joined MySetlists via your invite!`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Your invite worked!</h2>
    <p style="margin:0 0 16px"><strong style="color:#111827">${newUserName}</strong> just joined MySetlists via your invite link — you're now friends on the app!</p>
    <p style="margin:0 0 16px">Head over to MySetlists to check out their profile and see which shows you've both been to.</p>
    ${button('Go to MySetlists &rarr;', APP_URL)}
  `);
  return { subject, html };
}

// ── Template: Tag Notification (email invite) ────────────────────────
// Sent to a non-registered user when they're tagged in a show
export function tagByEmailNotification({ taggerName, artist, venue, date, personalMessage, signupUrl }) {
  const subject = `${taggerName} tagged you in a show on MySetlists!`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">${taggerName} tagged you in a show!</h2>
    <p style="margin:0 0 8px"><strong style="color:#111827">${taggerName}</strong> tagged you in a show you attended together:</p>
    ${showCard(artist, venue, date)}
    ${personalMessage ? `<blockquote style="border-left:3px solid ${ORANGE};padding:12px 16px;color:#4b5563;font-style:italic;margin:16px 0;background:#fff7ed;border-radius:0 8px 8px 0">"${personalMessage}"</blockquote>` : ''}
    <p style="margin:0 0 4px">Join MySetlists to confirm the show and start tracking your concert history:</p>
    ${button('Join MySetlists &rarr;', signupUrl)}
  `);
  return { subject, html };
}

// ── Template: Tag Notification (existing user, single show) ─────────
// Sent to an existing user when a friend tags them in a show
export function showTagNotification({ taggerName, artist, venue, date }) {
  const subject = `${taggerName} tagged you in a show on MySetlists!`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">${taggerName} tagged you in a show!</h2>
    <p style="margin:0 0 8px"><strong style="color:#111827">${taggerName}</strong> tagged you in a show you attended together:</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 16px">Open MySetlists to confirm or dismiss this tag.</p>
    ${button('Open MySetlists &rarr;', `${APP_URL}/friends?tab=requests`)}
  `);
  return { subject, html };
}

// ── Template: Tag Accepted / Confirmed ───────────────────────────────
// Sent to the tagger when their friend confirms a shared show
export function tagAcceptedEmail({ confirmerName, artist, venue, date }) {
  const subject = `${confirmerName} confirmed they were at ${artist} with you!`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">They were there!</h2>
    <p style="margin:0 0 8px"><strong style="color:#111827">${confirmerName}</strong> just confirmed they were at this show with you:</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 16px">The show has been added to their setlist history on MySetlists.</p>
    ${button('View on MySetlists &rarr;', `${APP_URL}/friends`)}
  `);
  return { subject, html };
}

// ── Template: Show Suggestion Nudge ──────────────────────────────────
// Sent when one friend confirms a suggestion and the other hasn't responded
export function suggestionNudgeEmail({ fromName, friendName, artist, venue, date }) {
  const subject = `${fromName} thinks you were both at ${artist}!`;
  const html = wrap(`
    <h2 style="color:${ORANGE};margin:0 0 16px;font-size:22px">Were you there?</h2>
    <p style="margin:0 0 8px"><strong style="color:#111827">${fromName}</strong> confirmed they were at this show and thinks you might have been there too:</p>
    ${showCard(artist, venue, date)}
    <p style="margin:0 0 4px">Were you there together? Head to MySetlists to confirm or dismiss:</p>
    ${button('Check it out &rarr;', `${APP_URL}/friends`)}
  `);
  return { subject, html };
}

// ── Template: Engagement notification (reply/like/mention) ──────────
// Sent immediately when a user has opted into "immediate" email
// notifications (see lib/notifications.js's createEngagementNotification
// and the emailFrequency preference on Profile) — one shared template
// for comment_reply/comment_like/comment_mention/photo_like, since the
// only thing that differs is the message text already built at the
// notification's write site.
export function engagementNotificationEmail({ fromName, message, artist, venue, date }) {
  const subject = `${fromName} — activity on MySetlists`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Someone's talking about your show</h2>
    <p style="margin:0 0 8px">${message}</p>
    ${artist ? showCard(artist, venue, date) : ''}
    ${button('Open MySetlists &rarr;', `${APP_URL}/notifications`)}
  `);
  return { subject, html };
}

// ── Templates: Venue verification workflow ───────────────────────────
export function venueVerificationSubmittedEmail({ venueName }) {
  const subject = `Verification application received — ${venueName}`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Application received</h2>
    <p style="margin:0 0 12px">Thanks for applying to verify <strong style="color:#111827">${venueName}</strong> on MySetlists. Our team will review your submitted documents and get back to you within a few days.</p>
    <p style="margin:0;color:#6b7280;font-size:14px">You'll receive another email as soon as a decision is made.</p>
  `);
  return { subject, html };
}

export function venueVerificationApprovedEmail({ venueName, venueKey }) {
  const subject = `${venueName} is now verified on MySetlists`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">You're verified! ✔</h2>
    <p style="margin:0 0 12px"><strong style="color:#111827">${venueName}</strong> now shows a verification badge across MySetlists. You can manage venue info, upload official photos, and post announcements from your venue dashboard.</p>
    ${button('Open Venue Dashboard &rarr;', `${APP_URL}/venue-dashboard/${encodeURIComponent(venueKey)}`)}
  `);
  return { subject, html };
}

export function venueVerificationRejectedEmail({ venueName, rejectionReason }) {
  const subject = `Update on your ${venueName} verification application`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Application not approved</h2>
    <p style="margin:0 0 12px">We weren't able to verify <strong style="color:#111827">${venueName}</strong> at this time.</p>
    ${rejectionReason ? `<p style="margin:0 0 12px;color:#4b5563"><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
    <p style="margin:0;color:#6b7280;font-size:14px">You're welcome to reapply once you're able to provide clearer proof of ownership or management.</p>
  `);
  return { subject, html };
}

// ── Template: Year in Review is ready ────────────────────────────────
export function yearInReviewReadyEmail({ year, userId }) {
  const subject = `Your ${year} Year in Concerts is ready 🎵`;
  const html = wrap(`
    <h2 style="color:${GREEN_DARK};margin:0 0 16px;font-size:22px">Your ${year} in Concerts</h2>
    <p style="margin:0 0 12px">Your personalized year-in-review is ready — top artists, favorite venue, milestones, and more.</p>
    ${button('See Your Year in Review &rarr;', `${APP_URL}/year-in-review/${userId}/${year}`)}
  `);
  return { subject, html };
}
