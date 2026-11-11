'use client';

// components/yearInReview/YearSelector.jsx
//
// The year picker on your own Year in Review: every year you've logged a
// show in, plus the one being shown. Changing it replaces the URL
// (/year-in-review/?year=<yyyy>), keeping the admin ?recap=preview switch
// if it's there.

import React, { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export default function YearSelector({ year, className = '' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { availableYears } = useApp();
  const years = useMemo(() => {
    const set = new Set((availableYears || []).map(Number));
    set.add(Number(year));
    return [...set].filter(Boolean).sort((a, b) => b - a);
  }, [availableYears, year]);

  if (years.length < 2) return null;

  const go = (y) => {
    const preview = searchParams?.get('recap') === 'preview' ? '&recap=preview' : '';
    router.replace(`/year-in-review/?year=${y}${preview}`);
  };

  return (
    <div className={`flex items-center justify-end gap-2 ${className}`}>
      <label htmlFor="yir-year" className="text-sm text-secondary">Year</label>
      <select
        id="yir-year"
        value={year}
        onChange={(e) => go(e.target.value)}
        className="px-3 py-2 min-h-[44px] md:fine:min-h-0 rounded-xl border border-subtle bg-surface text-primary text-sm"
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
