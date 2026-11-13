/**
 * admin-list-unsubscribes — read-only data for Admin → Unsubscribes.
 *
 * The browser never reads userProfiles opt-out fields, emailSuppressions
 * or unsubscribeEvents for this screen; it asks here, as an admin.
 *
 * GET → {
 *   current: [{ email, uid, displayName, handle, level, date, method, source }]
 *     everyone opted out right now: account holders (emailOptOut /
 *     announcementsOptOut) and address-level suppressions, one row per
 *     address, broadest level wins. Opt-outs from before 5.38 carry no
 *     date and method 'legacy' — nothing is invented for them.
 *   events:  [{ id, uid, email, scope, action, method, source, createdAt }]
 *     the log, newest first
 *   announcements: { [id]: subject }  to label 'announcement:<id>' sources
 * }
 * Auth header: Authorization: Bearer {idToken}   (admin only, else 403)
 */

const { withCors } = require('./lib/cors');
const { getDb, getAdminAuth, verifyUser, isAdminClaims } = require('./lib/firebaseAdmin');
const { emailsForUids } = require('./lib/accountEmails');
const { normalizeEmail } = require('./lib/unsubscribeToken');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const EVENT_LIMIT = 2000;

function iso(t) {
  if (!t) return null;
  if (t instanceof Date) return t.toISOString();
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  return null;
}

function profileRow(uid, p, level) {
  const field = level === 'all' ? 'emailOptOut' : 'announcementsOptOut';
  const at = p[`${field}At`];
  return {
    email: normalizeEmail(p.email) || null,
    uid,
    displayName: p.displayName || null,
    handle: p.handle || null,
    level,
    date: iso(at),
    method: at ? (p[`${field}Method`] || 'legacy') : 'legacy',
    source: p[`${field}Source`] || null,
  };
}

/**
 * Accounts for addresses with no profile match, via Auth (profiles stopped
 * carrying `email` in 5.59.7, S-01). Map(email → { uid, ...profile }).
 */
async function accountsByEmail(db, auth, emails) {
  const out = new Map();
  if (!auth || emails.length === 0) return out;
  const found = [];
  if (typeof auth.getUsers === 'function') {
    for (let i = 0; i < emails.length; i += 100) {
      const res = await auth.getUsers(emails.slice(i, i + 100).map((email) => ({ email })));
      for (const u of res.users || []) if (u.email) found.push(u);
    }
  } else {
    for (const email of emails) {
      try { found.push(await auth.getUserByEmail(email)); } catch { /* no account */ }
    }
  }
  for (const u of found) {
    const snap = await db.doc(`userProfiles/${u.uid}`).get();
    out.set(normalizeEmail(u.email), { uid: u.uid, ...(snap.exists ? snap.data() : {}), email: normalizeEmail(u.email) });
  }
  return out;
}

async function buildCurrentState(db, auth = null) {
  const [allSnap, annSnap, supSnap] = await Promise.all([
    db.collection('userProfiles').where('emailOptOut', '==', true).get(),
    db.collection('userProfiles').where('announcementsOptOut', '==', true).get(),
    db.collection('emailSuppressions').get(),
  ]);
  // Opted-out accounts whose profile has no `email` get it from Auth.
  const authEmails = await emailsForUids(auth,
    [...allSnap.docs, ...annSnap.docs].filter((d) => !d.data().email).map((d) => d.id));
  const withEmail = (d) => ({ ...d.data(), email: d.data().email || authEmails.get(d.id) || '' });

  const rows = new Map(); // key → row
  const put = (row) => {
    const key = row.email || `uid:${row.uid}`;
    const prev = rows.get(key);
    if (!prev || (prev.level === 'announcements' && row.level === 'all')) {
      rows.set(key, prev ? { ...row, displayName: row.displayName || prev.displayName, handle: row.handle || prev.handle, uid: row.uid || prev.uid } : row);
    }
  };

  const profilesByEmail = new Map();
  for (const d of allSnap.docs) {
    const p = withEmail(d);
    if (p.email) profilesByEmail.set(normalizeEmail(p.email), { uid: d.id, ...p });
    put(profileRow(d.id, p, 'all'));
  }
  for (const d of annSnap.docs) {
    const p = withEmail(d);
    if (p.email) profilesByEmail.set(normalizeEmail(p.email), { uid: d.id, ...p });
    if (p.emailOptOut === true) continue;
    put(profileRow(d.id, p, 'announcements'));
  }

  // Suppressed addresses that belong to an account get that account's name.
  const unmatched = [];
  for (const d of supSnap.docs) {
    const s = d.data();
    const email = normalizeEmail(s.email);
    if (email && !profilesByEmail.has(email)) unmatched.push(email);
  }
  for (let i = 0; i < unmatched.length; i += 30) {
    const snap = await db.collection('userProfiles').where('email', 'in', unmatched.slice(i, i + 30)).get();
    for (const d of snap.docs) profilesByEmail.set(normalizeEmail(d.data().email), { uid: d.id, ...d.data() });
  }
  const stillUnmatched = unmatched.filter((e) => !profilesByEmail.has(e));
  for (const [email, p] of await accountsByEmail(db, auth, stillUnmatched)) profilesByEmail.set(email, p);
  for (const d of supSnap.docs) {
    const s = d.data();
    const email = normalizeEmail(s.email);
    const p = profilesByEmail.get(email);
    put({
      email,
      uid: p?.uid || null,
      displayName: p?.displayName || null,
      handle: p?.handle || null,
      level: s.scope === 'announcements' ? 'announcements' : 'all',
      date: iso(s.updatedAt || s.createdAt),
      method: s.method || 'link',
      source: s.source || null,
    });
  }

  return [...rows.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Unauthorized' });
  if (!isAdminClaims(decoded)) return reply(403, { error: 'Forbidden' });

  try {
    const db = getDb();
    const [current, evSnap, annSnap] = await Promise.all([
      buildCurrentState(db, getAdminAuth()),
      db.collection('unsubscribeEvents').orderBy('createdAt', 'desc').limit(EVENT_LIMIT).get(),
      db.collection('announcements').select('subject').get(),
    ]);
    const events = evSnap.docs.map((d) => {
      const e = d.data();
      return {
        id: d.id, uid: e.uid || null, email: e.email || null, scope: e.scope, action: e.action,
        method: e.method, source: e.source, createdAt: iso(e.createdAt),
      };
    });
    const announcements = {};
    for (const d of annSnap.docs) announcements[d.id] = d.data().subject || '(no subject)';
    return reply(200, { current, events, announcements });
  } catch (e) {
    console.error('[admin-list-unsubscribes] error:', e);
    return reply(500, { error: 'Could not load unsubscribes' });
  }
};

exports.buildCurrentState = buildCurrentState;

// CORS allowlist on every response (lib/cors.js) — no more `*` (5.59.6).
module.exports.handler = withCors(module.exports.handler);
