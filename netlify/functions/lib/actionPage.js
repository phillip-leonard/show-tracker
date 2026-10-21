/**
 * actionPage — the small branded HTML page the email-link endpoints answer
 * with (unsubscribe.js, unfollow-band.js): a card on the app's navy, one
 * heading, a paragraph or two, a button.
 */

const { escapeHtml } = require('./emailLayout');

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  // The token is in the URL; don't hand it to anything we link to.
  'Referrer-Policy': 'no-referrer',
};

function page(title, bodyHtml, { tone = 'ok' } = {}) {
  const accent = tone === 'error' ? '#ef6b6b' : '#34D399';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} · MySetlists</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      min-height: 100vh; min-height: 100dvh;
      background: #2a2a4e; color: #f1f1f7;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
               max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      -webkit-text-size-adjust: 100%;
    }
    .card {
      width: 100%; max-width: 440px; background: #1f1f3a;
      border: 1px solid rgba(255,255,255,0.08); border-radius: 20px;
      padding: 36px 24px; text-align: center;
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
    }
    .brand { font-weight: 800; font-size: 18px; letter-spacing: -0.02em; margin: 0 0 24px; color: #fff; }
    .brand span { color: #34D399; }
    h1 { color: ${accent}; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 12px; }
    p { color: #b8b8d0; font-size: 15px; line-height: 1.6; margin: 0 0 20px; }
    .email { color: #fff; font-weight: 600; word-break: break-all; }
    form { margin: 0; display: flex; flex-direction: column; gap: 12px; }
    button, .btn {
      display: block; width: 100%; min-height: 48px; padding: 14px 20px;
      border-radius: 12px; border: 0; cursor: pointer;
      font: 700 16px/1.2 'Plus Jakarta Sans', -apple-system, sans-serif;
      text-decoration: none; -webkit-appearance: none; appearance: none;
    }
    .primary { background: #34D399; color: #2a2a4e; }
    .primary:active { background: #059669; }
    .secondary { background: transparent; color: #f1f1f7; border: 1px solid rgba(255,255,255,0.22); }
    a { color: #34D399; font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .links { margin-top: 20px; font-size: 14px; color: #8e8eab; }
  </style>
</head>
<body>
  <main class="card">
    <p class="brand">my<span>setlists</span></p>
    <h1>${escapeHtml(title)}</h1>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

function html(statusCode, title, bodyHtml, opts) {
  return { statusCode, headers: PAGE_HEADERS, body: page(title, bodyHtml, opts) };
}

module.exports = { PAGE_HEADERS, page, html };
