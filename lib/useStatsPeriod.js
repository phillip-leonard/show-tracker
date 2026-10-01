// lib/useStatsPeriod.js
//
// Shared year/all-time period filter for the Stats pages (Overview, Top
// Artists, Top Venues). Centralized so each page filters the same `shows`
// list the same way instead of re-deriving it.
//
// Pass `sourceShows` to scope the period to an already-filtered set (the
// Overview's ShowFilters). If the selected year drops out of that set, the
// period falls back to the newest year still in it, or all-time.

'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { parseDate } from '@/lib/utils';

export function useStatsPeriod(sourceShows) {
  const { shows: allShows } = useApp();
  const shows = sourceShows || allShows;

  const availableYears = useMemo(() => {
    const years = new Set();
    shows.forEach(s => {
      const d = parseDate(s.date);
      if (d.getFullYear() > 1970) years.add(d.getFullYear());
    });
    return [...years].sort((a, b) => b - a);
  }, [shows]);

  const [selectedPeriod, setPeriod] = useState(() => availableYears[0] ? String(availableYears[0]) : 'all-time');
  const period = selectedPeriod === 'all-time' || availableYears.includes(Number(selectedPeriod))
    ? selectedPeriod
    : (availableYears[0] ? String(availableYears[0]) : 'all-time');

  const periodShows = useMemo(() => {
    if (period === 'all-time') return shows;
    return shows.filter(s => {
      const d = parseDate(s.date);
      return d.getFullYear() === Number(period);
    });
  }, [shows, period]);

  const periodLabels = [...availableYears.map(String), 'all-time'];

  return { shows, period, setPeriod, periodShows, periodLabels, availableYears };
}
