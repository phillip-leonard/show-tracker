/**
 * welcomeEmailTemplate — the welcome email's subject, preheader and HTML
 * (5.55.0). Only depends on emailLayout.js, so the browser can import it
 * too (lib/emailTemplates.js re-exports it); who gets it and when is
 * welcomeEmail.js.
 *
 * Copy follows the app's real labels. If a button below is renamed in the
 * app, rename it here: tests/email/welcomeEmail.test.js checks each
 * label against the component that renders it.
 */

const { wrapEmail, escapeHtml } = require('./emailLayout');

const APP_URL = 'https://mysetlists.net';
const GREEN = '#34D399';
const GREEN_DARK = '#059669';

// No emoji or icons anywhere in this email (5.59.4): subject, headings and
// body are plain text, and the logo in the wrapper is the only image.
// tests/email/welcomeEmail.test.js checks every rendered variant.
const SUBJECT = 'Your first show is in. Here’s what else MySetlists can do';
const PREHEADER = 'Scan tickets, import your ticket history, add photos, tag friends, and more.';

// Real routes only: every one of these is a pre-rendered page in out/
// and listed in public/.well-known/apple-app-site-association, so it
// opens the iOS app where universal links are honored (see CLAUDE.md's
// routing section). The show link is lib/showRouting.js's showHref().
const LINKS = {
  scan: `${APP_URL}/scan-import/`,
  importHistory: `${APP_URL}/scan-import/?import=1`,
  shows: `${APP_URL}/shows/`,
  tours: `${APP_URL}/tours/`,
  festivals: `${APP_URL}/festivals/`,
};
const showLink = (id) => (id ? `${APP_URL}/shows/?show=${encodeURIComponent(id)}` : LINKS.shows);

// The band line's link (5.59.4): the band screen, /bands/?band=<slug>, not
// the public /artist/<slug>/ page. /bands/* is a universal link, so on an
// iPhone with the app it opens the band in the app; on the web a signed-in
// reader gets the same page with their own shows on it, and a signed-out
// one is sent on to /artist/<slug>/ (app/AppProviderWrapper.jsx,
// lib/bandScreens.js publicBandUrl). /artist/* is not in the AASA file,
// so a link there would always leave the app for Safari.
const bandLink = (slug) => `${APP_URL}/bands/?band=${encodeURIComponent(slug)}`;

// ── Template ─────────────────────────────────────────────────────────

function linkButton(text, url) {
  return `<a href="${escapeHtml(url)}" class="ms-link" style="display:inline-block;margin:4px 8px 0 0;padding:9px 16px;border:1.5px solid ${GREEN_DARK};border-radius:8px;color:${GREEN_DARK};font-weight:600;font-size:14px;text-decoration:none">${text}&nbsp;&rarr;</a>`;
}

function section(heading, body, buttons) {
  return `
    <div class="ms-panel" style="border:1px solid #e5e7eb;border-left:4px solid ${GREEN};border-radius:8px;padding:16px 18px;margin:0 0 14px;background:#f9fafb">
      <h3 style="margin:0 0 6px;font-size:16px;line-height:1.35;color:#111827">${heading}</h3>
      ${body}
      <div style="margin-top:8px">${buttons}</div>
    </div>`;
}

const p = (html) => `<p style="margin:0 0 6px">${html}</p>`;
const ui = (label) => `<strong style="color:#111827">${label}</strong>`;

/**
 * The "Want more {band}?" line, or '' without a band page. `bandPage` is
 * welcomeEmail.js's bandPageFor() result: { name, slug }, a band with a
 * published snapshot.
 */
function bandLine(bandPage) {
  const slug = String(bandPage?.slug || '').trim();
  const name = String(bandPage?.name || '').trim();
  if (!slug || !name || !/^[a-z0-9-]+$/.test(slug)) return '';
  const band = escapeHtml(name);
  return `<p style="margin:0 0 20px">Want more ${band}? See their most-played songs, gaps and recent setlists on the <a href="${escapeHtml(bandLink(slug))}" class="ms-link" style="color:${GREEN_DARK};font-weight:600;text-decoration:underline">${band} band page&nbsp;&rarr;</a></p>`;
}

