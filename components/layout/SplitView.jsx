// components/layout/SplitView.jsx
//
// The split view's two panes (native app, wide content column — see
// hooks/useSplitView.js): a compact, scrollable list on the left with the
// open item marked, and that item's detail view on the right. The screen's
// full list page, with its stats and filters, is still what you get with
// nothing open.
//
// `items` are { id, title, subtitle, titleColor }.

'use client';

import React, { useEffect, useRef } from 'react';

function SplitViewList({ label, items, selectedId, onSelect }) {
  const selectedRef = useRef(null);

  // Bring the open item into view when the pane first appears — opening
  // the 200th show shouldn't leave the list parked at the top.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
    // Only on mount: picking an item from the pane already has it in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      aria-label={label}
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
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li key={item.id} ref={selected ? selectedRef : undefined}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={selected ? 'page' : undefined}
                className={[
                  'w-full text-left px-3 py-2.5 min-h-touch transition-colors',
                  selected ? 'bg-brand-subtle' : 'hover:bg-hover active:bg-hover',
                ].join(' ')}
              >
                <div
                  className={`text-[14px] font-semibold truncate ${item.titleColor ? '' : 'text-primary'}`}
                  style={item.titleColor ? { color: item.titleColor } : undefined}
                >
                  {item.title}
                </div>
                <div className="text-[12px] text-secondary truncate">{item.subtitle}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function SplitView({ label, items, selectedId, onSelect, children }) {
  return (
    <div className="flex items-start gap-4">
      <SplitViewList label={label} items={items} selectedId={selectedId} onSelect={onSelect} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
