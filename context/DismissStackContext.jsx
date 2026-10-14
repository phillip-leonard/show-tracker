// context/DismissStackContext.jsx
//
// In-app navigation depth, for the back control.
//
// "Can we go back?" must not come from window.history.length — in a
// Capacitor SPA it is never zero and counts entries that are not ours, so
// it reports "yes" on a cold deep link where going back leaves the app.
// Instead we keep our own stack of visited paths. Depth 0 means there is
// nothing of ours to go back to.
//
// Root routes (lib/navRoutes.js ROOT_ROUTES) reset the stack, which is what
// makes them floors: back never leaves one.
//
// The name is historical: this used to also hold a stack of open overlays
// for the edge-swipe-back gesture, which was removed in 5.43.1.

'use client';

import React, {
  createContext, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isRootRoute, normalizePath } from '@/lib/navRoutes';

const DismissStackContext = createContext(null);

export function DismissStackProvider({ children }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const historyRef = useRef([]);
  const [navDepth, setNavDepth] = useState(0);

  // Several screens select a detail view by query string rather than by
  // path (/songs?song=x renders SongDetailView, /meetups?id=x a meetup).
  // usePathname alone cannot see those, so navigating into one would not
  // count as a step and back would skip the list it came from.
  const search = searchParams?.toString() || '';

  useEffect(() => {
    const path = search ? `${normalizePath(pathname)}?${search}` : normalizePath(pathname);
    const history = historyRef.current;

    // A root is only a floor when it carries no query state of its own.
    if (!search && isRootRoute(path)) {
      // Arriving at a root is arriving at a floor: nothing behind it.
      historyRef.current = [path];
    } else if (history[history.length - 1] === path) {
      // Re-render on the same path — not a navigation.
      return;
    } else if (history.length >= 2 && history[history.length - 2] === path) {
      // We went back: drop the entry we came from rather than counting the
      // return trip as another forward step.
      history.pop();
    } else {
      history.push(path);
    }

    setNavDepth(Math.max(0, historyRef.current.length - 1));
  }, [pathname, search]);

  const value = useMemo(
    () => ({ navDepth, canGoBack: navDepth > 0 }),
    [navDepth],
  );

  return (
    <DismissStackContext.Provider value={value}>{children}</DismissStackContext.Provider>
  );
}

/**
 * Read the navigation depth. Safe to call with no provider mounted
 * (desktop, tests): reports no history rather than throwing.
 */
export function useDismissStack() {
  const ctx = useContext(DismissStackContext);
  return ctx || EMPTY_STACK;
}

const EMPTY_STACK = {
  navDepth: 0,
  canGoBack: false,
};

export default DismissStackContext;
