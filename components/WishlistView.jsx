// components/WishlistView.jsx
//
// /wishlist page body. Pick an artist, see songs you've already witnessed
// live (from your own logged shows — Firestore only, no external calls),
// star songs from their catalog you want to see, and it persists
// per-user/per-artist to Firestore (see lib/wishlist.js).
//
// Catalog data comes from setlist.fm's own aggregate of every song this
// artist has ever played live, across all public setlist.fm setlists (see
// netlify/functions/get-artist-song-stats.js, already used by
// TourInfoModal.jsx for tour stats) — not a streaming service's studio
// catalog. That's a better match for a live-show tracker: it's the same
// source the user's own logged setlists came from, and it doesn't require
// the user to connect Spotify or Apple Music just to browse.
//
// wishlistMap is the single source of truth for "is this song starred" —
// both the catalog list and the Wishlist column render from the same
// state and call the same toggleSong, so starring/unstarring is symmetric
// no matter which list you click from (see StarToggleRow below).
//
// UX call: starring a catalog song leaves it in place in the catalog list
// (still starred, not removed) rather than moving it out — the Wishlist
// column above is the canonical "your wishlist" view, and leaving starred
// items visible below lets you unstar without hunting for them. This
// mirrors how TagFriendsModal keeps selected friends in the same list
// rather than relocating them.

'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Music, Heart, Search as SearchIcon, Star, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, EmptyState, Spinner, Badge } from '@/components/ui';
import ArtistPicker from '@/components/wishlist/ArtistPicker';
import { useApp } from '@/context/AppContext';
import { apiUrl } from '@/lib/api';
import { normalizeSongTitle, parseDate, humanizeGapDuration } from '@/lib/utils';
import { artistKeyFor, loadWishlist, addWishlistSong, removeWishlistSong, listWishlistedArtists } from '@/lib/wishlist';
import { artistSlugFromName, songSlugFromTitle } from '@/lib/songIndex';
import { forEachSongOncePerShow, songTitleKey } from '@/lib/songCounts';

const ERROR_FLASH_MS = 5000;

// Star toggle, shared by the catalog list and the Wishlist column so both
// read/write the exact same wishlistMap state — starring/unstarring is
// symmetric no matter which list you click from.
function StarToggleRow({ title, meta, subMeta, checked, pending, hasError, onToggle }) {
  const label = checked ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`;
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(title)}
        disabled={pending}
        aria-pressed={checked}
        aria-label={label}
        title={label}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
          checked ? 'bg-amber-subtle border border-amber/30' : 'bg-hover border border-transparent hover:border-subtle'
        } ${pending ? 'opacity-60 cursor-wait' : ''}`}
      >
        <Star
          size={17}
          strokeWidth={2}
          aria-hidden="true"
          className={`flex-shrink-0 ${checked ? 'text-amber' : 'text-muted'}`}
          fill={checked ? 'currentColor' : 'none'}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm text-primary truncate">{title}</span>
            {meta && <span className="text-xs text-muted flex-shrink-0">{meta}</span>}
          </span>
          {subMeta && <span className="block text-[11px] text-muted truncate">{subMeta}</span>}
        </span>
        {hasError && (
          <span className="text-xs font-semibold text-danger flex-shrink-0">Couldn't save — try again</span>
        )}
      </button>
    </li>
  );
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — mirrors TourInfoModal's setlist.fm cache

function getCachedCatalog(mbid) {
  try {
    const raw = localStorage.getItem(`wishlist_catalog_${mbid}`);
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt < CACHE_TTL_MS) return data;
    localStorage.removeItem(`wishlist_catalog_${mbid}`);
  } catch { /* ignore */ }
  return null;
}

