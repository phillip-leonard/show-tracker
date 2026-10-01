// netlify/functions/lib/publicPageHtml.js
//
// Shared HTML-shell helpers for the public, indexable pages (profile, show,
// shared collection). Not a function itself (no exports.handler) — a plain
// module required by the actual function files, same as any other shared
// lib in this repo.
//
// These pages are server-rendered documents, not app screens: plain HTML +
// inline CSS, no React bundle, no client JS beyond a "View full profile on
// MySetlists" link back into the app.

const SITE_URL = 'https://mysetlists.net';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonForScript(obj) {
  // Prevents a </script> inside content from breaking out of the JSON-LD
  // script tag.
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const BASE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    background: #1f1f3a; color: #f4f3fb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  a { color: #f5c451; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  .brand { font-weight: 800; font-size: 15px; color: #f5c451; margin-bottom: 24px; display: block; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #b7b6c9; font-size: 14px; margin: 0 0 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin-bottom: 28px; }
  .stat { background: rgba(255,255,255,0.05); border-radius: 12px; padding: 14px; }
  .stat .n { font-size: 22px; font-weight: 800; }
  .stat .l { font-size: 11px; color: #b7b6c9; text-transform: uppercase; letter-spacing: 0.06em; }
  .show { display: block; padding: 14px 16px; border-radius: 12px; background: rgba(255,255,255,0.04); margin-bottom: 8px; }
  .show .artist { font-weight: 700; }
  .show .meta { font-size: 13px; color: #b7b6c9; margin-top: 2px; }
  .setlist { list-style: none; padding: 0; margin: 16px 0 0; }
  .setlist li { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px; display: flex; justify-content: space-between; gap: 12px; }
  .cta { margin-top: 32px; padding: 20px; border-radius: 16px; background: rgba(245,196,81,0.1); text-align: center; }
  .footer { margin-top: 40px; font-size: 12px; color: #7d7c94; text-align: center; }
  .footer a { color: #7d7c94; }
`;

function page({ title, description, canonicalPath, jsonLd, bodyHtml, ogImage }) {
  const canonical = `${SITE_URL}${canonicalPath}`;
  const desc = escapeHtml(description || '');
  const img = ogImage || `${SITE_URL}/og-image.svg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${escapeHtml(img)}">
${jsonLd ? `<script type="application/ld+json">${escapeJsonForScript(jsonLd)}</script>` : ''}
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
<a class="brand" href="${SITE_URL}/">mysetlists</a>
${bodyHtml}
<div class="footer">
  <a href="${SITE_URL}/privacy/">Privacy</a> · <a href="${SITE_URL}/terms/">Terms</a> · <a href="mailto:contact@mysetlists.net?subject=Report a page">Report this page</a>
</div>
</div>
</body>
</html>`;
}

function notFoundPage(message) {
  return page({
    title: 'Page not found — MySetlists',
    description: message,
    canonicalPath: '/',
    bodyHtml: `<h1>Not found</h1><p class="sub">${escapeHtml(message)}</p><div class="cta"><a href="${SITE_URL}/">Go to MySetlists</a></div>`,
  });
}

// Short CDN cache so an owner turning their profile private takes effect
// within about a minute rather than instantly — this repo has no Netlify
// API token wired up for a real on-demand purge.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=60' };

// Show dates aren't stored in one format: most add paths save YYYY-MM-DD,
// but ticket-scanner shows carry setlist.fm's DD-MM-YYYY verbatim (see
// toIsoDate in lib/utils.js, which this mirrors — that file is an ES
// module and these functions are CommonJS). Returns '' for anything else,
// so callers can fall back to the raw string. Never goes through
// new Date(string), so the date can't shift by a timezone.
function isoDate(dateStr) {
  const s = String(dateStr || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// "Sep 14, 2024" (month: 'short') or "September 14, 2024" (month: 'long').
function formatShowDate(dateStr, month = 'short') {
  const iso = isoDate(dateStr);
  if (!iso) return dateStr || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric' });
}

module.exports = { SITE_URL, escapeHtml, page, notFoundPage, CACHE_HEADERS, isoDate, formatShowDate };
