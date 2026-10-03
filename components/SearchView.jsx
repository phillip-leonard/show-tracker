'use client';

import React, { useState, useMemo } from 'react';
import { Search, X, ChevronDown, ChevronLeft, ChevronRight, Check, Download, Plus, Users, ListPlus, AlertCircle } from 'lucide-react';
import Tip from '@/components/ui/Tip';
import { Card, Button, Input, EmptyState, Modal, Spinner } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import {
  hasSearchTarget, setlistToShowData, fetchAllSetlistPages, groupShowsByVenue, MAX_ADD_ALL_PAGES,
} from '@/lib/setlistSearch';
import { buildExistingShowIndex, existingShowStatus } from '@/lib/tourBrowse';

// The artist is optional: a venue or a city, with or without a year, is a
// search of its own. That's what makes "every show at Red Rocks in 2024"
// one search, and "Add all" adds the lot (see the review modal below).
function SearchView({ onImport, onImportMany, bulkAddProgress, existingShows = [], importedIds, onAddManually }) {
  const [artistName, setArtistName] = useState('');
  const [year, setYear] = useState('');
  const [venueName, setVenueName] = useState('');
  const [cityName, setCityName] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [imported, setImported] = useState(new Set());
  const [expandedSetlist, setExpandedSetlist] = useState(null);
  const [totalResults, setTotalResults] = useState(0);
  // The query that produced the results on screen. Paging and "Add all"
  // use this rather than the live inputs, so editing a field after
  // searching can't change what "Add all" adds.
  const [activeQuery, setActiveQuery] = useState(null);
  // "Add all": null | { phase: 'loading', progress } | { phase: 'review',
  // shows, truncated, total } | { phase: 'adding' } | { phase: 'done',
  // outcome } | { phase: 'error', message }
  const [addAll, setAddAll] = useState(null);
  const [excludedVenues, setExcludedVenues] = useState(() => new Set());

  // Artist disambiguation state
  const [artistOptions, setArtistOptions] = useState([]);
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [showArtistPicker, setShowArtistPicker] = useState(false);

  // Artist search mode
  const [searchMode, setSearchMode] = useState('setlist'); // 'setlist' | 'artist'
  const [artistGroups, setArtistGroups] = useState([]);
  const [expandedArtistGroup, setExpandedArtistGroup] = useState(null);

  // Search for artists first
  const searchArtists = async () => {
    if (!artistName.trim()) return;

    setIsSearching(true);
    setError('');
    setArtistOptions([]);
    setSelectedArtist(null);
    setResults([]);

    try {
      const params = new URLSearchParams({ artistName: artistName.trim() });
      const response = await fetch(apiUrl(`/.netlify/functions/search-artists?${params.toString()}`));

      if (!response.ok) {
        throw new Error('Failed to search artists');
      }

      const data = await response.json();

      if (!data.artist || data.artist.length === 0) {
        setError('No artists found. Try a different search term.');
        return;
      }

      // If only one artist or exact match, go straight to setlist search
      const exactMatch = data.artist.find(a => a.name.toLowerCase() === artistName.trim().toLowerCase());
      if (data.artist.length === 1 || exactMatch) {
        const artist = exactMatch || data.artist[0];
        setSelectedArtist(artist);
        setShowArtistPicker(false);
        searchSetlists(1, artist);
      } else {
        // Multiple artists - show picker
        setArtistOptions(data.artist.slice(0, 10)); // Show top 10 matches
        setShowArtistPicker(true);
      }
    } catch (err) {
      console.error('Artist search error:', err);
      setError('An error occurred while searching. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const selectArtist = (artist) => {
    setSelectedArtist(artist);
    setShowArtistPicker(false);
    setArtistOptions([]);
    searchSetlists(1, artist);
  };

  const clearArtistSelection = () => {
    setSelectedArtist(null);
    setResults([]);
    setPage(1);
    setTotalPages(1);
  };

  // Artist-based search: find all artists matching name and their latest shows
  const searchByArtist = async () => {
    if (!artistName.trim()) return;
    setIsSearching(true);
    setError('');
    setArtistGroups([]);
    setResults([]);
    try {
      const params = new URLSearchParams({ artistName: artistName.trim() });
      const response = await fetch(apiUrl(`/.netlify/functions/search-artist-shows?${params}`));
      if (!response.ok) throw new Error('Failed to search artist shows');
      const data = await response.json();
      if (!data.groups || data.groups.length === 0) {
        setError('No shows found for this artist. Try a different name.');
        return;
      }
      setArtistGroups(data.groups);
      setExpandedArtistGroup(data.groups.length === 1 ? 0 : null);
    } catch (err) {
      console.error('Artist search error:', err);
      setError('An error occurred while searching. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  // The query as it stands in the form right now. `artistOverride` is a
  // just-picked artist that isn't in state yet; `artistless` searches by
  // venue/city alone even if the artist box has text in it.
  const queryFromForm = (artistOverride = null, { artistless = false } = {}) => {
    const artist = artistless ? null : (artistOverride || selectedArtist);
    return {
      artistMbid: artist?.mbid || '',
      artistName: artistless ? '' : (artist?.name || artistName.trim()),
      year: year.trim(),
      venueName: venueName.trim(),
      cityName: cityName.trim(),
    };
  };

  const fetchSetlistPage = async (query, pageNum) => {
    const params = new URLSearchParams({ p: pageNum.toString() });
    // Use artistMbid for exact match if we have a selected artist with mbid
    if (query.artistMbid) params.set('artistMbid', query.artistMbid);
    else if (query.artistName) params.set('artistName', query.artistName);
    if (query.year) params.set('year', query.year);
    if (query.venueName) params.set('venueName', query.venueName);
    if (query.cityName) params.set('cityName', query.cityName);
    return fetch(apiUrl(`/.netlify/functions/search-setlists?${params.toString()}`));
  };

  const searchSetlists = async (pageNum = 1, artistOverride = null, options = {}) => {
    // Paging re-asks the query that produced the results on screen, not
    // whatever the form says now.
    const query = options.paging && activeQuery ? activeQuery : queryFromForm(artistOverride, options);
    if (!hasSearchTarget({ artist: query.artistMbid || query.artistName, venueName: query.venueName, cityName: query.cityName })) {
      setError('Enter an artist, a venue or a city to search.');
      return;
    }

    setIsSearching(true);
    setError('');

    try {
      const response = await fetchSetlistPage(query, pageNum);

      if (response.status === 404) {
        setError('No setlists found. Try adjusting your search.');
        setResults([]);
        setTotalPages(1);
        setTotalResults(0);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`Failed to fetch setlists (${response.status}). ${errorText}`);
      }

      const data = await response.json();

      if (!data.setlist || data.setlist.length === 0) {
        setError('No setlists found. Try adjusting your search.');
        setResults([]);
        setTotalPages(1);
        setTotalResults(0);
      } else {
        setResults(data.setlist);
        setPage(pageNum);
        setActiveQuery(query);
        const total = data.total || 0;
        const perPage = data.itemsPerPage || 20;
        setTotalResults(total || data.setlist.length);
        setTotalPages(Math.max(1, Math.ceil(total / perPage)));
      }
    } catch (err) {
      console.error('Search error:', err);
      setError(err.message || 'An error occurred while searching. Please try again.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const importSetlist = (setlist) => {
    onImport(setlistToShowData(setlist, extractSongsFromSetlist));
    setImported(prev => new Set([...prev, setlist.id]));
  };

  // The one button on the Search form. With an artist: the existing
  // pick-the-artist-then-search flow. Without one: straight to setlists by
  // venue and/or city.
  const submitSearch = () => {
    if (isSearching) return;
    if (selectedArtist) return searchSetlists(1);
    if (artistName.trim()) return searchArtists();
    return searchSetlists(1, null, { artistless: true });
  };
  const canSubmit = hasSearchTarget({ artist: selectedArtist?.name || artistName, venueName, cityName });

  // ── Add all ─────────────────────────────────────────────────────────
  // Fetches every page of the current search (one at a time — see
  // lib/setlistSearch.js), then opens a review grouped by venue before
  // anything is written.
  const existingIndex = useMemo(() => buildExistingShowIndex(existingShows), [existingShows]);

  const startAddAll = async () => {
    if (!activeQuery || !onImportMany) return;
    setExcludedVenues(new Set());
    setAddAll({ phase: 'loading', progress: null });
    try {
      const { setlists, total, truncated } = await fetchAllSetlistPages(
        async (pageNum) => {
          const res = await fetchSetlistPage(activeQuery, pageNum);
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(`setlist.fm search failed (${res.status})`);
          return res.json();
        },
        { onProgress: (progress) => setAddAll({ phase: 'loading', progress }) }
      );
      const shows = setlists.map(sl => setlistToShowData(sl, extractSongsFromSetlist));
      setAddAll({ phase: 'review', shows, total, truncated });
    } catch (err) {
      console.error('Add all: fetching pages failed:', err);
      setAddAll({ phase: 'error', message: 'Couldn\u2019t load all the shows from setlist.fm. Please try again in a minute.' });
    }
  };

  const reviewGroups = useMemo(() => {
    if (addAll?.phase !== 'review') return [];
    return groupShowsByVenue(addAll.shows).map(group => {
      const statuses = group.shows.map(show => existingShowStatus(existingIndex, show));
      return {
        ...group,
        newShows: group.shows.filter((_, i) => statuses[i] !== 'added'),
        alreadyAdded: statuses.filter(st => st === 'added').length,
        possible: statuses.filter(st => st === 'possible').length,
      };
    });
  }, [addAll, existingIndex]);

  const toAdd = reviewGroups.filter(g => !excludedVenues.has(g.key)).flatMap(g => g.newShows);
  const alreadyAddedCount = reviewGroups.reduce((n, g) => n + g.alreadyAdded, 0);
  const possibleCount = reviewGroups.filter(g => !excludedVenues.has(g.key)).reduce((n, g) => n + g.possible, 0);

  const toggleVenue = (key) => setExcludedVenues(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const confirmAddAll = async () => {
    if (toAdd.length === 0) return;
    setAddAll({ phase: 'adding' });
    const outcome = await onImportMany(toAdd);
    setAddAll({ phase: 'done', outcome });
  };

  const closeAddAll = () => {
    // Closing mid-write doesn't stop it: the run lives in AppContext and
    // finishes in the background, the same as the tour browser.
    setAddAll(null);
  };

  const isImported = (id) => importedIds.has(id) || imported.has(id);

  const formatSetlistDate = (dateStr) => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).toLocaleDateString();
    }
    return dateStr;
  };

  return (
    <div>
      {/* Search Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant="ghost"
          icon={Search}
          onClick={() => { setSearchMode('setlist'); setArtistGroups([]); setError(''); }}
          className={searchMode === 'setlist'
            ? 'bg-brand-subtle text-brand border border-brand/30'
            : 'text-secondary border border-subtle'}
        >
          Search by Show
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Users}
          onClick={() => { setSearchMode('artist'); setResults([]); setSelectedArtist(null); setShowArtistPicker(false); setError(''); }}
          className={searchMode === 'artist'
            ? 'bg-brand-subtle text-brand border border-brand/30'
            : 'text-secondary border border-subtle'}
        >
          Search by Artist
        </Button>
      </div>

      {/* Search Form */}
      <Card padding="md" className="mb-6">
        {searchMode === 'artist' ? (
          <>
            <Input
              label="Artist / Performer Name"
              type="text"
              placeholder="e.g., Grahame Lesh"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchByArtist()}
              enterKeyHint="search"
              autoCapitalize="words"
              autoCorrect="off"
              hint="Find all shows featuring this artist across different bands and projects"
              containerClassName="mb-4"
            />
            <Button
              variant="primary"
              full
              icon={Users}
              onClick={searchByArtist}
              disabled={isSearching || !artistName.trim()}
              loading={isSearching}
            >
              {isSearching ? 'Searching...' : 'Find Artist Shows'}
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Input
                  label="Artist Name"
                  type="text"
                  placeholder="e.g., Radiohead"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && submitSearch()}
                  hint={selectedArtist ? undefined : 'Optional. Leave blank to find every show at a venue or in a city.'}
                  enterKeyHint="search"
                  autoCapitalize="words"
                  autoCorrect="off"
                  disabled={selectedArtist !== null}
                />
                {selectedArtist && (
                  <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-brand-subtle border border-brand/30 rounded-lg">
                    <span className="text-brand text-sm flex-1">
                      <span className="text-secondary">Searching:</span> {selectedArtist.name}
                      {selectedArtist.disambiguation && (
                        <span className="text-muted ml-1">({selectedArtist.disambiguation})</span>
                      )}
                    </span>
                    <Tip text="Clear selection">
                      <button
                        onClick={clearArtistSelection}
                        className="text-secondary hover:text-primary tap-target -m-1 pressable"
                        aria-label="Clear artist selection"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </Tip>
                  </div>
                )}
              </div>
              <Input
                label="Year"
                type="text"
                placeholder="e.g., 2024"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && submitSearch()}
                // A numeric pad for a year, but type stays text so a
                // partial entry is not silently rejected by the browser.
                inputMode="numeric"
                enterKeyHint="search"
              />
              <Input
                label="Venue"
                type="text"
                placeholder="e.g., Madison Square Garden"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && submitSearch()}
                enterKeyHint="search"
                autoCapitalize="words"
              />
              <Input
                label="City"
                type="text"
                placeholder="e.g., New York"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && submitSearch()}
                enterKeyHint="search"
                autoCapitalize="words"
              />
            </div>
            <Button
              variant="primary"
              full
              icon={Search}
              onClick={submitSearch}
              disabled={isSearching || !canSubmit}
              loading={isSearching}
            >
              {isSearching
                ? 'Searching...'
                : selectedArtist ? 'Search Setlists' : artistName.trim() ? 'Search Artists' : 'Search Shows'}
            </Button>
          </>
        )}
      </Card>

      {/* Artist Picker */}
      {showArtistPicker && artistOptions.length > 0 && (
        <Card padding="md" className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-primary">Select Artist</h2>
              <p className="text-sm text-secondary">Multiple artists found - please select the correct one</p>
            </div>
            <button
              onClick={() => {
                setShowArtistPicker(false);
                setArtistOptions([]);
              }}
              className="text-secondary hover:text-primary p-2.5 -m-1 flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-2">
            {artistOptions.map((artist) => (
              <button
                key={artist.mbid || artist.name}
                onClick={() => selectArtist(artist)}
                className="w-full text-left p-4 bg-surface hover:bg-hover border border-subtle hover:border-brand/30 rounded-xl transition-all group"
              >
                <div className="font-medium text-primary group-hover:text-brand transition-colors">
                  {artist.name}
                </div>
                {artist.disambiguation && (
                  <div className="text-sm text-secondary mt-1">{artist.disambiguation}</div>
                )}
                {artist.sortName && artist.sortName !== artist.name && (
                  <div className="text-xs text-muted mt-1">Sort: {artist.sortName}</div>
                )}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-xl p-4 mb-6">
          <p className="text-danger text-sm">{error}</p>
          {onAddManually && (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={onAddManually}
              className="mt-3"
            >
              Add Manually
            </Button>
          )}
        </div>
      )}

      {/* Artist Search Results */}
      {artistGroups.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-primary">Artists Found</h2>
          {artistGroups.map((group, groupIdx) => {
            const isGroupExpanded = expandedArtistGroup === groupIdx;
            return (
              <Card key={group.artist.mbid || groupIdx} padding="none" className="overflow-hidden">
                <button
                  onClick={() => setExpandedArtistGroup(isGroupExpanded ? null : groupIdx)}
                  className="w-full text-left p-5 flex items-center justify-between hover:bg-hover transition-colors"
                >
                  <div>
                    <div className="font-semibold text-primary text-lg">{group.artist.name}</div>
                    {group.artist.disambiguation && (
                      <div className="text-sm text-muted mt-0.5">{group.artist.disambiguation}</div>
                    )}
                    <div className="text-sm text-secondary mt-1">{group.total} show{group.total !== 1 ? 's' : ''} on setlist.fm</div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-secondary transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isGroupExpanded && (
                  <div className="border-t border-subtle divide-y divide-subtle">
                    {group.setlists.map((setlist) => {
                      const songCount = setlist.sets?.set?.reduce((acc, s) => acc + (s.song?.length || 0), 0) || 0;
                      const isExpanded = expandedSetlist === setlist.id;
                      return (
                        <div key={setlist.id} className="p-4 hover:bg-hover transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-secondary">
                                {setlist.venue?.name} &middot; {setlist.venue?.city?.name}, {setlist.venue?.city?.country?.name}
                              </div>
                              <div className="text-sm text-muted mt-1">
                                {formatSetlistDate(setlist.eventDate)}
                                {setlist.tour && <span className="text-brand ml-2">{setlist.tour.name}</span>}
                              </div>
                              {songCount > 0 && (
                                <button
                                  onClick={() => setExpandedSetlist(isExpanded ? null : setlist.id)}
                                  className="flex items-center gap-1 text-xs text-secondary hover:text-primary mt-2 min-h-touch md:min-h-0 transition-colors pressable"
                                >
                                  <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                  {songCount} songs
                                </button>
                              )}
                              {isExpanded && setlist.sets?.set && (
                                <div className="mt-3 pl-2 border-l-2 border-subtle">
                                  {setlist.sets.set.map((set, setIdx) => (
                                    <div key={setIdx}>
                                      {(set.name || set.encore) && (
                                        <div className="text-xs font-semibold text-brand uppercase tracking-wide mt-2 mb-1">
                                          {set.name || (set.encore ? 'Encore' : `Set ${setIdx + 1}`)}
                                        </div>
                                      )}
                                      {set.song?.map((song, songIdx) => (
                                        <div key={songIdx} className="flex items-center gap-2 py-0.5 text-sm text-secondary">
                                          <span className="text-muted w-5 text-right text-xs">{songIdx + 1}.</span>
                                          <span>{song.name}</span>
                                          {song.cover && <span className="text-xs text-muted">({song.cover.name} cover)</span>}
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={isImported(setlist.id) ? 'ghost' : 'secondary'}
                              icon={isImported(setlist.id) ? Check : Download}
                              onClick={() => importSetlist(setlist)}
                              disabled={isImported(setlist.id)}
                              className={`flex-shrink-0 ${isImported(setlist.id) ? 'bg-brand-subtle text-brand cursor-default' : ''}`}
                            >
                              {isImported(setlist.id) ? 'Added' : 'Add Show'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {group.total > group.setlists.length && (
                      <div className="p-4 text-center">
                        <button
                          onClick={() => {
                            setSearchMode('setlist');
                            setSelectedArtist(group.artist);
                            setArtistGroups([]);
                            searchSetlists(1, group.artist);
                          }}
                          className="text-sm text-brand hover:underline"
                        >
                          View all {group.total} shows for {group.artist.name} →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-primary">Search Results</h2>
              <span className="text-sm text-secondary">
                {totalResults} show{totalResults !== 1 ? 's' : ''} · Page {page} of {totalPages}
              </span>
            </div>
            {onImportMany && totalResults > 1 && (
              <Button
                size="sm"
                variant="secondary"
                icon={ListPlus}
                onClick={startAddAll}
                disabled={isSearching || !!addAll}
              >
                Add all {totalResults > MAX_ADD_ALL_PAGES * 20 ? `(first ${MAX_ADD_ALL_PAGES * 20})` : totalResults}
              </Button>
            )}
          </div>

          {results.map((setlist) => {
            const songCount = setlist.sets?.set?.reduce((acc, s) => acc + (s.song?.length || 0), 0) || 0;
            const isExpanded = expandedSetlist === setlist.id;

            return (
              <Card
                key={setlist.id}
                padding="none"
                className="overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-primary">{setlist.artist.name}</div>
                      <div className="text-sm text-secondary mt-1">
                        {setlist.venue.name} &middot; {setlist.venue.city.name}, {setlist.venue.city.country.name}
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {formatSetlistDate(setlist.eventDate)}
                        {setlist.tour && <span className="text-brand ml-2">{setlist.tour.name}</span>}
                      </div>
                      {songCount > 0 && (
                        <button
                          onClick={() => setExpandedSetlist(isExpanded ? null : setlist.id)}
                          className="flex items-center gap-1 text-xs text-secondary hover:text-primary mt-2 min-h-touch md:min-h-0 transition-colors pressable"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          {songCount} songs
                        </button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={isImported(setlist.id) ? 'ghost' : 'secondary'}
                      icon={isImported(setlist.id) ? Check : Download}
                      onClick={() => importSetlist(setlist)}
                      disabled={isImported(setlist.id)}
                      className={isImported(setlist.id) ? 'bg-brand-subtle text-brand cursor-default' : ''}
                    >
                      {isImported(setlist.id) ? 'Added' : 'Add Show'}
                    </Button>
                  </div>
                </div>

                {/* Expandable Setlist */}
                {isExpanded && setlist.sets?.set && (
                  <div className="border-t border-subtle bg-base p-4">
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {setlist.sets.set.map((set, setIdx) => (
                        <div key={setIdx}>
                          {set.name && (
                            <div className="text-xs font-semibold text-brand uppercase tracking-wide mt-2 mb-1">
                              {set.name || (set.encore ? 'Encore' : `Set ${setIdx + 1}`)}
                            </div>
                          )}
                          {set.encore && !set.name && (
                            <div className="text-xs font-semibold text-brand uppercase tracking-wide mt-2 mb-1">
                              Encore
                            </div>
                          )}
                          {set.song?.map((song, songIdx) => (
                            <div
                              key={songIdx}
                              className="flex items-center gap-2 py-1 text-sm text-secondary"
                            >
                              <span className="text-muted w-6 text-right text-xs">{songIdx + 1}.</span>
                              <span>{song.name}</span>
                              {song.cover && (
                                <span className="text-xs text-muted">
                                  ({song.cover.name} cover)
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => searchSetlists(page - 1, null, { paging: true })}
                disabled={page === 1 || isSearching}
                className="!px-2"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="text-sm text-secondary px-4">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => searchSetlists(page + 1, null, { paging: true })}
                disabled={page === totalPages || isSearching}
                className="!px-2"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isSearching && results.length === 0 && artistGroups.length === 0 && !error && !showArtistPicker && (
        <EmptyState
          icon={Search}
          title={searchMode === 'artist' ? 'Find an artist' : 'Find a show'}
          body={searchMode === 'artist'
            ? 'Enter a performer name to find their shows across all bands and projects'
            : 'Search by artist, or leave the artist blank and enter a venue or city (and a year) to find every show there'}
        />
      )}

      {/* Add all — review before anything is written */}
      <Modal
        open={!!addAll}
        onClose={closeAddAll}
        title="Add all shows"
        subtitle={activeQuery ? [
          activeQuery.artistName,
          activeQuery.venueName,
          activeQuery.cityName,
          activeQuery.year,
        ].filter(Boolean).join(' · ') : undefined}
        size="md"
      >
        {addAll?.phase === 'loading' && (
          <div className="py-8">
            <Spinner
              size="md"
              label={addAll.progress
                ? `Loading shows from setlist.fm… page ${addAll.progress.page} of ${addAll.progress.pageCount}`
                : 'Loading shows from setlist.fm…'}
            />
          </div>
        )}

        {addAll?.phase === 'error' && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm text-danger">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{addAll.message}</span>
          </div>
        )}

        {addAll?.phase === 'review' && (
          <div className="flex flex-col gap-4">
            {addAll.truncated && (
              <p className="text-sm text-secondary bg-hover border border-subtle rounded-xl px-3 py-2">
                This search has {addAll.total} shows. Only the first {addAll.shows.length} can be added at once. Add a year or a venue to narrow it down.
              </p>
            )}
            <p className="text-sm text-secondary">
              setlist.fm matches venue names loosely, so check the venues below and untick any you didn&apos;t mean.
            </p>
            <div className="border border-subtle rounded-xl divide-y divide-subtle overflow-hidden">
              {reviewGroups.map(group => {
                const checked = !excludedVenues.has(group.key);
                return (
                  <label key={group.key} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-hover transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVenue(group.key)}
                      disabled={group.newShows.length === 0}
                      className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-primary">
                        {group.venue}{group.city ? <span className="font-normal text-secondary">, {group.city}</span> : null}
                      </div>
                      <div className="text-xs text-secondary mt-0.5">
                        {group.newShows.length} to add
                        {group.alreadyAdded > 0 && ` · ${group.alreadyAdded} already in your shows`}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {possibleCount > 0 && (
              <p className="text-xs text-muted">
                {possibleCount} of these share an artist and date with a show you already have at a different venue. They&apos;ll be added; delete any duplicates afterwards.
              </p>
            )}
            {alreadyAddedCount > 0 && (
              <p className="text-xs text-muted">
                {alreadyAddedCount} show{alreadyAddedCount !== 1 ? 's are' : ' is'} already in your shows and won&apos;t be added again.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={closeAddAll}>Cancel</Button>
              <Button variant="primary" icon={ListPlus} onClick={confirmAddAll} disabled={toAdd.length === 0}>
                {toAdd.length === 0 ? 'Nothing new to add' : `Add ${toAdd.length} show${toAdd.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        )}

        {addAll?.phase === 'adding' && (
          <div className="py-8">
            <Spinner
              size="md"
              label={bulkAddProgress?.running
                ? `Adding shows… ${bulkAddProgress.completed} of ${bulkAddProgress.total}`
                : 'Adding shows…'}
            />
            <p className="text-xs text-muted text-center mt-3">You can close this. Adding keeps going in the background.</p>
          </div>
        )}

        {addAll?.phase === 'done' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-primary">
              Added {addAll.outcome?.added?.length || 0} show{(addAll.outcome?.added?.length || 0) !== 1 ? 's' : ''}.
              {addAll.outcome?.skipped?.length > 0 && ` ${addAll.outcome.skipped.length} were already in your shows.`}
            </p>
            {addAll.outcome?.failed?.length > 0 && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm text-danger">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {addAll.outcome.failed.length} couldn&apos;t be added. Search again and use Add all to retry; shows already added are skipped.
                </span>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={closeAddAll}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default SearchView;
