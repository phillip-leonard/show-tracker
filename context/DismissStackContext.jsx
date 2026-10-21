// context/DismissStackContext.jsx
//
// Two things the back gesture and the back button both need, and neither
// of which the app tracked before:
//
//   1. THE DISMISS STACK. On release, the gesture has to answer "what is
//      the topmost dismissable thing right now?" LIFO, so a sheet opened
//      over a modal closes first. Every overlay registers with
//      useDismissable(); the gesture is only as good as its worst-covered
//      overlay.
//
//   2. IN-APP NAVIGATION DEPTH. "Can we go back?" must not come from
//      window.history.length — in a Capacitor SPA it is never zero and
//      counts entries that are not ours, so it reports "yes" on a cold
//      deep link where going back leaves the app. Instead we keep our own
//      stack of visited paths. Depth 0 means there is nothing of ours to
//      go back to.
//
// Root routes (lib/navRoutes.js ROOT_ROUTES) reset the stack, which is what
// makes them floors: you can never swipe back out of one.

'use client';

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { isRootRoute, normalizePath } from '@/lib/navRoutes';
import SearchParamsListener from '@/components/SearchParamsListener';

const DismissStackContext = createContext(null);

let autoId = 0;

export function DismissStackProvider({ children }) {
  // The live stack. Kept in a ref because the gesture layer reads it at
  // pointerup, where a stale closure would pop the wrong overlay; `depth`
  // mirrors its length for anything that needs to re-render on change.
  const stackRef = useRef([]);
  const [depth, setDepth] = useState(0);

  const historyRef = useRef([]);
  const [navDepth, setNavDepth] = useState(0);

  // Several screens select a detail view by query string rather than by
  // path (/songs?song=x renders SongDetailView, /meetups?id=x a meetup).
  // usePathname alone cannot see those, so navigating into one would not
  // count as a step and back would skip the list it came from.
  //
  // Both arrive from <SearchParamsListener> rather than from hooks here:
  // this provider wraps every route, and useSearchParams() here kept every
  // page out of the static HTML (see that file). The listener reports
  // pathname and query together, so a navigation is never recorded as a
  // new path with the old query.
  const recordLocation = useCallback((searchParams, pathname) => {
    const search = searchParams?.toString() || '';
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
  }, []);

  const push = useCallback((entry) => {
    stackRef.current = [...stackRef.current, entry];
    setDepth(stackRef.current.length);
  }, []);

  const remove = useCallback((id) => {
    stackRef.current = stackRef.current.filter((e) => e.id !== id);
    setDepth(stackRef.current.length);
  }, []);

  /**
   * Dismiss the topmost overlay. Returns true if there was one.
   *
   * The entry is removed here as well as by the overlay's own unmount
   * cleanup — an overlay that ignores its onDismiss would otherwise sit at
   * the top of the stack forever and swallow every subsequent gesture.
   */
  const popTop = useCallback(() => {
    const stack = stackRef.current;
    if (stack.length === 0) return false;
    const top = stack[stack.length - 1];
    stackRef.current = stack.slice(0, -1);
    setDepth(stackRef.current.length);
    try {
      top.dismiss?.();
    } catch (e) {
      console.warn('Dismissable threw on dismiss:', e);
    }
    return true;
  }, []);

  const value = useMemo(
    () => ({ push, remove, popTop, depth, navDepth, canGoBack: navDepth > 0 }),
    [push, remove, popTop, depth, navDepth],
  );

  return (
    <DismissStackContext.Provider value={value}>
      <SearchParamsListener onChange={recordLocation} />
      {children}
    </DismissStackContext.Provider>
  );
}

/**
 * Read the stack. Safe to call with no provider mounted (desktop, tests):
 * reports an empty stack and no history rather than throwing.
 */
export function useDismissStack() {
  const ctx = useContext(DismissStackContext);
  return ctx || EMPTY_STACK;
}

const EMPTY_STACK = {
  push: () => {},
  remove: () => {},
  popTop: () => false,
  depth: 0,
  navDepth: 0,
  canGoBack: false,
};

/**
 * Register an overlay as dismissable while it is open.
 *
 *   useDismissable(isOpen, onClose, { id: 'venue-rating' });
 *
 * Pushes on open, pops on close or unmount. `onDismiss` is read through a
 * ref, so an inline arrow function does not churn the stack on every
 * render of the host component.
 */
export function useDismissable(isOpen, onDismiss, options = {}) {
  const ctx = useContext(DismissStackContext);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const idRef = useRef(null);
  if (idRef.current === null) {
    autoId += 1;
    idRef.current = options.id || `dismissable-${autoId}`;
  }

  const { push, remove } = ctx || EMPTY_STACK;

  useEffect(() => {
    if (!ctx || !isOpen) return undefined;
    const id = idRef.current;
    push({ id, dismiss: () => onDismissRef.current?.() });
    return () => remove(id);
  }, [ctx, isOpen, push, remove]);
}

export default DismissStackContext;
