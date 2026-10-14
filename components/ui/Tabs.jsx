// components/ui/Tabs.jsx
//
// Underline-style tab bar. Controlled, or route-backed via `href` per tab.
//
// Usage (controlled, in-page state):
//   <Tabs value={tab} onChange={setTab} tabs={[
//     { id: 'shows', label: 'Shows', count: 87 },
//     { id: 'wishlist', label: 'Wishlist', count: 12 },
//     { id: 'upcoming', label: 'Upcoming' },
//   ]} />
//
// Usage (route-backed sub-nav — pass `href` instead of relying on onChange):
//   <Tabs value="top-artists" tabs={[
//     { id: 'overview', label: 'Overview', href: '/stats' },
//     { id: 'top-artists', label: 'Top Artists', href: '/stats/top-artists' },
//   ]} />
//
// Pass `badge` (a number > 0) on a tab for an attention dot, e.g. pending
// requests — separate from `count`, which is just an informational total.

import React from 'react';
import Link from 'next/link';

export default function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 border-b border-subtle overflow-x-auto scrollbar-hide ${className}`}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        const As = t.href ? Link : 'button';
        const extraProps = t.href
          ? { href: t.href }
          : { type: 'button', onClick: () => onChange?.(t.id) };
        return (
          <As
            key={t.id}
            role="tab"
            aria-selected={active}
            className={[
              'relative flex items-center gap-2 px-4 py-3 text-[14px] font-semibold whitespace-nowrap transition-colors',
              active ? 'text-primary' : 'text-muted hover:text-secondary',
            ].join(' ')}
            {...extraProps}
          >
            {t.icon && <t.icon size={15} strokeWidth={2.2} />}
            <span>{t.label}</span>
            {typeof t.count === 'number' && (
              <span
                className={[
                  'text-[11px] font-bold px-1.5 py-0.5 rounded-md',
                  active ? 'bg-brand-subtle text-brand' : 'bg-hover text-muted',
                ].join(' ')}
              >
                {t.count}
              </span>
            )}
            {active && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 bg-brand rounded-full" />
            )}
            {t.badge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-danger text-on-dark text-[10px] font-bold rounded-full px-1">
                {t.badge}
              </span>
            )}
          </As>
        );
      })}
    </div>
  );
}
