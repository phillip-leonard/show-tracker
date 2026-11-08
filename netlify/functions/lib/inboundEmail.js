/**
 * inboundEmail — what happens to an email arriving at the MySetlists presale
 * inbox, minus the network. netlify/functions/inbound-email.js supplies Resend
 * and the parse trigger; tests/notifications/presaleEmail.test.js supplies
 * fakes.
 *
 * WHO GETS IN. A sender must be on an artist's allowlist (artists/{id}.
 * senderAllowlist) or the global one (onsaleConfig/global.senderAllowlist,
 * which is where Seated's sending domain goes), and the email must prove it:
 *   - DKIM, SPF or DMARC fail, or sender on no list: rejected, not parsed, body
 *     not kept
 *   - all pass: stored and queued for parsing
 *   - DMARC anything but pass, with no failure above: held. A DKIM pass alone
 *     doesn't show who sent it, since anyone can sign with their own domain and
 *     forge the From. A held email waits for the admin (Admin → On-sale alerts).
 *
 * LINKS. Nothing in an email is ever fetched, with one exception: the single
 * confirm link in a subscription confirmation from an allowlisted, verified
 * sender. Every such click is logged on the email's doc.
 */

const crypto = require('crypto');

const INBOUND_EMAILS = 'inboundEmails';
const ARTISTS = 'artists';
const ONSALE_CONFIG = 'onsaleConfig';
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 60000;
const MAX_LINKS = 100;

// ── Webhook signature (Resend signs with Svix) ──────────────────────────

/** True if `headers` carry a valid, recent signature of the exact raw body. */
function verifyWebhookSignature({ rawBody, headers, secret, nowMs = Date.now() }) {
  const h = {};
  Object.entries(headers || {}).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
  const id = h['svix-id'];
  const timestamp = h['svix-timestamp'];
  const signatures = h['svix-signature'];
  if (!id || !timestamp || !signatures || !secret) return false;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return String(signatures).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// ── Senders ─────────────────────────────────────────────────────────────

/** 'news@band.com' from 'The Band <News@Band.com>'. */
function senderAddress(from) {
  const s = String(from || '').trim();
  const m = /<([^<>]+)>\s*$/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** An entry is an exact address, or a domain ('band.com' or '@band.com') that covers its subdomains. */
function senderMatches(entry, address) {
  const e = String(entry || '').trim().toLowerCase();
  if (!e || !address.includes('@')) return false;
  if (!e.startsWith('@') && e.includes('@')) return e === address;
  const domain = e.replace(/^@/, '');
  const from = address.split('@').pop();
  return from === domain || from.endsWith(`.${domain}`);
}

/** 'fail' | 'hold' | 'pass' for Resend's { spf, dkim, dmarc } results. */
function judgeAuthentication(auth) {
  if (!auth) return 'hold';
  if (auth.dkim === 'fail' || auth.spf === 'fail' || auth.dmarc === 'fail') return 'fail';
  return auth.dmarc === 'pass' ? 'pass' : 'hold';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namedIn(name, text) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** The one artist named in the subject, or else the body; null when none or more than one. */
function artistNamedIn(artists, subject, text) {
  for (const hay of [subject, text]) {
    const hits = artists.filter((a) => a.name && namedIn(a.name, hay || ''));
    if (hits.length) {
      // "Goose" inside "Mother Goose": the longest name that matched, if it contains the others.
      const longest = hits.reduce((a, b) => (b.name.length > a.name.length ? b : a));
      const contained = hits.every((a) => namedIn(a.name, longest.name));
      return contained ? longest : null;
    }
  }
  return null;
}

/**
 * Which artist an email is about, and on whose word.
 * senderKind 'band': the sender is on that artist's own list.
 * senderKind 'seated': on the global list; the artist comes from the text.
 * allowlisted false: on no list at all.
 */
function mapSender({ address, subject, text, artists, globalAllowlist }) {
  const own = artists.find((a) => (a.senderAllowlist || []).some((e) => senderMatches(e, address)));
  if (own) return { allowlisted: true, senderKind: 'band', artist: own };
  if ((globalAllowlist || []).some((e) => senderMatches(e, address))) {
    return { allowlisted: true, senderKind: 'seated', artist: artistNamedIn(artists, subject, text) };
  }
  return { allowlisted: false, senderKind: null, artist: null };
}

// ── Body ────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+);/gi, (all, code) => {
    const lower = code.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)) || 32);
    return all;
  });
}

/** A link with its utm_ parameters gone; null if it isn't http(s). */
function cleanUrl(url) {
  try {
    const u = new URL(decodeEntities(String(url).trim()));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    [...u.searchParams.keys()].filter((k) => /^utm_/i.test(k)).forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return null;
  }
}

