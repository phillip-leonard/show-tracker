'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, MapPin, Calendar, Music, RefreshCw, Clock, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Card, Badge, Input } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import { artistColor } from '@/lib/utils';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt < CACHE_TTL_MS) return data;
    localStorage.removeItem(key);
  } catch { /* ignore */ }
  return null;
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

// Tour dates arrive from get-artist-tours as yyyy-MM-dd (it normalizes
// setlist.fm's dd-MM-yyyy on the way out, so the whole app speaks one date
// format). Parsed field-by-field rather than through `new Date(str)`,
// which reads a bare ISO date as UTC midnight and renders the day before
// in any negative-offset timezone.
function formatTourDate(dateStr) {
  if (!dateStr) return '';
  const iso = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    : new Date(dateStr);
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSetlistFmDate(dateStr) {
  if (!dateStr) return '';
  const [day, month, year] = dateStr.split('-');
  try {
    return new Date(`${year}-${month}-${day}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

export default function TourInfoModal({ artistName, mbid, onClose }) {
  const [tourData, setTourData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('current');
  const [lastUpdated, setLastUpdated] = useState(null);

  // Song stats state
  const [songStats, setSongStats] = useState(null);
  const [songLoading, setSongLoading] = useState(false);
  const [songError, setSongError] = useState(null);
  const [songSearch, setSongSearch] = useState('');
  const [expandedSong, setExpandedSong] = useState(null);

  const fetchTourData = async (force = false) => {
    if (!mbid) {
      setError('No MusicBrainz ID available for this artist.');
      setLoading(false);
      return;
    }

    const cacheKey = `tour_info_${mbid}`;
    if (!force) {
      const cached = getCached(cacheKey);
      if (cached) {
        setTourData(cached);
        setLastUpdated(cached.fetchedAt);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl('/.netlify/functions/get-artist-tours')}?mbid=${encodeURIComponent(mbid)}`);
      if (!res.ok) throw new Error('Failed to fetch tour data');
      const data = await res.json();
      setTourData(data);
      setLastUpdated(data.fetchedAt);
      setCache(cacheKey, data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSongStats = async (force = false) => {
    if (!mbid) {
      setSongError('No MusicBrainz ID available for this artist.');
      return;
    }

    const cacheKey = `song_stats_${mbid}`;
    if (!force) {
      const cached = getCached(cacheKey);
      if (cached) {
        setSongStats(cached);
        return;
      }
    }

    setSongLoading(true);
    setSongError(null);

    try {
      const res = await fetch(`${apiUrl('/.netlify/functions/get-artist-song-stats')}?mbid=${encodeURIComponent(mbid)}`);
      if (!res.ok) throw new Error('Failed to fetch song stats');
      const data = await res.json();
      setSongStats(data);
      setCache(cacheKey, data);
    } catch (err) {
      setSongError(err.message);
    } finally {
      setSongLoading(false);
    }
  };

  useEffect(() => {
    fetchTourData();
  }, [mbid]);

  // Lazy-load song stats when tab is selected
  useEffect(() => {
    if (tab === 'songs' && !songStats && !songLoading) {
      fetchSongStats();
    }
  }, [tab]);

  const currentTour = tourData?.tours?.find(t => {
    if (!t.endDate) return false;
    return new Date(t.endDate) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  });

  const recentTours = tourData?.tours?.slice(0, 5) || [];
  const allTours = tourData?.tours || [];

  const filteredSongs = useMemo(() => {
    if (!songStats?.songs) return [];
    if (!songSearch.trim()) return songStats.songs;
    const q = songSearch.toLowerCase();
    return songStats.songs.filter(s => s.name.toLowerCase().includes(q));
  }, [songStats, songSearch]);

  const maxCount = songStats?.songs?.[0]?.count || 1;

  const tabs = [
    { id: 'current', label: 'Current Tour' },
    { id: 'recent', label: 'Recent Tours' },
    { id: 'all', label: 'All-Time Stats' },
    { id: 'songs', label: 'Song Stats' },
  ];

  const handleRefresh = () => {
    if (tab === 'songs') {
      setSongStats(null);
      setExpandedSong(null);
      fetchSongStats(true);
    } else {
      fetchTourData(true);
    }
  };

  const isLoading = tab === 'songs' ? songLoading : loading;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <Card variant="elevated" padding="none" className="max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
          <div>
            <h3 className="text-lg font-bold" style={{ color: artistColor(artistName) }}>{artistName}</h3>
            <p className="text-xs text-muted">Tour Information from setlist.fm</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={handleRefresh}
              disabled={isLoading}
              className={isLoading ? '[&_svg]:animate-spin' : ''}
              title="Refresh data"
            />
            <Button variant="ghost" icon={X} onClick={onClose} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-subtle bg-hover overflow-x-auto">
          {tabs.map(t => (
            <Button
              key={t.id}
              size="sm"
              variant="ghost"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap ${tab === t.id ? 'bg-brand/20 text-brand' : 'text-secondary'}`}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'songs' ? (
            <SongStatsTab
              loading={songLoading}
              error={songError}
              songStats={songStats}
              filteredSongs={filteredSongs}
              maxCount={maxCount}
              songSearch={songSearch}
              setSongSearch={setSongSearch}
              expandedSong={expandedSong}
              setExpandedSong={setExpandedSong}
            />
          ) : (
            <div className="p-6">
              {loading ? (
                <div className="text-center py-12">
                  <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-muted text-sm">Loading tour data...</p>
                </div>
              ) : error ? (
                <div className="text-center py-12">
                  <p className="text-danger text-sm">{error}</p>
                </div>
              ) : (
                <>
                  {tab === 'current' && (
                    <div>
                      {currentTour ? (
                        <TourCard tour={currentTour} isCurrent />
                      ) : (
                        <div className="text-center py-8">
                          <Music className="w-10 h-10 text-muted mx-auto mb-3" />
                          <p className="text-muted text-sm">No active tour detected</p>
                          <p className="text-muted text-xs mt-1">Check &quot;Recent Tours&quot; for the latest activity</p>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'recent' && (
                    <div className="space-y-4">
                      {recentTours.length === 0 ? (
                        <p className="text-muted text-center py-8">No recent tours found</p>
                      ) : (
                        recentTours.map((tour, i) => <TourCard key={i} tour={tour} />)
                      )}
                    </div>
                  )}

                  {tab === 'all' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <Card padding="none" className="p-4 text-center">
                          <div className="text-2xl font-bold text-primary">{tourData?.totalShows || 0}</div>
                          <div className="text-xs text-muted">Shows Tracked</div>
                        </Card>
                        <Card padding="none" className="p-4 text-center">
                          <div className="text-2xl font-bold text-primary">{allTours.length}</div>
                          <div className="text-xs text-muted">Tours Found</div>
                        </Card>
                      </div>
                      {allTours.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold text-secondary">All Tours</h4>
                          {allTours.map((tour, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 bg-hover rounded-lg text-sm">
                              <span className="text-primary font-medium truncate flex-1">{tour.name}</span>
                              <div className="flex items-center gap-3 text-muted text-xs flex-shrink-0">
                                <span>{tour.showCount} shows</span>
                                {tour.startDate && <span>{formatTourDate(tour.startDate)}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {lastUpdated && tab !== 'songs' && (
          <div className="px-6 py-2 border-t border-subtle flex items-center gap-2 text-xs text-muted">
            <Clock className="w-3 h-3" />
            <span>Last updated: {formatTourDate(lastUpdated)}</span>
          </div>
        )}
        {tab === 'songs' && songStats?.fetchedAt && (
          <div className="px-6 py-2 border-t border-subtle flex items-center gap-2 text-xs text-muted">
            <Clock className="w-3 h-3" />
            <span>Last updated: {formatTourDate(songStats.fetchedAt)}</span>
          </div>
        )}
      </Card>
    </div>
  );
}

function SongStatsTab({ loading, error, songStats, filteredSongs, maxCount, songSearch, setSongSearch, expandedSong, setExpandedSong }) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted text-sm">Analyzing setlists...</p>
        <p className="text-muted text-xs mt-1">This may take a moment</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 p-6">
        <p className="text-danger text-sm">{error}</p>
      </div>
    );
  }

  if (!songStats) return null;

  const { songs, totalSetlistsFetched, totalSetlistsAvailable } = songStats;

  return (
    <div className="flex flex-col h-full">
      {/* Coverage banner */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between text-xs text-muted mb-2">
          <span>
            {songs.length} unique songs · based on {totalSetlistsFetched} of {totalSetlistsAvailable} shows
          </span>
        </div>
        {/* Search */}
        <Input
          icon={Search}
          value={songSearch}
          onChange={e => setSongSearch(e.target.value)}
          placeholder="Search songs..."
        />
      </div>

      {/* Song list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
        {filteredSongs.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">No songs found</p>
        ) : (
          filteredSongs.map((song) => (
            <SongRow
              key={song.name}
              song={song}
              maxCount={maxCount}
              isExpanded={expandedSong === song.name}
              onToggle={() => setExpandedSong(expandedSong === song.name ? null : song.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SongRow({ song, maxCount, isExpanded, onToggle }) {
  const barWidth = Math.max(4, Math.round((song.count / maxCount) * 100));

  return (
    <div className="rounded-lg overflow-hidden border border-transparent hover:border-subtle transition-colors">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-hover text-left"
      >
        {/* Play count bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-primary truncate pr-2">{song.name}</span>
            <span className="text-xs text-muted flex-shrink-0">{song.count}×</span>
          </div>
          <div className="h-1 bg-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-brand/60 rounded-full"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="bg-hover border-t border-subtle px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto">
          {song.plays.map((play, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted">
              <Calendar className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="flex-shrink-0 text-secondary">{formatSetlistFmDate(play.date)}</span>
              {play.venue && (
                <>
                  <span className="text-muted">·</span>
                  <span className="truncate">{play.venue}{play.city ? `, ${play.city}` : ''}</span>
                </>
              )}
              {play.setlistUrl && (
                <a
                  href={play.setlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-brand hover:underline ml-auto"
                  onClick={e => e.stopPropagation()}
                >
                  ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TourCard({ tour, isCurrent = false }) {
  return (
    <Card padding="none" className={`p-4 ${isCurrent ? 'border-brand/30' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="font-semibold text-primary">{tour.name}</h4>
          <div className="flex items-center gap-3 mt-1 text-xs text-secondary">
            {tour.startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatTourDate(tour.startDate)} — {tour.endDate ? formatTourDate(tour.endDate) : 'ongoing'}
              </span>
            )}
          </div>
        </div>
        {isCurrent && (
          <Badge tone="green" size="sm">Active</Badge>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-secondary">
        <span>{tour.showCount} shows</span>
        <span>~{tour.avgSongCount} songs/show</span>
      </div>
      {tour.shows && tour.shows.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {tour.shows.slice(0, 5).map((show, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{show.venue}{show.city ? `, ${show.city}` : ''}</span>
              <span className="flex-shrink-0">{formatTourDate(show.date)}</span>
            </div>
          ))}
          {tour.shows.length > 5 && (
            <p className="text-xs text-muted pl-5">+{tour.shows.length - 5} more</p>
          )}
        </div>
      )}
    </Card>
  );
}
