/**
 * emailLayout — the one email wrapper, shared by the browser templates
 * (lib/emailTemplates.js imports it) and the Netlify functions.
 *
 * CommonJS so functions can require it; webpack happily imports CommonJS
 * into the app, so unlike contentFilterRule.js this needs no mirrored
 * copy and no parity test.
 *
 * THE FOOTER IS NEVER BUILT IN THE BROWSER. An unsubscribe link carries a
 * signed token, and the signing secret only exists server-side. So
 * wrapEmail() leaves a marker where the unsubscribe footer goes, and the
 * server replaces it (injectUnsubscribeFooter) with the recipient's own
 * signed link just before handing the email to Resend. HTML without the
 * marker (a function's own hand-built email, an admin's pasted HTML) gets
 * the footer appended instead — no email leaves without one.
 */

const LOGO_URL = 'https://mysetlists.net/logo.svg';
const APP_URL = 'https://mysetlists.net';
const ORANGE = '#FB923C';

const FOOTER_MARKER = '<!--MYSETLISTS_UNSUBSCRIBE_FOOTER-->';

const UNSUBSCRIBE_LABELS = {
  all: 'Unsubscribe from all MySetlists emails',
  announcements: 'Unsubscribe from announcements',
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Opt-in dark mode (5.55.0, first used by the welcome email). Inline
// styles beat a <style> block, so the overrides are !important and keyed
// on classes the wrapper always carries. iPhone Mail and Apple Mail honor
// prefers-color-scheme; Gmail's apps ignore it and recolor the light
// version themselves, which is why the light colors stay the default
// rather than the dark ones. The logo row keeps its white background in
// both: logo.svg is dark text on transparent.
const DARK_MODE_HEAD = `
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ms-bg { background:#111827 !important; }
    .ms-card { background:#1f2937 !important; border-color:#374151 !important; }
    .ms-body { color:#d1d5db !important; }
    .ms-body h1, .ms-body h2, .ms-body h3, .ms-body strong { color:#f9fafb !important; }
    .ms-muted { color:#9ca3af !important; }
    .ms-panel { background:#111827 !important; border-color:#374151 !important; }
    .ms-link { color:#34D399 !important; border-color:#34D399 !important; }
    .ms-footer { background:#111827 !important; border-color:#374151 !important; }
  }
</style>`;

/**
 * wrapEmail(content, { darkMode, preheader })
 *   darkMode  — add the prefers-color-scheme overrides above
 *   preheader — the inbox preview line, hidden in the message itself
 */
function wrapEmail(content, { darkMode = false, preheader = '' } = {}) {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f3f4f6;opacity:0">${escapeHtml(preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>`
    : '';
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${darkMode ? DARK_MODE_HEAD : ''}</head>
<body class="ms-bg" style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  ${pre}
  <table role="presentation" class="ms-bg" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" class="ms-card" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <!-- Header with logo -->
        <tr><td style="padding:24px 32px 16px;text-align:center;border-bottom:1px solid #e5e7eb;background:#ffffff">
          <img src="${LOGO_URL}" alt="MySetlists" width="160" style="display:inline-block;max-width:160px;height:auto;color:#111827;font-size:20px;font-weight:700" />
        </td></tr>
        <!-- Body -->
        <tr><td class="ms-body" style="padding:28px 32px;color:#374151;font-size:15px;line-height:1.6">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td class="ms-footer" style="padding:16px 32px 24px;text-align:center;border-top:1px solid #e5e7eb;background:#f9fafb">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            <a href="${APP_URL}" style="color:#9ca3af;text-decoration:none">my<span style="color:${ORANGE}">setlists</span>.net</a> &mdash; track all your shows
          </p>
          ${FOOTER_MARKER}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * The unsubscribe block: the link, and for announcements the physical
 * mailing address CAN-SPAM requires.
 */
function unsubscribeFooterHtml({ url, scope = 'all', mailingAddress = '' }) {
  const label = UNSUBSCRIBE_LABELS[scope] || UNSUBSCRIBE_LABELS.all;
  const address = mailingAddress
    ? `<p style="color:#9ca3af;font-size:11px;margin:8px 0 0;line-height:1.5">MySetlists &middot; ${escapeHtml(mailingAddress).replace(/\r?\n/g, ', ')}</p>`
    : '';
  return `<p style="font-size:12px;margin:8px 0 0">
            <a href="${escapeHtml(url)}" style="color:#9ca3af;text-decoration:underline">${label}</a>
          </p>${address}`;
}

function injectUnsubscribeFooter(html, opts) {
  const footer = unsubscribeFooterHtml(opts);
  const src = String(html || '');
  if (src.includes(FOOTER_MARKER)) return src.split(FOOTER_MARKER).join(footer);
  const block = `<div style="text-align:center;padding:16px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${footer}</div>`;
  const i = src.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? src + block : src.slice(0, i) + block + src.slice(i);
}

/** An announcement body is a fragment unless it brings its own document. */
function wrapAnnouncement(html) {
  return /<html[\s>]/i.test(String(html || '')) ? String(html) : wrapEmail(html);
}

module.exports = {
  wrapEmail, wrapAnnouncement, unsubscribeFooterHtml, injectUnsubscribeFooter,
  escapeHtml, FOOTER_MARKER, UNSUBSCRIBE_LABELS,
};