/** { text, links: [{ url, label }] }: plain text with no markup, and every link once. */
function sanitizeEmail({ html, text }) {
  const links = new Map();
  const add = (url, label = '') => {
    const clean = cleanUrl(url);
    if (clean && !links.has(clean) && links.size < MAX_LINKS) links.set(clean, { url: clean, label: label.slice(0, 200) });
  };

  const markup = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const anchor = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchor.exec(markup))) {
    add(m[1] || m[2], decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
  }

  const fromHtml = decodeEntities(markup.replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '));
  const body = (String(text || '').trim() || fromHtml)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  (body.match(/https?:\/\/[^\s<>"')\]]+/g) || []).forEach((u) => add(u.replace(/[.,;:!?]+$/, '')));
  return { text: body, links: [...links.values()] };
}

// ── Subscription confirmations ──────────────────────────────────────────

const CONFIRM_TEXT = /\b(confirm|verify)\b[^.\n]{0,60}\b(subscri|e-?mail|sign[- ]?up|list|address|follow)/i;
const CONFIRM_LINK = /confirm|verify|subscribe|opt-?in/i;
const NOT_CONFIRM_LINK = /unsubscribe|preferences|privacy|terms|opt-?out/i;

/** The confirm link, only when the email is a confirmation and has exactly one candidate. */
function singleConfirmLink({ subject, text, links }) {
  if (!CONFIRM_TEXT.test(`${subject || ''}\n${text || ''}`)) return null;
  const candidates = (links || []).filter((l) => {
    if (NOT_CONFIRM_LINK.test(`${l.url} ${l.label}`) || !CONFIRM_LINK.test(`${l.url} ${l.label}`)) return false;
    try {
      const u = new URL(l.url);
      return u.protocol === 'https:' && !/^[\d.]+$|^\[|localhost/i.test(u.hostname);
    } catch {
      return false;
    }
  });
  return candidates.length === 1 ? candidates[0].url : null;
}

// ── The run ─────────────────────────────────────────────────────────────

async function loadAllowlists(db) {
  const [artistSnap, config] = await Promise.all([
    db.collection(ARTISTS).get(),
    db.collection(ONSALE_CONFIG).doc('global').get(),
  ]);
  return {
    artists: artistSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    globalAllowlist: config.exists ? config.data().senderAllowlist || [] : [],
  };
}

/**
 * Decide and store one received email. Resend retries a webhook, so a doc
 * already there ends it. Resolves the status stored.
 *   email       Resend's received email: { from, subject, text, html, authentication, created_at }
 *   startParse  (emailId) => Promise
 *   clickLink   (url) => Promise<number>, the only link-following there is
 */
async function ingestEmail({ db, emailId, email, startParse, clickLink, now = () => Date.now() }) {
  const ref = db.collection(INBOUND_EMAILS).doc(emailId);
  if ((await ref.get()).exists) return 'duplicate';

  const sender = senderAddress(email.from);
  const { text, links } = sanitizeEmail(email);
  const subject = String(email.subject || '').slice(0, 500);
  const authentication = email.authentication || null;
  const { artists, globalAllowlist } = await loadAllowlists(db);
  const map = mapSender({ address: sender, subject, text, artists, globalAllowlist });
  const auth = judgeAuthentication(authentication);

  const doc = {
    sender,
    subject,
    receivedAtMs: Date.parse(email.created_at) || now(),
    authentication,
    artistId: map.artist?.id || null,
    artistName: map.artist?.name || null,
    senderKind: map.senderKind,
  };

  // A reject keeps who and why, not what it said.
  if (!map.allowlisted) return store(ref, { ...doc, status: 'rejected', reason: 'sender_not_allowlisted' });
  if (auth === 'fail') return store(ref, { ...doc, status: 'rejected', reason: 'authentication_failed' });

  const kept = { ...doc, text, links };
  if (auth === 'hold') return store(ref, { ...kept, status: 'held', reason: 'dmarc_not_pass' });

  const confirmUrl = singleConfirmLink({ subject, text, links });
  if (confirmUrl) {
    let result;
    try { result = await clickLink(confirmUrl); } catch (err) { result = `error: ${err.message}`; }
    console.log('[inboundEmail] auto-confirmed', JSON.stringify({ emailId, sender, confirmUrl, result }));
    return store(ref, { ...kept, status: 'confirmed', autoConfirm: { url: confirmUrl, result, atMs: now() } });
  }

  if (!map.artist) return store(ref, { ...kept, status: 'unmapped', reason: 'no_artist_named' });

  await ref.set({ ...kept, status: 'queued' });
  try {
    await startParse(emailId);
  } catch (err) {
    // Still 'queued': the next scan picks it up.
    console.warn('[inboundEmail] could not start the parser', emailId, err.message);
  }
  return 'queued';
}

async function store(ref, doc) {
  await ref.set(doc);
  return doc.status;
}

module.exports = {
  INBOUND_EMAILS, ARTISTS, ONSALE_CONFIG,
  verifyWebhookSignature, senderAddress, senderMatches, judgeAuthentication, mapSender,
  artistNamedIn, cleanUrl, sanitizeEmail, singleConfirmLink, ingestEmail,
};
