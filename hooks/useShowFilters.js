// hooks/useShowFilters.js
//
// Local state for components/shows/ShowFilters.jsx on the pages that don't
// keep it in AppContext (Stats, Tours, Festivals). Picking a year clears the
// date and vice versa, the same as My Shows.

'use client';

import { useCallback, useMemo, useState } from 'react';
import { applyShowFilters, EMPTY_SHOW_FILTERS } from '@/lib/showFilters';

export default function useShowFilters(shows) {
  const [filters, setFilters] = useState(EMPTY_SHOW_FILTERS);

  const setSearchTerm = useCallback(searchTerm => setFilters(f => ({ ...f, searchTerm })), []);
  const setFilterYear = useCallback(filterYear => setFilters(f => ({ ...f, filterYear, filterDate: '' })), []);
  const setFilterDate = useCallback(filterDate => setFilters(f => ({ ...f, filterDate, filterYear: '' })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_SHOW_FILTERS), []);

  const filteredShows = useMemo(() => applyShowFilters(shows, filters), [shows, filters]);

  return { filters, setSearchTerm, setFilterYear, setFilterDate, clearFilters, filteredShows };
}
