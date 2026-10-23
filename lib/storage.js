/**
 * Centralized localStorage helpers — SSR-safe for Next.js.
 *
 * Every access is wrapped in try/catch. With site data blocked (Chrome's
 * "Block all site data", some privacy extensions and embedded webviews),
 * merely reading `window.localStorage` throws a SecurityError. Before
 * 5.44.5 that happened in a useState initializer in AppProvider and took
 * the whole tree down to "Application error". Reads now fall back to null
 * and writes are dropped, which is what a fresh, empty browser looks like.
 */

const isBrowser = typeof window !== 'undefined';

export const storage = {
  get: (key) => {
    if (!isBrowser) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, val) => {
    if (!isBrowser) return false;
    try {
      localStorage.setItem(key, val);
      return true;
    } catch {
      return false;
    }
  },
  remove: (key) => {
    if (!isBrowser) return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
  getJSON: (key) => {
    try {
      return JSON.parse(storage.get(key));
    } catch {
      return null;
    }
  },
  setJSON: (key, val) => storage.set(key, JSON.stringify(val)),
};

export const STORAGE_KEYS = {
  LAST_VISIT: 'mysetlists_lastVisit',
  SEEN_TOOLTIPS: 'hasSeenOnboardingTooltips',
  INVITE_REFERRER: 'invite-referrer',
  LEGACY_SHOWS: 'concert-shows',
  GUEST_SHOWS: 'guest-shows',
  GUEST_SESSION: 'guest-session-id',
  COOKIE_CONSENT: 'cookie-consent',
  WHATS_NEW_VERSION: 'mysetlists_whats_new_seen',
  PLAYLIST_TOOLTIP_SEEN: 'mysetlists_playlist_tooltip_seen',
  SHOW_PLAY_COUNTS: 'mysetlists_show_play_counts',
  POPUP_DISMISSALS: 'mysetlists_popup_dismissals',
  // The Terms agreement taken before an account exists — see lib/terms.js.
  TERMS_PENDING: 'mysetlists_terms_pending',
  // A band to follow once signed in, from a band page's ?follow= link.
  PENDING_FOLLOW: 'mysetlists_pending_follow',
  // "Save these shows to MySetlists" from /heard/<slug>/: '<slug>.<code>'
  // (components/heard/HeardSaveModal.jsx).
  PENDING_HEARD: 'mysetlists_pending_heard',
  // Where to go after signing in from /heard/<slug>/?mine=1 (AppContext).
  PENDING_NEXT: 'mysetlists_pending_next',
  // + uid: the local date "Relive this night" was last shown to that user
  // on this device (lib/reliveThisNight.js).
  RELIVE_THIS_NIGHT_PREFIX: 'mysetlists_relive_this_night:',
};
