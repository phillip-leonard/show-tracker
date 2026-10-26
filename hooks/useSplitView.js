// hooks/useSplitView.js
//
// Whether My Shows should show its list beside the open show: native app
// only, and only while the content column is at least SPLIT_VIEW_MIN_WIDTH
// wide (lib/platform.js).
//
// Native only, by decision: the web keeps its one-screen-at-a-time layout
// at every width. Inside the app it is purely a width test on the column
// the page actually gets (AppProviderWrapper's [data-content-column]), not
// a device check — so it follows iPhone Duo folding and unfolding, and the
// sidebar appearing at md, without knowing about either.

'use client';

import { useEffect, useState } from 'react';
import { SPLIT_VIEW_MIN_WIDTH, isNativePlatform } from '@/lib/platform';

export default function useSplitView() {
  // Starts false so the first client paint matches the static HTML.
  const [split, setSplit] = useState(false);

  useEffect(() => {
    if (!isNativePlatform() || typeof ResizeObserver === 'undefined') return undefined;
    const column = document.querySelector('[data-content-column]');
    if (!column) return undefined;
    // contentRect is the content box, so the column's own padding is
    // already left out.
    const observer = new ResizeObserver(([entry]) => {
      setSplit(entry.contentRect.width >= SPLIT_VIEW_MIN_WIDTH);
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  return split;
}
