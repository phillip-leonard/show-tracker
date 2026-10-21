// components/stats/YearHeatmap.jsx
//
// 12-month heatmap of shows-per-month. Auto-buckets counts into 4 heat levels.
//
//   <YearHeatmap counts={[3, 4, 7, 5, 11, 14, 8, 9, 8, 6, 6, 3]} year={2024} />

import React from 'react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function level(n, max) {
  if (n <= 0) return 0;
  if (max <= 0) return 1;
  const pct = n / max;
  if (pct >= 0.85) return 4; // hot
  if (pct >= 0.6)  return 3; // warm
  if (pct >= 0.35) return 2; // cool
  return 1;                  // mild
}

const LEVEL_CLS = {
  0: 'bg-hover text-muted',
  1: 'bg-brand-subtle text-brand',
  2: 'bg-brand-light text-[#2a2a4e]',
  3: 'bg-brand text-[#2a2a4e]',
  4: 'bg-[#8a6d00] text-[#f5f5f5]',
};

export default function YearHeatmap({ counts = [], year, className = '' }) {
  const max = Math.max(1, ...counts);
  return (
    <div className={className}>
      <div className="grid grid-cols-12 gap-[3px] mb-2">
        {MONTHS.map((_, i) => (
          <div
            key={i}
            className={`aspect-square rounded flex items-center justify-center text-[10px] font-extrabold ${LEVEL_CLS[level(counts[i] || 0, max)]}`}
          >
            {counts[i] || 0}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-12 text-[10px] font-bold text-muted tracking-[0.1em] uppercase text-center">
        {MONTHS.map((m) => <span key={m}>{m}</span>)}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted font-semibold">
        <span>{year ? `${year} · ${counts.reduce((a, b) => a + b, 0)} shows` : ''}</span>
        {/* What the shades mean: a month's shows relative to the busiest
            month shown, from none to the busiest (gold). */}
        <span className="flex items-center gap-1" aria-label="Shade shows how busy a month was, from no shows to the busiest month">
          Fewer
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`inline-block w-2.5 h-2.5 rounded-sm ${LEVEL_CLS[l]}`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
