'use client';

// Reports the current search params (and pathname) to a callback, without
// costing the page its static HTML.
//
// WHY THIS EXISTS. In a static export, calling useSearchParams() while the
// page pre-renders opts everything up to the nearest <Suspense> out of
// pre-rendering. AppProvider and DismissStackProvider wrap every route and
// both used to call it, so every file in out/ was the root layout's
// "Loading..." fallback — /terms and the landing page included, and that
// fallback is all Google indexed.
//
// The reader here mounts only after hydration, so useSearchParams() is
// never called at build time at all. (A leaf in its own <Suspense> would
// also have kept the page content, but it still writes an empty
// BAILOUT_TO_CLIENT_SIDE_RENDERING boundary into every file, which hides
// a real regression from anyone grepping out/ for it.) There are no query
// params at build time anyway, so nothing is lost.
//
// The callback runs in an effect, so a provider that used to read the
// params during render now gets them a commit or two later. Both callers
// only ever used them in effects, so nothing observes the difference.
// Pathname is reported alongside so a caller that needs both sees them
// change together, never a new path with the old query.

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function Reader({ onChange }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    onChange(searchParams, pathname);
  }, [searchParams, pathname, onChange]);

  return null;
}

/**
 * @param {{ onChange: (searchParams: URLSearchParams|null, pathname: string) => void }} props
 *   `onChange` must be stable (a state setter or a useCallback), or it runs
 *   on every render.
 */
export default function SearchParamsListener({ onChange }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Reader onChange={onChange} /> : null;
}
