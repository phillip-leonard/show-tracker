// components/layout/MobileHeader.jsx
//
// The one header every small screen gets. Three regions:
//
//   leading   — back control, or the drawer button on a tab root
//   title     — truncates with an ellipsis rather than wrapping or shoving
//               the actions off-screen
//   trailing  — up to two contextual actions
//
// Mounted once, globally, in app/AppProviderWrapper.jsx. It derives what to
// show from the route (lib/navRoutes.js) rather than from each page passing
// props, which is why ~19 screens that had no back affordance at all now
// have one without being edited individually.
//
// LARGE TITLES. Not implemented as a scroll-driven collapse. The compact
// title here fades in only once the page's own <PageHeader> title has
// scrolled out of view, detected with an IntersectionObserver on a
// sentinel — one state flip per crossing, not a re-render per frame. That
// gets the "title appears when you scroll past it" behaviour that reads as
// native, without a scroll handler and without fighting the sticky filter
// bars several screens already have. A genuinely collapsing large title was
// not worth the jank it risked here.
//
// Desktop and tablet never see this: `md:hidden`, same as before.

'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Menu } from 'lucide-react';
import Pick from '../brand/Pick';
import Wordmark, { BRAND_LOCKUP } from '../brand/Wordmark';
import { resolveRoute } from '@/lib/navRoutes';
import { useDismissStack } from '@/context/DismissStackContext';

/** Longest parent name we will spell out next to the chevron. */
const MAX_BACK_LABEL = 12;

function useTitleRevealed() {
  // True once the page's own large title has scrolled away — or immediately,
  // on screens that have no <PageHeader> to observe.
  const [revealed, setRevealed] = useState(true);
  const pathname = usePathname();
  // The query string swaps the rendered screen on /songs, /runs, /tours and
  // /meetups, so the sentinel has to be looked up again when it changes.
  const search = useSearchParams()?.toString() || '';

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    let observer;
    // The page renders after this header does, so look on the next frame
    // rather than assuming the sentinel already exists.
    const raf = requestAnimationFrame(() => {
      const sentinel = document.querySelector('[data-page-title]');
      if (!sentinel) {
        setRevealed(true);
        return;
      }
      setRevealed(false);
      observer = new IntersectionObserver(
        ([entry]) => setRevealed(!entry.isIntersecting),
        { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
      );
      observer.observe(sentinel);
    });

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [pathname, search]);

  return revealed;
}

export default function MobileHeader({ onMenuClick, actions = null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canGoBack } = useDismissStack();
  const titleRevealed = useTitleRevealed();

  // Search params matter: /songs?song=x is a song, not the song list, and
  // its back control has to return to the list.
  const { title, isRoot, parentHref, parentTitle } = resolveRoute(pathname, searchParams);

  const backLabel =
    parentTitle && parentTitle.length <= MAX_BACK_LABEL ? parentTitle : null;

  const goBack = (e) => {
    // In-app history is the nicer trip — it restores scroll position and
    // whatever state the parent had. With none (a cold launch straight into
    // a detail route, a shared link, a notification) router.back() would
    // either do nothing or leave the app, so fall back to the route's
    // declared parent, which always exists.
    if (canGoBack) {
      e.preventDefault();
      router.back();
    }
    // Otherwise let the <Link> navigate to parentHref normally.
  };

  return (
    <header
      className={[
        'md:hidden fixed top-0 left-0 right-0 z-40',
        'bg-surface/90 backdrop-blur-xl border-b border-subtle',
        'pt-safe-top',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 px-1 h-14">
        {/* Leading */}
        <div className="flex-shrink-0">
          {isRoot ? (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Open menu"
              className="tap-target rounded-xl text-primary hover:bg-hover active:bg-hover transition-colors"
            >
              <Menu size={22} strokeWidth={2.2} />
            </button>
          ) : (
            <Link
              href={parentHref || '/shows'}
              onClick={goBack}
              aria-label={backLabel ? `Back to ${backLabel}` : 'Go back'}
              className={[
                'tap-target rounded-xl text-brand hover:bg-hover active:bg-hover transition-colors',
                backLabel ? 'gap-0.5 pr-2.5' : '',
              ].join(' ')}
            >
              <ChevronLeft size={24} strokeWidth={2.4} />
              {backLabel && (
                <span className="text-[15px] font-semibold leading-none">{backLabel}</span>
              )}
            </Link>
          )}
        </div>

        {/* Title — on a tab root the brand lockup stands in for it, so the
            app still identifies itself on the screens you land on. */}
        <div className="flex-1 min-w-0 flex items-center justify-center px-1">
          {isRoot ? (
            <Link href="/" className="flex items-center gap-1.5" aria-label="MySetlists home">
              <Pick size={BRAND_LOCKUP.mobileHeader.pick} />
              <Wordmark size={BRAND_LOCKUP.mobileHeader.wordmark} />
            </Link>
          ) : (
            <h1
              className={[
                'text-[16px] font-bold text-primary truncate text-center',
                'transition-opacity duration-200',
                titleRevealed ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              {title}
            </h1>
          )}
        </div>

        {/* Trailing — up to two actions. Always occupies at least the width
            of one control so the title stays optically centred. */}
        <div className="flex-shrink-0 flex items-center justify-end gap-0.5 min-w-[44px]">
          {actions}
        </div>
      </div>
    </header>
  );
}
