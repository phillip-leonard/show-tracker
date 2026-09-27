// components/ui/StatFigure.jsx
//
// Single stat numeral + label, no box chrome of its own. Extracted from
// ProfileHero so any page can reuse the same value/label typography.
//
//   <StatFigure value={87} label="Shows" />
//
// `compact` shrinks the numeral and label on phones only (below md:), for a
// four-across stat row; from md: up it renders exactly like the default.

import React from 'react';

export default function StatFigure({ value, label, compact = false, className = '' }) {
  return (
    <div className={className}>
      <div className={`${compact ? 'text-[18px] md:text-[22px]' : 'text-[22px]'} font-extrabold tracking-[-0.02em]`}>{value}</div>
      <div
        className={compact
          ? 'text-[10px] md:text-[11px] text-muted font-semibold tracking-[0.04em] md:tracking-[0.08em] uppercase max-md:whitespace-nowrap'
          : 'text-[11px] text-muted font-semibold tracking-[0.08em] uppercase'}
      >
        {label}
      </div>
    </div>
  );
}
