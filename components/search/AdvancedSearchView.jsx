// components/search/AdvancedSearchView.jsx
//
// Advanced search over the user's own logged shows — a superset of the
// basic artist/venue text filter already on the Shows page (see
// app/shows/page.jsx / context/AppContext.jsx's sortedFilteredShows).

'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Bookmark, Clock, ChevronDown } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import useRunIndex, { useTourIndex } from '@/hooks/useRunIndex';
import { EMPTY_FILTERS, filterShows, hasActiveFilters } from '@/lib/advancedSearch';
import { getSavedSearches, addSavedSearch, deleteSavedSearch, getSearchHistory, pushSearchHistory } from '@/lib/savedSearches';
import { Card, Button, Input, Select, PageHeader, EmptyState } from '@/components/ui';
import ShowCard from '@/components/shows/ShowCard';
import { showHref } from '@/lib/showRouting';
import { today as localToday, compareShowDates } from '@/lib/showDate';

const MATCH_LABELS = {
  notes: 'matched your notes',
  song: 'matched a song in the setlist',
  friend: 'matched tagged friend',
};

function todayISO() {
  return localToday();
}

function startOfYearISO(yearOffset = 0) {
  const y = new Date().getFullYear() + yearOffset;
  return `${y}-01-01`;
}

function endOfYearISO(yearOffset = 0) {
  const y = new Date().getFullYear() + yearOffset;
  return `${y}-12-31`;
}

