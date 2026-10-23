// lib/setlistfmLocalCache.js
//
// setlist.fm responses that components keep in localStorage for 24 hours:
// TourInfoModal's tour list and song stats, WishlistView's song catalog.
// Each entry is { data, cachedAt }, and each component drops its own entry
// when it next reads it after expiry. An entry nobody reads again was never
// dropped, so a phone could keep setlist.fm data for months; setlist.fm's
// terms allow caching "for short periods" only.
//
// sweepExpiredSetlistfmCaches() runs once per app load (context/AppContext)
// and removes every expired entry under these prefixes.

export const SETLISTFM_LOCAL_CACHE_PREFIXES = ['tour_info_', 'song_stats_', 'wishlist_catalog_'];
export const SETLISTFM_LOCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Removes expired (or unreadable) entries. Returns how many it removed.
 *
 * `store` defaults to window.localStorage, read inside the try: with site
 * data blocked, merely touching window.localStorage throws a SecurityError,
 * and in 5.47.5 that read sat in a default parameter, outside the try, and
 * took the whole app down to "Application error" for those users.
 */
export function sweepExpiredSetlistfmCaches(storeArg, now = Date.now()) {
  let removed = 0;
  try {
    const store = storeArg !== undefined ? storeArg : (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return 0;
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && SETLISTFM_LOCAL_CACHE_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
    }
    for (const key of keys) {
      let expired = true;
      try {
        const { cachedAt } = JSON.parse(store.getItem(key)) || {};
        expired = !(typeof cachedAt === 'number' && now - cachedAt < SETLISTFM_LOCAL_CACHE_TTL_MS);
      } catch { /* unreadable: remove */ }
      if (expired) { store.removeItem(key); removed++; }
    }
  } catch { /* storage unavailable (private mode): nothing to sweep */ }
  return removed;
}