function setCachedCatalog(mbid, data) {
  try {
    localStorage.setItem(`wishlist_catalog_${mbid}`, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

export default function WishlistView() {
  const { user, shows, setToast } = useApp();

  const [artist, setArtist] = useState(null); // { name, mbid, disambiguation }

  const [catalogSongs, setCatalogSongs] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  const [wishlistMap, setWishlistMap] = useState({}); // { [normalizedKey]: { title, addedAt } } — single source of truth for "is this song starred", read by both the catalog list and the Wishlist column
  const [wishlistLoading, setWishlistLoading] = useState(false);

  // ── Wishlist hub — every artist the user has starred at least one song for ──
  const [wishlistedArtists, setWishlistedArtists] = useState([]);
  const [wishlistedArtistsLoading, setWishlistedArtistsLoading] = useState(false);
  const [pendingKeys, setPendingKeys] = useState(() => new Set());
  const [errorKeys, setErrorKeys] = useState(() => new Set());
  const errorTimers = useRef({});

  useEffect(() => () => {
    Object.values(errorTimers.current).forEach(clearTimeout);
  }, []);

  // ── Songs I've Seen — computed entirely from the user's own Firestore shows ──
  // Keyed by normalizeSongTitle so two spellings of one song (e.g.
  // "Ashes//Dust" vs "Ashes // Dust") collapse into a single row with a
  // combined count, matching how song pages and the catalog match already work.
  const seenSongs = useMemo(() => {
    if (!artist) return [];
    const target = artist.name.trim().toLowerCase();
    // count = distinct shows; a song played twice in one show counts once
    // (lib/songCounts.js).
    const counts = {}; // normalizedKey -> { count, spellings: { rawName: count } }
    forEachSongOncePerShow(
      (shows || []).filter(s => (s.artist || '').trim().toLowerCase() === target),
      song => songTitleKey(song.name || song.song || song.title || ''),
      (key, song) => {
        const name = song.name || song.song || song.title || '';
        if (!counts[key]) counts[key] = { count: 0, spellings: {} };
        counts[key].count++;
        counts[key].spellings[name] = (counts[key].spellings[name] || 0) + 1;
      }
    );
    return Object.values(counts)
      .map(data => ({
        title: Object.entries(data.spellings).sort((a, b) => b[1] - a[1])[0][0],
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [shows, artist]);

  const seenNormalizedSet = useMemo(
    () => new Set(seenSongs.map(s => normalizeSongTitle(s.title))),
    [seenSongs]
  );

  const catalogNormalizedSet = useMemo(
    () => new Set(catalogSongs.map(s => normalizeSongTitle(s.name))),
    [catalogSongs]
  );

  // normalizedKey -> catalog song ({ name, count, plays }), for reading a
  // wishlisted song's play history without a second fetch — the catalog
  // call above already pulled every play (with dates) for this artist.
  const catalogByKey = useMemo(() => {
    const map = new Map();
    catalogSongs.forEach(s => map.set(normalizeSongTitle(s.name), s));
    return map;
  }, [catalogSongs]);

  // "last played 2 years, 3 months ago" — null while the catalog hasn't
  // loaded, or if setlist.fm has no play data for this song at all.
  const lastPlayedLabel = useCallback((key) => {
    const song = catalogByKey.get(key);
    if (!song?.plays?.length) return null;
    let mostRecent = null;
    song.plays.forEach(p => {
      const d = parseDate(p.date);
      if (d && d.getTime() > 0 && (!mostRecent || d > mostRecent)) mostRecent = d;
    });
    if (!mostRecent) return null;
    const days = Math.round((Date.now() - mostRecent.getTime()) / 86400000);
    if (days <= 0) return 'played most recently';
    return `last played ${humanizeGapDuration(days)} ago`;
  }, [catalogByKey]);

  const catalogRemaining = useMemo(
    () => catalogSongs.filter(s => !seenNormalizedSet.has(normalizeSongTitle(s.name))),
    [catalogSongs, seenNormalizedSet]
  );

  // "All songs" — the union of setlist.fm's live catalog for this artist and
  // everything the user has actually logged, keyed by normalizeSongTitle so
  // a song that appears in both (the common case) is one row, not two. This
  // is deliberately a superset of the old "songs you haven't seen" catalog
  // list rather than a fourth section: seen, unseen and wishlisted songs are
  // all here, all starrable, with `seenCount` marking the ones already
  // caught. Songs the user logged that setlist.fm has no record of still
  // appear (with no play count), same as the "no setlist.fm record" marker
  // on the Songs I've Seen list.
  const allSongs = useMemo(() => {
    const byKey = new Map(); // normalizedKey -> { key, title, plays, seenCount }
    catalogSongs.forEach(song => {
      const key = normalizeSongTitle(song.name);
      if (!key) return;
      byKey.set(key, { key, title: song.name, plays: song.count || 0, seenCount: 0 });
    });
    seenSongs.forEach(song => {
      const key = normalizeSongTitle(song.title);
      if (!key) return;
      const existing = byKey.get(key);
      if (existing) existing.seenCount = song.count;
      else byKey.set(key, { key, title: song.title, plays: 0, seenCount: song.count });
    });
    // Same ordering as the catalog list it replaces: most-played live first,
    // alphabetical to break ties.
    return Array.from(byKey.values()).sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title));
  }, [catalogSongs, seenSongs]);

  const wishlistEntries = useMemo(
    () => Object.entries(wishlistMap)
      .map(([key, v]) => ({ key, title: v.title, addedAt: v.addedAt }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [wishlistMap]
  );

  // ── Load catalog — every song this artist has played live, per setlist.fm ──
  useEffect(() => {
    if (!artist) return;

    if (!artist.mbid) {
      setCatalogSongs([]);
      setCatalogError("This artist doesn't have a matched setlist.fm profile, so catalog data isn't available.");
      return;
    }

    let cancelled = false;

    (async () => {
      setCatalogLoading(true);
      setCatalogError('');
      setCatalogSongs([]);

      const cached = getCachedCatalog(artist.mbid);
      if (cached) {
        setCatalogSongs(cached);
        setCatalogLoading(false);
        return;
      }

      try {
        const res = await fetch(apiUrl(`/.netlify/functions/get-artist-song-stats?mbid=${encodeURIComponent(artist.mbid)}`));
        if (!res.ok) throw new Error('Failed to fetch catalog from setlist.fm');
        const data = await res.json();
        if (cancelled) return;
        const songs = (data.songs || []).map(s => ({ name: s.name, count: s.count }));
        setCatalogSongs(songs);
        setCachedCatalog(artist.mbid, songs);
      } catch (err) {
        if (!cancelled) setCatalogError(err.message || 'Failed to load catalog.');
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [artist]);

  // ── Load this user's existing wishlist for the selected artist ──────
  useEffect(() => {
    if (!artist || !user) return;
    let cancelled = false;
    (async () => {
      setWishlistLoading(true);
      try {
        const data = await loadWishlist(user.uid, artistKeyFor(artist));
        if (!cancelled) setWishlistMap(data?.songs || {});
      } catch (err) {
        console.error('Failed to load wishlist:', err);
      } finally {
        if (!cancelled) setWishlistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artist, user]);

  // Only needed on the picker/hub screen — skip while an artist is open, and
  // refetch every time the user lands back here (e.g. via "Change artist")
  // so a brand-new artist's first starred song shows up right away.
  useEffect(() => {
    if (!user || artist) return;
    let cancelled = false;
    (async () => {
      setWishlistedArtistsLoading(true);
      try {
        const list = await listWishlistedArtists(user.uid);
        if (!cancelled) setWishlistedArtists(list);
      } catch (err) {
        console.error('Failed to load wishlisted artists:', err);
      } finally {
        if (!cancelled) setWishlistedArtistsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, artist]);

  const flashError = useCallback((key) => {
    setErrorKeys(prev => new Set(prev).add(key));
    clearTimeout(errorTimers.current[key]);
    errorTimers.current[key] = setTimeout(() => {
      setErrorKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      delete errorTimers.current[key];
    }, ERROR_FLASH_MS);
  }, []);

  const toggleSong = useCallback(async (songTitle) => {
    if (!user || !artist) return;
    const key = normalizeSongTitle(songTitle);
    if (!key || pendingKeys.has(key)) return;

    const alreadyWishlisted = !!wishlistMap[key];

    setErrorKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setPendingKeys(prev => new Set(prev).add(key));
    setWishlistMap(prev => {
      const next = { ...prev };
      if (alreadyWishlisted) {
        delete next[key];
      } else {
        next[key] = { title: songTitle, addedAt: new Date().toISOString() };
      }
      return next;
    });

    try {
      if (alreadyWishlisted) {
        await removeWishlistSong(user.uid, artist, songTitle);
      } else {
        await addWishlistSong(user.uid, artist, songTitle);
      }
    } catch (err) {
      // Surfaced, not swallowed: log the real Firestore error code and
      // revert the optimistic update so the star reflects what's actually
      // persisted, plus flash an inline + toast error on the row that failed.
      console.error(`[wishlist] toggle failed for "${songTitle}" (${err.code || 'unknown'}):`, err);
      setWishlistMap(prev => {
        const next = { ...prev };
        if (alreadyWishlisted) {
          next[key] = { title: songTitle, addedAt: new Date().toISOString() };
        } else {
          delete next[key];
        }
        return next;
      });
      flashError(key);
      setToast?.(
        err.code === 'permission-denied'
          ? "Couldn't save — you don't have permission to update your wishlist."
          : "Couldn't save your wishlist change. Please try again."
      );
    } finally {
      setPendingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [user, artist, wishlistMap, pendingKeys, flashError, setToast]);

  // ── No artist selected yet: wishlist hub (if any) + the artist picker ──
  if (!artist) {
    const hasWishlists = wishlistedArtists.length > 0;
    return (
      <div className="space-y-6">
        {!wishlistedArtistsLoading && hasWishlists && (
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Heart size={17} className="text-amber" strokeWidth={2.2} />
              <h3 className="font-bold text-primary">Your Wishlists</h3>
              <Badge tone="amber" size="sm">{wishlistedArtists.length}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {wishlistedArtists.map((a) => (
                <button
                  key={a.artistKey}
                  type="button"
                  onClick={() => setArtist({ name: a.artistName, mbid: a.artistMbid })}
                  className="flex flex-col items-start gap-1 px-4 py-3 rounded-xl bg-hover border border-transparent hover:border-amber/40 text-left transition-colors"
                >
                  <span className="font-semibold text-primary truncate w-full">{a.artistName}</span>
                  <span className="text-xs text-muted">{a.songCount} song{a.songCount !== 1 ? 's' : ''}</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card padding="lg">
          <EmptyState
            icon={Heart}
            tone="brand"
            title={hasWishlists ? 'Start a wishlist for another artist' : 'Pick an artist to get started'}
            body="Search for an artist to see the songs you've caught live and build a wishlist of the ones you haven't."
            action={<ArtistPicker onSelect={setArtist} />}
            className="py-0"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selected artist header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Artist</div>
          <div className="text-xl font-bold text-primary">{artist.name}</div>
        </div>
        <button
          type="button"
          onClick={() => setArtist(null)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-secondary hover:text-primary bg-hover rounded-xl transition-colors"
        >
          <SearchIcon size={15} strokeWidth={2.2} />
          Change artist
        </button>
      </div>

      {/* Section order is deliberate and stacked full-width (not columns):
          what you still want to catch first, the whole catalog second,
          what you've already seen last — which is also the order that reads
          best top-to-bottom on a phone. */}

      {/* 1 — Songs I want to see (the starred wishlist) */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-4">
          <Heart size={17} className="text-amber" strokeWidth={2.2} />
          <h3 className="font-bold text-primary">Songs I want to see</h3>
          <Badge tone="amber" size="sm">{wishlistEntries.length}</Badge>
        </div>
        {wishlistLoading ? (
          <div className="py-6"><Spinner size="sm" label="Loading your wishlist…" /></div>
        ) : wishlistEntries.length === 0 ? (
          <p className="text-sm text-secondary py-6 text-center">
            Star songs below to add them to your wishlist.
          </p>
        ) : (
          <ul className="space-y-1 max-h-96 overflow-y-auto pr-1">
            {wishlistEntries.map((s) => (
              <StarToggleRow
                key={s.key}
                title={s.title}
                subMeta={lastPlayedLabel(s.key)}
                checked
                pending={pendingKeys.has(s.key)}
                hasError={errorKeys.has(s.key)}
                onToggle={toggleSong}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* 2 — All songs: setlist.fm's live catalog for this artist unioned
          with everything you've logged (seen, unseen and wishlisted alike). */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-4">
          <Music size={17} className="text-brand" strokeWidth={2.2} />
          <h3 className="font-bold text-primary">All songs</h3>
          {!catalogLoading && allSongs.length > 0 && <Badge tone="green" size="sm">{allSongs.length}</Badge>}
          {catalogLoading && <Spinner size="sm" />}
        </div>

        {catalogError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load catalog"
            body={catalogError}
            action={
              <button
                type="button"
                onClick={() => setArtist({ ...artist })}
                className="flex items-center gap-2 px-4 py-2 bg-hover rounded-xl text-sm font-semibold text-primary hover:bg-active/20 transition-colors"
              >
                <RefreshCw size={14} strokeWidth={2.2} /> Try again
              </button>
            }
          />
        ) : catalogLoading ? (
          <div className="py-10"><Spinner size="md" label="Loading catalog from setlist.fm…" /></div>
        ) : allSongs.length === 0 ? (
          <p className="text-sm text-secondary py-6 text-center">
            No catalog data available for this artist.
          </p>
        ) : (
          <>
            {catalogSongs.length > 0 && catalogRemaining.length === 0 && (
              <p className="text-sm text-secondary pb-3 text-center">
                You&apos;ve seen everything setlist.fm has on record for this artist live. Nice.
              </p>
            )}
            <ul className="space-y-1 max-h-[32rem] overflow-y-auto pr-1" role="list">
              {allSongs.map((song) => (
                <StarToggleRow
                  key={song.key}
                  title={song.title}
                  meta={song.plays > 0 ? `played ${song.plays}×` : null}
                  subMeta={song.seenCount > 0 ? `you’ve seen this ${song.seenCount}×` : null}
                  checked={!!wishlistMap[song.key]}
                  pending={pendingKeys.has(song.key)}
                  hasError={errorKeys.has(song.key)}
                  onToggle={toggleSong}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* 3 — The songs I've seen */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-4">
          <Music size={17} className="text-brand" strokeWidth={2.2} />
          <h3 className="font-bold text-primary">The songs I&apos;ve seen</h3>
          <Badge tone="green" size="sm">{seenSongs.length}</Badge>
        </div>
        {seenSongs.length === 0 ? (
          <p className="text-sm text-secondary py-6 text-center">
            No logged shows for {artist.name} yet — songs you&apos;ve seen live will show up here.
          </p>
        ) : (
          <ul className="space-y-1 max-h-96 overflow-y-auto pr-1">
            {seenSongs.map((s) => {
              const notInCatalog = !catalogLoading && catalogSongs.length > 0 && !catalogNormalizedSet.has(normalizeSongTitle(s.title));
              const songSlug = songSlugFromTitle(s.title);
              const href = songSlug ? `/songs/?artist=${artistSlugFromName(artist.name)}&song=${songSlug}` : null;
              const RowTag = href ? Link : 'div';
              return (
                <li key={s.title}>
                  <RowTag
                    {...(href ? { href } : {})}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-hover text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <span className="text-sm text-primary min-w-0 truncate hover:text-brand hover:underline transition-colors">
                      {s.title}
                      {notInCatalog && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          no setlist.fm record
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-bold text-brand flex-shrink-0">{s.count}×</span>
                  </RowTag>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

    </div>
  );
}
