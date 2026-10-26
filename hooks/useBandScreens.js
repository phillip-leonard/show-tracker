// hooks/useBandScreens.js
//
// React side of lib/bandScreens.js: which bands have a band screen, a
// band's and a song's snapshot JSON with loading and error states, and the
// user's own side of a band, memoized on `shows`.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import {
  loadBandIndex, bandForArtist, loadBand, loadBandSong, cachedBand, cachedBandSong,
  buildBandPersonal, songSlugIndex, songSlugFor,
} from '@/lib/bandScreens';
import { bandSongHref } from '@/lib/showRouting';

/**
 * (artistName) => band | null: the band with a band screen for an artist
 * name. Everything resolves to null until /api/artists has loaded, so an
 * entry point only ever appears for a band that has one.
 */
export function useBandFor() {
  const [index, setIndex] = useState(null);
  useEffect(() => {
    let live = true;
    loadBandIndex().then((loaded) => { if (live) setIndex(loaded); });
    return () => { live = false; };
  }, []);
  return useCallback((artistName) => bandForArtist(index, artistName), [index]);
}

/** { status: 'loading' | 'ready' | 'error', data, error, retry } */
function useLoad(key, cached, load) {
  const [state, setState] = useState(() => {
    const hit = key ? cached() : null;
    return hit ? { status: 'ready', data: hit, error: null } : { status: key ? 'loading' : 'idle', data: null, error: null };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) { setState({ status: 'idle', data: null, error: null }); return undefined; }
    const hit = cached();
    if (hit) { setState({ status: 'ready', data: hit, error: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null, error: null });
    load()
      .then((data) => { if (live) setState({ status: 'ready', data, error: null }); })
      .catch((error) => { if (live) setState({ status: 'error', data: null, error }); });
    return () => { live = false; };
    // `cached` and `load` are rebuilt every render from `key`'s parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** A band's /api/artist response. Pass a falsy slug to load nothing. */
export function useBandData(slug) {
  return useLoad(slug || null, () => cachedBand(slug), () => loadBand(slug));
}

/** One song's /api/artist-song response. */
export function useBandSongData(slug, songSlug) {
  const key = slug && songSlug ? `${slug}/${songSlug}` : null;
  return useLoad(key, () => cachedBandSong(slug, songSlug), () => loadBandSong(slug, songSlug));
}

/** The user's own side of a band (lib/bandScreens.js buildBandPersonal). */
export function useBandPersonal(band) {
  const { shows } = useApp();
  return useMemo(() => (band ? buildBandPersonal(shows || [], band) : null), [shows, band]);
}

/**
 * For a setlist: (title) => the band's song screen for that title, or null
 * when the band has no screen, no song pages, or no such song (callers fall
 * back to the in-app /songs/ page). Loads the band's JSON only for a band
 * with song pages.
 */
export function useBandSongHref(artistName) {
  const bandFor = useBandFor();
  const band = artistName ? bandFor(artistName) : null;
  const { data } = useBandData(band?.songPages ? band.slug : null);
  const slugs = useMemo(() => (band && data ? songSlugIndex(data, band) : null), [band, data]);
  return useCallback((title) => {
    if (!band || !slugs) return null;
    const songSlug = songSlugFor(slugs, band, title);
    return songSlug ? bandSongHref(band.slug, songSlug) : null;
  }, [band, slugs]);
}
