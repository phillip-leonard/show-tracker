// components/shows/ShowsSplitList.jsx
//
// The list pane of My Shows' split view (native app, wide content column —
// see hooks/useSplitView.js). A compact, scrollable column of the same
// shows the timeline is showing, filters and saved search included, with
// the open one marked. The full list page, with its stats and filters,
// is still what you get with no show open.

'use client';

import React, { useEffect, useRef } from 'react';
import { formatDate, artistColor } from '@/lib/utils';

export default function ShowsSplitList({ shows, selectedId, onSelect }) {
  const selectedRef = useRef(null);

  // Bring the open show into view when the pane first appears — opening
  // the 200th show shouldn't leave the list parked at the top.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
    // Only on mount: picking a show from the pane already has it in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      aria-label="Your shows"
      className={[
        'w-64 flex-shrink-0 sticky overflow-y-auto overscroll-contain',
        'bg-surface border border-subtle rounded-2xl',
        // Sticks under the mobile header below md, under the status bar
        // above it, and stays one viewport tall either way.
        'top-header md:top-safe-top',
        'max-h-[calc(100dvh_-_var(--mobile-header-h)_-_var(--safe-top)_-_var(--safe-bottom))]',
        'md:max-h-[calc(100dvh_-_var(--safe-top)_-_var(--safe-bottom))]',
      ].join(' ')}
    >
      <ul className="divide-y divide-subtle">
        {shows.map((show) => {
          const selected = show.id === selectedId;
          return (
            <li key={show.id} ref={selected ? selectedRef : undefined}>
              <button
                type="button"
                onClick={() => onSelect(show)}
                aria-current={selected ? 'page' : undefined}
                className={[
                  'w-full text-left px-3 py-2.5 min-h-touch transition-colors',
                  selected ? 'bg-brand-subtle' : 'hover:bg-hover active:bg-hover',
                ].join(' ')}
              >
                <div className="text-[14px] font-semibold truncate" style={{ color: artistColor(show.artist) }}>
                  {show.artist}
                </div>
                <div className="text-[12px] text-secondary truncate">
                  {formatDate(show.date)}
                  {show.venue && ` · ${show.venue}`}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