function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function summarizeFilters(filters, tourIndex, festivalById, friends) {
  const parts = [];
  if (filters.artist) parts.push(filters.artist);
  if (filters.venue) parts.push(`@ ${filters.venue}`);
  if (filters.city) parts.push(filters.city);
  if (filters.country) parts.push(filters.country);
  if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`);
  if (filters.tourKey && tourIndex[filters.tourKey]) parts.push(`tour: ${tourIndex[filters.tourKey].tourName}`);
  if (filters.festivalKey && festivalById.get(filters.festivalKey)) parts.push(`festival: ${festivalById.get(filters.festivalKey).name}`);
  if (filters.minRating > 0) parts.push(`${filters.minRating}★+`);
  if (filters.notes) parts.push(`notes: "${filters.notes}"`);
  if (filters.friendUid) {
    const f = friends.find(fr => fr.friendUid === filters.friendUid);
    parts.push(`with ${f?.friendName || 'friend'}`);
  }
  if (filters.song) parts.push(`song: "${filters.song}"`);
  return parts.join(' · ');
}

export default function AdvancedSearchView() {
  const { user, shows, friends, festivals } = useApp();
  const router = useRouter();
  const tourIndex = useTourIndex();
  const festivalById = useMemo(() => new Map((festivals || []).map(f => [f.id, f])), [festivals]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('date-desc');
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [savedSearches, setSavedSearches] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!user) return;
    setSavedSearches(getSavedSearches(user.uid));
    setHistory(getSearchHistory(user.uid));
  }, [user]);

  const set = (key) => (e) => setFilters(prev => ({ ...prev, [key]: e?.target ? e.target.value : e }));

  const artistOptions = useMemo(() => Array.from(new Set(shows.map(s => s.artist).filter(Boolean))).sort(), [shows]);
  const venueOptions = useMemo(() => Array.from(new Set(shows.map(s => s.venue).filter(Boolean))).sort(), [shows]);
  const cityOptions = useMemo(() => Array.from(new Set(shows.map(s => s.city).filter(Boolean))).sort(), [shows]);

  const tourOptions = useMemo(
    () => Object.values(tourIndex).sort((a, b) => a.tourName.localeCompare(b.tourName)),
    [tourIndex]
  );
  const festivalOptions = useMemo(
    () => (festivals || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [festivals]
  );

  const tourShowIds = useMemo(() => {
    if (!filters.tourKey || !tourIndex[filters.tourKey]) return null;
    return new Set(tourIndex[filters.tourKey].stops.map(s => s.showId));
  }, [filters.tourKey, tourIndex]);

  const festivalShowIds = useMemo(() => {
    if (!filters.festivalKey) return null;
    return new Set(shows.filter(s => s.festivalId === filters.festivalKey).map(s => s.id));
  }, [filters.festivalKey, shows]);

  const active = hasActiveFilters(filters);

  const results = useMemo(() => {
    if (!active) return [];
    const matched = filterShows(shows, filters, { tourShowIds, festivalShowIds });
    const sorted = matched.slice();
    sorted.sort((a, b) => {
      if (sortBy === 'date-asc') return compareShowDates(a.show.date, b.show.date);
      if (sortBy === 'rating-desc') return (b.show.rating || 0) - (a.show.rating || 0);
      if (sortBy === 'artist') return a.show.artist.localeCompare(b.show.artist);
      return compareShowDates(b.show.date, a.show.date); // date-desc default
    });
    return sorted;
  }, [active, shows, filters, tourShowIds, festivalShowIds, sortBy]);

  const runIndex = useRunIndex();
  const runInfoByShowId = useMemo(() => {
    const map = new Map();
    Object.values(runIndex).forEach(run => {
      run.nights.forEach((night, i) => {
        map.set(night.showId, { runKey: run.key, nightNumber: i + 1, nightCount: run.nightCount });
      });
    });
    return map;
  }, [runIndex]);

  const applyQuickFilter = (preset) => {
    if (preset === 'this-month') {
      setFilters(prev => ({ ...prev, dateFrom: startOfMonthISO(), dateTo: todayISO() }));
    } else if (preset === 'this-year') {
      setFilters(prev => ({ ...prev, dateFrom: startOfYearISO(0), dateTo: endOfYearISO(0) }));
    } else if (preset === 'last-year') {
      setFilters(prev => ({ ...prev, dateFrom: startOfYearISO(-1), dateTo: endOfYearISO(-1) }));
    }
  };

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const runSearch = () => {
    if (!user || !active) return;
    const summary = summarizeFilters(filters, tourIndex, festivalById, friends);
    setHistory(pushSearchHistory(user.uid, summary));
  };

  const handleSave = () => {
    if (!user || !saveName.trim()) return;
    setSavedSearches(addSavedSearch(user.uid, { name: saveName.trim(), filters }));
    setSaveName('');
    setShowSaveInput(false);
  };

  const handleDeleteSaved = (name) => {
    if (!user) return;
    setSavedSearches(deleteSavedSearch(user.uid, name));
  };

  const goToShow = (show) => {
    router.push(showHref(show.id));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader eyebrow="Search" title="Advanced search" />

      <Card padding="md" className="mb-6">
        <div className="flex flex-wrap gap-2 mb-5">
          <Button size="sm" variant="ghost" onClick={() => applyQuickFilter('this-month')}>This month</Button>
          <Button size="sm" variant="ghost" onClick={() => applyQuickFilter('this-year')}>This year</Button>
          <Button size="sm" variant="ghost" onClick={() => applyQuickFilter('last-year')}>Last year</Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Artist"
            list="advsearch-artists"
            value={filters.artist}
            onChange={set('artist')}
            placeholder="Any artist"
          />
          <datalist id="advsearch-artists">
            {artistOptions.map(a => <option key={a} value={a} />)}
          </datalist>

          <Input
            label="Venue"
            list="advsearch-venues"
            value={filters.venue}
            onChange={set('venue')}
            placeholder="Any venue"
          />
          <datalist id="advsearch-venues">
            {venueOptions.map(v => <option key={v} value={v} />)}
          </datalist>

          <Input
            label="City"
            list="advsearch-cities"
            value={filters.city}
            onChange={set('city')}
            placeholder="Any city"
          />
          <datalist id="advsearch-cities">
            {cityOptions.map(c => <option key={c} value={c} />)}
          </datalist>

          <Input
            label="Country"
            value={filters.country}
            onChange={set('country')}
            placeholder="Any country"
          />

          <Input
            label="From date"
            type="date"
            value={filters.dateFrom}
            onChange={set('dateFrom')}
          />
          <Input
            label="To date"
            type="date"
            value={filters.dateTo}
            onChange={set('dateTo')}
          />

          <Select
            label="Tour"
            value={filters.tourKey}
            onChange={set('tourKey')}
            options={[{ value: '', label: 'Any tour' }, ...tourOptions.map(t => ({ value: t.key, label: `${t.tourName} (${t.artistName})` }))]}
          />

          <Select
            label="Festival"
            value={filters.festivalKey}
            onChange={set('festivalKey')}
            options={[{ value: '', label: 'Any festival' }, ...festivalOptions.map(f => ({ value: f.id, label: f.name }))]}
          />

          <Select
            label="Minimum rating"
            value={filters.minRating}
            onChange={(e) => setFilters(prev => ({ ...prev, minRating: Number(e.target.value) }))}
            options={[{ value: 0, label: 'Any rating' }, ...Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: `${i + 1}★ and up` }))]}
          />

          {friends.length > 0 && (
            <Select
              label="With friend"
              value={filters.friendUid}
              onChange={set('friendUid')}
              options={[{ value: '', label: 'Any friend' }, ...friends.map(f => ({ value: f.friendUid, label: f.friendName }))]}
            />
          )}

          <Input
            label="My notes contain"
            value={filters.notes}
            onChange={set('notes')}
            placeholder="Search your notes"
          />

          <Input
            label="Setlist song"
            value={filters.song}
            onChange={set('song')}
            placeholder="e.g. Tweezer"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-5">
          <Button icon={Search} onClick={runSearch} disabled={!active}>Search</Button>
          <Button variant="ghost" icon={X} onClick={clearFilters} disabled={!active}>Clear filters</Button>
          {active && !showSaveInput && (
            <Button variant="ghost" icon={Bookmark} onClick={() => setShowSaveInput(true)}>Save search</Button>
          )}
          {showSaveInput && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Name this search"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="!py-1.5"
              />
              <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>Save</Button>
            </div>
          )}
        </div>
      </Card>

      {(savedSearches.length > 0 || history.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {savedSearches.length > 0 && (
            <Card padding="sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                <Bookmark className="w-3.5 h-3.5" /> Saved searches
              </div>
              <div className="flex flex-wrap gap-1.5">
                {savedSearches.map(s => (
                  <div key={s.name} className="flex items-center gap-1 bg-hover rounded-lg pl-2.5 pr-1 py-1">
                    <button
                      type="button"
                      onClick={() => setFilters({ ...EMPTY_FILTERS, ...s.filters })}
                      className="text-xs font-medium text-primary hover:text-brand"
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSaved(s.name)}
                      className="p-0.5 text-muted hover:text-danger"
                      aria-label={`Delete saved search ${s.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {history.length > 0 && (
            <Card padding="sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                <Clock className="w-3.5 h-3.5" /> Recent searches
              </div>
              <ul className="space-y-1">
                {history.map(h => (
                  <li key={h.at} className="text-xs text-secondary truncate">{h.summary}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {active && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-secondary">{results.length} show{results.length !== 1 ? 's' : ''} found</p>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="pl-3 pr-8 py-2 bg-surface border border-subtle rounded-xl text-sm text-secondary appearance-none cursor-pointer"
              >
                <option value="date-desc">Newest first</option>
                <option value="date-asc">Oldest first</option>
                <option value="rating-desc">Highest rated</option>
                <option value="artist">Artist A–Z</option>
              </select>
              <ChevronDown className="w-4 h-4 text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState icon={Search} title="No shows match these filters" body="Try loosening a filter or two." />
          ) : (
            <div className="space-y-3">
              {results.map(({ show, matchedFields }) => (
                <div key={show.id}>
                  <ShowCard
                    show={show}
                    friends={friends}
                    onClick={() => goToShow(show)}
                    runInfo={runInfoByShowId.get(show.id) || null}
                  />
                  {matchedFields.some(f => MATCH_LABELS[f]) && (
                    <p className="text-xs text-muted mt-1 ml-1">
                      {matchedFields.filter(f => MATCH_LABELS[f]).map(f => MATCH_LABELS[f]).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
