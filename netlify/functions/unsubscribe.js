/**
 * unsubscribe — the endpoint every unsubscribe link and List-Unsubscribe
 * header points at.
 *
 *   GET  /api/unsubscribe?token=…   Confirmation page with a button. Does
 *        NOT unsubscribe: corporate link scanners and mail previewers
 *        fetch every link in an email, and a GET that unsubscribed would
 *        silently remove people who never clicked anything.
 *   POST /api/unsubscribe?token=…   body "List-Unsubscribe=One-Click"
 *        RFC 8058 one-click, sent by Gmail/Apple Mail's own Unsubscribe
 *        button. Unsubscribes and returns 200 with no page and no redirect.
 *   POST /api/unsubscribe?token=…   body "scope=all|announcements"
 *        The confirmation page's button. Unsubscribes and shows a
 *        "You're unsubscribed" page.
 *
 * Tokens are signed (lib/unsubscribeToken.js). A pre-5.38 token — just a
 * base64 uid — unsubscribes nobody; it gets a page pointing at Profile.
 * Every real unsubscribe, repeat or not, is logged to unsubscribeEvents.
 */

const { getDb, getAdminAuth } = require('./lib/firebaseAdmin');
const { verify, isLegacyToken } = require('./lib/unsubscribeToken');
const { applyUnsubscribe, resolveEmailForUid } = require('./lib/emailPolicy');
const { escapeHtml } = require('./lib/emailLayout');
const { PAGE_HEADERS, page, html } = require('./lib/actionPage');

const APP_URL = 'https://mysetlists.net';
const PROFILE_URL = `${APP_URL}/profile/`;

const invalidPage = () => html(400, 'Link not recognised',
  `<p>This unsubscribe link isn't valid. You can manage your email settings from your Profile.</p>
   <a class="btn primary" href="${PROFILE_URL}">Open email settings</a>`, { tone: 'error' });

const legacyPage = () => html(200, 'This link has expired',
  `<p>This link has expired. Manage your email settings from your Profile.</p>
   <a class="btn primary" href="${PROFILE_URL}">Open MySetlists</a>`);

const errorPage = () => html(500, 'Something went wrong',
  `<p>We couldn't update your email settings just now. Please try again in a minute, or turn emails off from your Profile.</p>
   <a class="btn secondary" href="${PROFILE_URL}">Open email settings</a>`, { tone: 'error' });

function successPage(scope) {
  const what = scope === 'announcements'
    ? "You won't get MySetlists announcements any more. You'll still get emails about your own activity, like tags and replies."
    : "You won't get any more emails from MySetlists.";
  return html(200, "You're unsubscribed",
    `<p>${what}</p>
     <p class="links">Changed your mind? <a href="${PROFILE_URL}">Update your email settings</a></p>`);
}

function parseBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  let params;
  try { params = new URLSearchParams(raw); } catch { params = new URLSearchParams(); }
  // RFC 8058 allows multipart/form-data too; the one field that matters is
  // unmistakable in either encoding.
  const oneClick = params.get('List-Unsubscribe') === 'One-Click'
    || /name="List-Unsubscribe"[\s\S]*?One-Click/i.test(raw);
  return { oneClick, scope: params.get('scope') };
}

async function recipientEmail(db, auth, payload) {
  if (payload.kind === 'email') return payload.id;
  try {
    const snap = await db.doc(`userProfiles/${payload.id}`).get();
    return await resolveEmailForUid(db, auth, payload.id, snap.exists ? snap.data() : null);
  } catch {
    return null;
  }
}

exports.handler = async function (event) {
  const method = event.httpMethod;
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { ...PAGE_HEADERS, Allow: 'GET, POST' }, body: page('Not allowed', '<p>Method not allowed.</p>', { tone: 'error' }) };
  }

  const token = event.queryStringParameters?.token || '';
  const payload = verify(token);

  if (!payload) {
    if (method === 'POST' && parseBody(event).oneClick) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: '' };
    }
    return isLegacyToken(token) ? legacyPage() : invalidPage();
  }

  let db, auth;
  try {
    db = getDb();
    auth = getAdminAuth();
  } catch (e) {
    console.error('[unsubscribe] firebase init failed:', e.message);
    return errorPage();
  }

  if (method === 'GET') {
    const email = await recipientEmail(db, auth, payload);
    const who = email ? `<span class="email">${escapeHtml(email)}</span>` : 'this address';
    const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
    const buttons = payload.scope === 'announcements'
      ? `<button class="primary" type="submit" name="scope" value="announcements">Unsubscribe from announcements</button>
         <button class="secondary" type="submit" name="scope" value="all">Unsubscribe from all MySetlists emails</button>`
      : `<button class="primary" type="submit" name="scope" value="all">Unsubscribe from all MySetlists emails</button>`;
    const lead = payload.scope === 'announcements'
      ? `Stop sending product news and announcements to ${who}?`
      : `Stop sending MySetlists emails to ${who}?`;
    return html(200, 'Unsubscribe', `<p>${lead}</p>
      <form method="POST" action="${action}">${buttons}</form>
      <p class="links" style="margin-bottom:0">Or <a href="${PROFILE_URL}">manage email settings</a> in the app.</p>`);
  }

  // POST
  const { oneClick, scope: requested } = parseBody(event);
  // The page may broaden an announcements link to "all"; nothing narrows.
  const scope = oneClick ? payload.scope
    : (requested === 'all' || requested === payload.scope ? requested : payload.scope);
  try {
    await applyUnsubscribe(db, auth, { payload, scope, method: oneClick ? 'one-click' : 'link' });
  } catch (e) {
    console.error('[unsubscribe] write failed:', e);
    if (oneClick) return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: '' };
    return errorPage();
  }
  if (oneClick) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: '' };
  }
  return successPage(scope);
};
