// hooks/useContentColumnWidth.js
//
// The measured width of the column a page actually gets, in the native app.
// 0 on the web, and before the first measurement, so anything comparing
// against it falls back to the layout the static HTML has.
//
// Native only, by decision: the web keeps its one-screen-at-a-time layout at
// every width. Inside the app it is purely a width test on
// AppProviderWrapper's [data-content-column], not a device check — so it
// follows iPad rotation, Split View and Slide Over, iPhone Duo folding and
// unfolding, and the sidebar appearing at md, without knowing about any of
// them.

'use client';

import { useEffect, useState } from 'react';
import { isNativePlatform } from '@/lib/platform';

export default function useContentColumnWidth() {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!isNativePlatform() || typeof ResizeObserver === 'undefined') return undefined;
    const column = document.querySelector('[data-content-column]');
    if (!column) return undefined;
    // contentRect is the content box, so the column's own padding is
    // already left out.
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  return width;
}
