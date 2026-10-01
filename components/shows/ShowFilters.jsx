// components/shows/ShowFilters.jsx
//
// The show filter card shared by My Shows, Stats, Tours and Festivals: text
// search (artist or venue), a Year dropdown, and a single-date picker. The
// matching logic is lib/showFilters.js; this is only the UI.
//
// On phones the card collapses behind a "Filters" toggle so content stays
// above the fold. A count badge shows how many filters are applied, and they
// keep applying while the panel is closed. From md: up the toggle is hidden
// and the panel always shows.
//
// Page-specific controls go in two slots: `actions` sits on the same row as
// the filters (My Shows' Advanced search link), and `children` renders below
// a divider inside the panel (My Shows' Sort and saved searches, Tours' Sort
// and Favorites). `extraActiveCount` lets those extras count toward the badge
// and the Clear button.

'use client';

import { useState } from 'react';
import { X, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button, Card, SearchField } from '@/components/ui';
import { countActiveShowFilters } from '@/lib/showFilters';

export default function ShowFilters({
  searchTerm,
  filterYear,
  filterDate,
  onSearchChange,
  onYearChange,
  onDateChange,
  onClear,
  availableYears = [],
  extraActiveCount = 0,
  actions = null,
  children = null,
  panelId = 'show-filter-panel',
}) {
  // Deliberately not persisted: every visit starts collapsed on phones.
  const [open, setOpen] = useState(false);
  const activeCount = countActiveShowFilters({ searchTerm, filterYear, filterDate }) + extraActiveCount;

  return (
    <Card padding="none" className="mb-4 md:mb-6 shadow-theme-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="md:hidden w-full flex items-center gap-2 px-4 py-2.5 min-h-touch text-left text-sm font-semibold text-secondary rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        <span className="text-primary">Filters</span>
        {activeCount > 0 && (
          <span className="bg-brand-subtle text-brand border border-brand/30 text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {activeCount}
            <span className="sr-only"> active</span>
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 ml-auto text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        className={`${open ? 'block border-t border-subtle' : 'hidden'} md:block md:border-t-0 p-4`}
      >
        <div className="flex gap-3 flex-wrap items-center">
          <SearchField
            value={searchTerm}
            onChange={onSearchChange}
            placeholder="Filter by artist or venue..."
            className="flex-1 min-w-[200px]"
          />

          {availableYears.length > 1 && (
            <select
              value={filterYear}
              onChange={(e) => onYearChange(e.target.value)}
              aria-label="Filter by year"
              className="px-3 py-2.5 bg-surface border border-subtle rounded-xl text-sm font-medium text-secondary focus:outline-none focus:ring-2 focus:ring-brand/50 cursor-pointer"
            >
              <option value="">All Years</option>
              {availableYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}

          <div className="relative">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => onDateChange(e.target.value)}
              aria-label="Filter by date"
              className="px-3 py-2.5 bg-surface border border-subtle rounded-xl text-sm font-medium text-secondary focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
          </div>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={onClear}
              className="text-danger hover:bg-danger/10"
            >
              Clear
            </Button>
          )}

          {actions}
        </div>

        {children && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-subtle flex-wrap">
            {children}
          </div>
        )}
      </div>
    </Card>
  );
}