/**
 * welcomeEmail({ firstName, artist, venue, showId, bandPage }) → { subject, html, preheader }
 * Every field optional; missing ones fall back to generic copy, and no
 * bandPage means no band line.
 */
function welcomeEmail({ firstName, artist, venue, showId, bandPage = null } = {}) {
  const name = String(firstName || '').trim();
  const band = String(artist || '').trim();
  const place = String(venue || '').trim();

  const greeting = name ? `Hey ${escapeHtml(name)},` : 'Hey there,';
  let logged;
  if (band && place) logged = `You just logged ${ui(escapeHtml(band))} at ${ui(escapeHtml(place))}. Nice.`;
  else if (band) logged = `You just logged ${ui(escapeHtml(band))}. Nice.`;
  else logged = 'Your first show is in. Nice.';

  const yourShow = showLink(showId);

  const html = wrapEmail(`
    <p style="margin:0 0 12px;font-size:16px">${greeting}</p>
    <p style="margin:0 0 20px">${logged} Here are a few ways to get the rest of your show history in fast and make it more fun.</p>
    ${bandLine(bandPage)}

    ${section('Scan a ticket stub',
      p(`On My Shows, tap ${ui('Scan / Import')}, then ${ui('Select Images')} (in the iPhone app, ${ui('Take Photo')} or ${ui('Choose from Library')}) and add a photo of a stub or a digital ticket.`)
      + p('We’ll read the band, venue and date and find the setlist for you to add.'),
      linkButton('Scan a ticket', LINKS.scan))}

    ${section('Import your ticket history',
      p('Open your past events or order history on any ticket site or app (Ticketmaster, AXS, SeatGeek, Eventbrite, DICE, and others) and screenshot the list.')
      + p(`Then go to ${ui('Scan / Import')} &rarr; ${ui('Import File')} &rarr; ${ui('Choose a file')} and upload it. We’ll match every show on it. Got more? Upload the next screenshot when that one’s in.`),
      linkButton('Import your ticket history', LINKS.importHistory))}

    ${section('Add photos to a show',
      p(`Open any show and tap ${ui('Add Photos')} under Photos &amp; Videos. Everyone who logged the same show sees them, and you’ll see theirs.`),
      linkButton(showId ? 'Add photos to your show' : 'Go to my shows', yourShow))}

    ${section('Tag friends who were there',
      p(`On a show, tap ${ui('Tag friends')} and pick a friend. Not on MySetlists yet? Type their name and enter their email to invite them.`)
      + p('Once they accept, the show is in their shows too, and you’re both listed under Friends Who Were There.'),
      linkButton('Tag a friend', yourShow))}

    ${section('Tours and Festivals',
      p(`${ui('Tours')} groups your shows by tour, so you can see every stop you caught and the songs you heard for the first time on that run.`)
      + p(`${ui('Festivals')} collects your festival weekends in one place. Tap ${ui('New festival')}, then ${ui('Search the lineup')} to add every set you saw in one go. Both are in the menu.`),
      linkButton('Explore Tours', LINKS.tours) + linkButton('Explore Festivals', LINKS.festivals))}

    <p style="margin:22px 0 4px">Questions or ideas? Just reply to this email. It comes straight to me.</p>
    <p style="margin:12px 0 0">Phillip<br><span class="ms-muted" style="color:#6b7280">MySetlists</span></p>
  `, { darkMode: true, preheader: PREHEADER });

  return { subject: SUBJECT, html, preheader: PREHEADER };
}

// Sample data for the admin's preview and test send, one per variant: a
// band with a page (Goose), and a band without one, so no band line.
const SAMPLE = { firstName: 'Phillip', artist: 'Goose', venue: 'Red Rocks Amphitheatre', showId: null, bandPage: { name: 'Goose', slug: 'goose' } };
const SAMPLE_NO_BAND_PAGE = { firstName: 'Phillip', artist: 'Khruangbin', venue: 'Red Rocks Amphitheatre', showId: null, bandPage: null };
const SAMPLES = { band_page: SAMPLE, no_band_page: SAMPLE_NO_BAND_PAGE };

module.exports = { welcomeEmail, SUBJECT, PREHEADER, LINKS, SAMPLE, SAMPLE_NO_BAND_PAGE, SAMPLES, showLink, bandLink };
