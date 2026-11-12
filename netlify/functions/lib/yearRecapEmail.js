/**
 * yearRecapEmail — the two Year in Review emails, and who gets them.
 *
 *   ready   "Your 2026 in live music is ready"      (send Dec 2)
 *   final   "Your final 2026 recap, NYE included"   (send Jan 2)
 *
 * They go out through Admin → Announcements (admin-send-announcement.js,
 * audience 'recap-2026'), so they get everything an announcement gets:
 * opt-outs re-checked per batch, the signed unsubscribe link and
 * List-Unsubscribe headers, the mailing address, never-twice resumable
 * sending. What the audience adds:
 *   - only accounts with at least one show in the recap year
 *   - no extra addresses (people without accounts have no recap)
 *   - the subject and body are always these templates, built here on the
 *     server, never whatever the browser sent
 *   - a real send is refused unless YEAR_RECAP_EMAILS_ENABLED is "true" in
 *     the Netlify environment. A test send to the admin always works.
 *   - each email sends once (recapAnnouncementId below). Pressing Send on
 *     "ready" a second time is refused, not a second email to everyone.
 * Nothing sends on deploy: a send only ever starts from the admin tab.
 *
 * The category is 'announcement', so both opt-outs apply: "no email at
 * all" and "no announcements".
 *
 * Plain CommonJS with no Node APIs, so the admin tab can import the same
 * templates to preview them.
 */

const RECAP_YEAR = 2026;
const RECAP_AUDIENCE = 'recap-2026';
const SITE = 'https://mysetlists.net';
const GREEN = '#34D399';
const ORANGE = '#FB923C';

const recapUrl = (year) => `${SITE}/year-in-review/?year=${year}`;

function button(text, url) {
  return `
  <p style="margin:24px 0;text-align:center">
    <a href="${url}" style="background:${GREEN};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:15px">${text}</a>
  </p>`;
}

const TEMPLATES = {
  ready: (year) => ({
    subject: `Your ${year} in live music is ready`,
    html: `
    <p style="margin:0 0 6px;color:${GREEN};font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:12px">Year in Review</p>
    <h2 style="margin:0 0 16px;font-size:24px;color:#111827">Your <span style="color:${ORANGE}">${year}</span> in live music</h2>
    <p style="margin:0 0 12px">Your ${year} recap is ready: your top bands, the songs you heard most, your rarest catch and your show buddy, plus a card sized for stories and the feed.</p>
    <p style="margin:0 0 12px">It keeps updating through New Year's Eve, so log the shows you've still got coming and they'll count.</p>
    ${button(`See your ${year} recap &rarr;`, recapUrl(year))}
    <p style="margin:0;color:#6b7280;font-size:14px">Missing a show? Add it from the recap and every number updates.</p>`,
  }),
  final: (year) => ({
    subject: `Your final ${year} recap, NYE included`,
    html: `
    <p style="margin:0 0 6px;color:${GREEN};font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:12px">Year in Review</p>
    <h2 style="margin:0 0 16px;font-size:24px;color:#111827">Your final <span style="color:${ORANGE}">${year}</span> recap</h2>
    <p style="margin:0 0 12px">New Year's Eve is in the books. Your ${year} recap now counts every show you logged through December 31: top bands, top songs, rarest catch and all.</p>
    <p style="margin:0 0 12px">Make your recap card and share it before ${year + 1} gets going.</p>
    ${button(`See your final ${year} recap &rarr;`, recapUrl(year))}
    <p style="margin:0;color:#6b7280;font-size:14px">Went to one you haven't logged yet? Add it and your recap updates.</p>`,
  }),
};

/** { subject, html } (html is a body fragment) for 'ready' | 'final', or null. */
function recapEmail(template, year = RECAP_YEAR) {
  const t = TEMPLATES[template];
  return t ? t(year) : null;
}

/** The year a stored show date is in: YYYY-MM-DD or DD-MM-YYYY (lib/utils.js parseDate). */
function showYearOf(date) {
  const s = String(date || '');
  let m = s.match(/^(\d{4})-\d{2}-\d{2}/);
  if (m) return Number(m[1]);
  m = s.match(/^\d{2}-\d{2}-(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/**
 * Account ids with at least one show in `year`, from users/{uid}/shows/*
 * documents ([{ path, date }]). Pure, for the tests.
 */
function uidsWithShowsIn(showDocs, year) {
  const uids = new Set();
  for (const d of showDocs || []) {
    const parts = String(d.path || '').split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'shows') continue;
    if (showYearOf(d.date) === year) uids.add(parts[1]);
  }
  return uids;
}

/** Reads every show's date (one collection-group pass) and resolves uidsWithShowsIn. */
async function loadUidsWithShowsIn(db, year = RECAP_YEAR) {
  const snap = await db.collectionGroup('shows').select('date').get();
  return uidsWithShowsIn(snap.docs.map((d) => ({ path: d.ref.path, date: (d.data() || {}).date })), year);
}

/**
 * The announcement document a recap email is sent under:
 * announcements/recap2026ready, announcements/recap2026final. A fixed id,
 * created with create(), is what makes each email send once: a second
 * Send finds the document there and is refused (admin-send-announcement.js),
 * even from two tabs at the same moment. A send cut short is carried on
 * with Resume, which reuses the same document. Letters and digits only, the
 * shape Resume accepts.
 */
function recapAnnouncementId(template, year = RECAP_YEAR) {
  return `recap${year}${template}`;
}

const recapEmailsEnabled = () => String(process.env.YEAR_RECAP_EMAILS_ENABLED || '').trim() === 'true';

module.exports = {
  RECAP_YEAR,
  RECAP_AUDIENCE,
  recapEmail,
  recapUrl,
  recapAnnouncementId,
  showYearOf,
  uidsWithShowsIn,
  loadUidsWithShowsIn,
  recapEmailsEnabled,
};
