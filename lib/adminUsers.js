/**
 * Admin Users tab (v5.44.0): one row per account or guest trial, plus the
 * filters, sorts and totals the tab and the Stats tab run over them.
 *
 * Pure functions, no Firestore — AdminView loads the collections once and
 * everything here runs client-side over what it loaded.
 *
 * Where each column comes from:
 *   - Full accounts are userProfiles/{uid}.
 *   - Trials are guestSessions that never converted. A guest is not a
 *     Firebase account (no uid, name or email), only a session doc. A
 *     guest who signed up is shown once, as their full account, with
 *     `converted` set — never also as a trial row.
 *   - Signup date: Firebase Auth's creationTime when the admin function
 *     returned it (netlify/functions/admin-list-auth-users.js), else the
 *     profile's createdAt, else null ("Unknown"). Not "today": the old
 *     `|| new Date()` fallback put every undated account in every range.
 *     For a trial it is the session's startedAt.
 *   - Invited by: invitedBy* on the profile (both invite paths write it
 *     as of 5.44.0), else an accepted invite addressed to their email.
 *   - Invites sent: invites docs whose inviterUid is this user.
 *   - Test user: userProfiles.isTestUser, admin-set. Trials cannot be
 *     flagged — anyone can write a guestSessions doc, so no rule could
 *     protect the flag there — and always count as real.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' for a Date, on the local calendar. */
export function isoDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The from/to pair for a preset. Ranges are inclusive and end today, so
 * "7 days" is today and the six before it. 'all' clears both ends.
 */
export function presetRange(preset, today = new Date()) {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[preset];
  if (!days) return { from: '', to: '' };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: isoDay(start), to: isoDay(today) };
}

/** Which preset (if any) a from/to pair is, so its button can show as active. */
export function matchPreset(from, to, today = new Date()) {
  if (!from && !to) return 'all';
  for (const p of ['7d', '30d', '90d']) {
    const r = presetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

export function buildUserRows({ profiles = [], guestSessions = [], invites = [], authDates = {} } = {}) {
  const sessionByUser = {};
  for (const s of guestSessions) {
    if (s.converted && s.convertedUserId) sessionByUser[s.convertedUserId] = s;
  }

  const acceptedByEmail = {};
  const sentByUid = {};
  for (const inv of invites) {
    const email = (inv.inviteeEmail || '').toLowerCase();
    if (inv.status === 'accepted' && email) acceptedByEmail[email] = inv;
    if (inv.inviterUid) sentByUid[inv.inviterUid] = (sentByUid[inv.inviterUid] || 0) + 1;
  }

  const profileById = {};
  for (const p of profiles) profileById[p.id] = p;

  const fullRows = profiles.map((p) => {
    const session = sessionByUser[p.id];
    const inv = acceptedByEmail[(p.email || '').toLowerCase()];
    const inviterUid = p.invitedByUid || inv?.inviterUid || null;
    const inviterProfile = inviterUid ? profileById[inviterUid] : null;
    const invitedBy = inviterUid || inv
      ? {
          uid: inviterUid,
          name: p.invitedByName || inv?.inviterName || inviterProfile?.displayName || inviterProfile?.firstName || '',
          email: p.invitedByEmail || inv?.inviterEmail || inviterProfile?.email || '',
        }
      : null;
    const converted = !!(p.convertedFromGuest || session);
    return {
      id: p.id,
      kind: 'full',
      name: p.displayName || p.firstName || '',
      email: p.email || '',
      signupDate: toDate(authDates[p.id]) || toDate(p.createdAt),
      showCount: p.showCount || 0,
      invitesSent: sentByUid[p.id] || 0,
      invitedBy,
      converted,
      convertedAt: converted ? (toDate(p.guestConvertedAt) || toDate(session?.convertedAt)) : null,
      isTestUser: p.isTestUser === true,
      profile: p,
    };
  });

  const trialRows = guestSessions
    .filter((s) => !(s.converted && s.convertedUserId))
    .map((s) => ({
      id: `guest:${s.id}`,
      kind: 'trial',
      name: '',
      email: '',
      signupDate: toDate(s.startedAt),
      showCount: s.showsAdded || 0,
      invitesSent: 0,
      invitedBy: null,
      converted: false,
      convertedAt: null,
      isTestUser: false,
      session: s,
    }));

  return [...fullRows, ...trialRows];
}

/**
 * from/to are 'YYYY-MM-DD' (either may be ''), inclusive, local time. A
 * row with no known signup date is left out whenever either end is set —
 * it cannot be shown to fall inside the range — and kept for all time.
 */
export function filterRows(rows, { from = '', to = '', accountType = 'all', testFilter = 'real', search = '' } = {}) {
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toMs = to ? new Date(`${to}T00:00:00`).getTime() + DAY_MS : null;
  const q = search.trim().toLowerCase();

  return rows.filter((r) => {
    if (accountType !== 'all' && r.kind !== accountType) return false;
    if (testFilter === 'real' && r.isTestUser) return false;
    if (testFilter === 'test' && !r.isTestUser) return false;
    if (fromMs != null || toMs != null) {
      if (!r.signupDate) return false;
      const t = r.signupDate.getTime();
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t >= toMs) return false;
    }
    if (q && !(r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))) return false;
    return true;
  });
}

export const SORT_KEYS = ['signupDate', 'showCount', 'invitesSent', 'invitedBy', 'converted'];

/**
 * dir 'desc' is newest / most / yes first; 'asc' the reverse. Rows with
 * no signup date sort last either way, and ties fall back to newest
 * signup first so the order is stable across clicks.
 */
export function sortRows(rows, { key = 'signupDate', dir = 'desc' } = {}) {
  const sign = dir === 'asc' ? 1 : -1;
  const time = (r) => r.signupDate?.getTime() ?? null;
  const byNewest = (a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  };
  const value = {
    showCount: (r) => r.showCount,
    invitesSent: (r) => r.invitesSent,
    invitedBy: (r) => (r.invitedBy ? 1 : 0),
    converted: (r) => (r.converted ? 1 : 0),
  }[key];

  return [...rows].sort((a, b) => {
    if (key === 'signupDate') {
      const ta = time(a);
      const tb = time(b);
      if (ta == null || tb == null) return byNewest(a, b);
      return sign * (ta - tb) || 0;
    }
    if (!value) return byNewest(a, b);
    const diff = sign * (value(a) - value(b));
    if (diff) return diff;
    if (key === 'converted' && a.converted && b.converted) {
      return sign * ((a.convertedAt?.getTime() || 0) - (b.convertedAt?.getTime() || 0)) || byNewest(a, b);
    }
    return byNewest(a, b);
  });
}

/** The Stats tab's totals, summed from each profile's stored counters. */
export function computeTotals(profiles = [], { includeTestUsers = false } = {}) {
  const counted = includeTestUsers ? profiles : profiles.filter((p) => p.isTestUser !== true);
  return {
    totalUsers: counted.length,
    totalShows: counted.reduce((acc, p) => acc + (p.showCount || 0), 0),
    totalSongs: counted.reduce((acc, p) => acc + (p.songCount || 0), 0),
    totalRated: counted.reduce((acc, p) => acc + (p.ratedSongCount || 0), 0),
    testUsers: profiles.length - profiles.filter((p) => p.isTestUser !== true).length,
  };
}
