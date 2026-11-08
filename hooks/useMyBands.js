// hooks/useMyBands.js
//
// The signed-in user's bands as lib/recommendations.js sees them: every band
// they follow or have seen, keyed the way the nightly job keys them, plus
// their seed list (heaviest first) and "not interested" list. Shared by
// Discover, the band screens' "Fans of X also see…" and festival picks.
//
// Seeds change as soon as the user follows, unfollows or logs a show; the
// shared aggregate catches up on the next nightly run.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { profileBands, seedsFor } from '@/lib/recommendations';
import { loadDismissed, dismissBand, undismissBand } from '@/lib/discover';

export default function useMyBands() {
  const { user, guestMode, shows, showsLoadedFor, favoriteArtists, setToast } = useApp();
  const uid = user && !guestMode ? user.uid : null;
  const ready = !!uid && showsLoadedFor === uid;

  const bands = useMemo(
    () => (uid ? profileBands({ favorites: favoriteArtists || [], shows: shows || [] }) : new Map()),
    [uid, favoriteArtists, shows]
  );
  const seeds = useMemo(() => seedsFor(bands), [bands]);

  const [dismissed, setDismissed] = useState([]);
  useEffect(() => {
    if (!uid) { setDismissed([]); return undefined; }
    let live = true;
    loadDismissed(uid).then((d) => { if (live) setDismissed(d); }).catch(() => {});
    return () => { live = false; };
  }, [uid]);

  const dismiss = useCallback(async (key) => {
    if (!uid) return;
    setDismissed((d) => (d.includes(key) ? d : [...d, key]));
    try {
      await dismissBand(uid, key);
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err);
      setDismissed((d) => d.filter((k) => k !== key));
      setToast?.({ message: "Couldn't hide that band. Please try again.", type: 'error' });
    }
  }, [uid, setToast]);

  const undismiss = useCallback(async (key) => {
    if (!uid) return;
    setDismissed((d) => d.filter((k) => k !== key));
    try {
      await undismissBand(uid, key);
    } catch (err) {
      console.error('Failed to restore suggestion:', err);
    }
  }, [uid]);

  return { uid, ready, bands, seeds, dismissed, dismiss, undismiss };
}
