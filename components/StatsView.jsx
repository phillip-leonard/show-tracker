'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Music, Users, Building2, Star, ChevronDown, MapPin, Heart, Trash2 } from 'lucide-react';
import DeleteShowModal from '@/components/shows/DeleteShowModal';
import ShowDetailView from '@/components/shows/ShowDetailView';
import ShowCard from '@/components/shows/ShowCard';
import { formatDate, parseDate, artistColor } from '@/lib/utils';
import { Button, Card, Badge, Tabs, SectionHeader } from '@/components/ui';
import SongStatsRow from '@/components/SongStatsRow';
import PlaylistCreatorModal from '@/components/PlaylistCreatorModal';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';

function StatsView({ shows, allShows = shows, songStats, artistStats, venueStats, topRatedShows, onRateSong, onRateShow, onCommentShow, onUpdateVenueRating, onDeleteShow, onAddSong, onReorderSetlist, onResyncSetlist, onDeleteSong, onRestoreSong, initialTab, onTagFriends, onRateVenue, onToggleFavoriteArtist, isArtistFavorite, fetchVenueRatings, normalizeVenueKey, computeVenueAggregate, friends, user }) {
  const [tab, setTab] = useState(initialTab || 'years');
  const [selectedYear, setSelectedYear] = useState(null);
  const [expandedVenue, setExpandedVenue] = useState(null);
  const [expandedYear, setExpandedYear] = useState(null);
  const [expandedShow, setExpandedShow] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [playlistShow, setPlaylistShow] = useState(null);
  const [venueRatingsMap, setVenueRatingsMap] = useState({}); // venueKey -> aggregate | null
  const [showToDelete, setShowToDelete] = useState(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Load venue ratings when venues tab becomes active
  useEffect(() => {
    if (tab !== 'venues' || !fetchVenueRatings || !normalizeVenueKey || !computeVenueAggregate) return;
    let cancelled = false;
    async function loadAll() {
      const keys = [...new Set(shows.map(s => normalizeVenueKey(s.venue, s.city)))];
      const results = await Promise.all(keys.map(async (key) => {
        try {
          const ratings = await fetchVenueRatings(key);
          return [key, computeVenueAggregate(ratings)];
        } catch { return [key, null]; }
      }));
      if (!cancelled) setVenueRatingsMap(Object.fromEntries(results));
    }
    loadAll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Keep selectedShow in sync with shows data
  useEffect(() => {
    if (selectedShow) {
      const updatedShow = allShows.find(s => s.id === selectedShow.id);
      if (updatedShow) {
        setSelectedShow(updatedShow);
      }
    }
  }, [allShows, selectedShow?.id]);

  const uniqueYears = useMemo(() => {
    const years = new Set();
    shows.forEach(s => {
      const d = parseDate(s.date);
      if (d.getFullYear() > 1970) years.add(d.getFullYear());
    });
    return [...years].sort((a, b) => b - a);
  }, [shows]);

  const showsByYear = useMemo(() => {
    const grouped = {};
    shows.forEach(show => {
      const d = parseDate(show.date);
      const year = d.getFullYear();
      if (year > 1970) {
        if (!grouped[year]) grouped[year] = [];
        grouped[year].push(show);
      }
    });
    // Sort shows within each year by date descending
    Object.keys(grouped).forEach(year => {
      grouped[year].sort((a, b) => parseDate(b.date) - parseDate(a.date));
    });
    return grouped;
  }, [shows]);

  // Venue details: grouped by venue -> year -> shows
  const venueDetails = useMemo(() => {
    const details = {};
    shows.forEach(show => {
      const venueName = show.venue + (show.city ? `, ${show.city}` : '');
      if (!details[venueName]) {
        details[venueName] = { years: {}, artistSet: new Set(), sampleShow: show };
      }
      const year = parseDate(show.date).getFullYear();
      if (!details[venueName].years[year]) {
        details[venueName].years[year] = [];
      }
      details[venueName].years[year].push(show);
      details[venueName].artistSet.add(show.artist);
    });
    // Convert to sorted array
    return Object.entries(details)
      .map(([name, data]) => ({
        name,
        venueKey: normalizeVenueKey ? normalizeVenueKey(data.sampleShow.venue, data.sampleShow.city) : name.toLowerCase(),
        sampleShow: data.sampleShow,
        showCount: Object.values(data.years).flat().length,
        artistCount: data.artistSet.size,
        years: Object.entries(data.years)
          .map(([year, yearShows]) => ({
            year: Number(year),
            shows: yearShows.sort((a, b) => parseDate(b.date) - parseDate(a.date))
          }))
          .sort((a, b) => b.year - a.year)
      }))
      .sort((a, b) => b.showCount - a.showCount);
  }, [shows, normalizeVenueKey]);


  // Render the same full-page ShowDetailView used on /shows, in place of the
  // stats tabs, so a show looks identical no matter where it was clicked.
  if (selectedShow) {
    return (
      <>
        <ShowDetailView
          show={selectedShow}
          friends={friends}
          onClose={() => setSelectedShow(null)}
          onUpdateRating={onRateShow}
          onUpdateVenueRating={onUpdateVenueRating}
          onUpdateComment={onCommentShow}
          onTagFriends={onTagFriends}
          onCreatePlaylist={PLAYLIST_CREATION_ENABLED ? (show) => setPlaylistShow(show) : undefined}
          onDeleteShow={onDeleteShow}
          onAddSong={onAddSong}
          onReorderSetlist={onReorderSetlist}
          onResyncSetlist={onResyncSetlist}
          onDeleteSong={onDeleteSong}
          onRestoreSong={onRestoreSong}
          toggleFavoriteArtist={onToggleFavoriteArtist}
          isArtistFavorite={isArtistFavorite}
          allShows={allShows}
          user={user}
        />
        {playlistShow && (
          <PlaylistCreatorModal
            show={playlistShow}
            onClose={() => setPlaylistShow(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { id: 'years', label: 'Years', icon: Calendar },
          { id: 'songs', label: 'Songs', icon: Music },
          { id: 'artists', label: 'Artists', icon: Users },
          { id: 'venues', label: 'Venues', icon: Building2 },
          { id: 'top', label: 'Top Shows', icon: Star },
        ]}
      />

      {tab === 'songs' && (
        <div>
          <SectionHeader title="Song Statistics" className="mb-4" />


          {songStats.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">
              {allShows.length > shows.length ? 'No songs match the current filters' : 'No songs tracked yet'}
            </p>
          ) : (
            <Card variant="elevated" padding="none" className="shadow-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-hover border-b border-subtle">
                    <th className="text-left px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Song</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Times Played</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {songStats.map((song, i) => (
                    <SongStatsRow
                      key={song.name}
                      song={song}
                      index={i}
                      onRateSong={onRateSong}
                      onViewShow={(showId) => setSelectedShow(allShows.find(s => s.id === showId))}
                    />
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === 'artists' && (
        <div>
          <SectionHeader title="Artist Statistics" className="mb-4" />
          {artistStats.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">No shows tracked yet</p>
          ) : (
            <div className="space-y-2">
              {artistStats.map((artist) => {
                const isExpanded = expandedShow === `artist-${artist.name}`;
                const artistShows = shows
                  .filter(s => s.artist === artist.name)
                  .sort((a, b) => parseDate(b.date) - parseDate(a.date));
                return (
                  <div key={artist.name}>
                    <button
                      onClick={() => setExpandedShow(isExpanded ? null : `artist-${artist.name}`)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-hover transition-all text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: artistColor(artist.name) }} />
                        <span className="font-medium group-hover:text-brand transition-colors" style={{ color: artistColor(artist.name) }}>{artist.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {onToggleFavoriteArtist && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Heart}
                            onClick={(e) => { e.stopPropagation(); onToggleFavoriteArtist(artist.name); }}
                            title={isArtistFavorite?.(artist.name) ? 'Remove from favorites' : 'Add to favorites'}
                            className={isArtistFavorite?.(artist.name) ? 'text-red-500' : 'text-muted hover:text-red-400'}
                          />
                        )}
                        <Badge tone="neutral" size="sm">{artist.count} show{artist.count !== 1 ? 's' : ''}</Badge>
                        <span className="text-muted text-sm hidden sm:inline">{artist.totalSongs} songs</span>
                        {artist.avgRating ? (
                          <div className="flex items-center gap-1 text-secondary text-sm">
                            <Star className="w-3.5 h-3.5 text-brand" />
                            <span>{artist.avgRating}</span>
                          </div>
                        ) : null}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="space-y-2 pl-4 pr-2 pb-2 mt-1">
                        {artistShows.map(show => (
                          <Card
                            key={show.id}
                            padding="none"
                            interactive
                            className="p-4"
                            onClick={() => setSelectedShow(show)}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-secondary text-sm">
                                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>{formatDate(show.date)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-secondary text-sm mt-1">
                                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span className="truncate">{show.venue}{show.city ? `, ${show.city}` : ''}</span>
                                </div>
                                {show.tour && (
                                  <div className="text-brand/70 text-sm mt-1">{show.tour}</div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {show.rating && (
                                  <div className="flex items-center gap-1">
                                    <Star className="w-4 h-4 text-brand fill-amber" />
                                    <span className="text-primary font-medium">{show.rating}</span>
                                  </div>
                                )}
                                <span className="text-muted text-sm">{show.setlist?.length || 0} songs</span>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'venues' && (
        <div>
          <SectionHeader title="Venue Statistics" className="mb-4" />
          {/* Top Rated Venues section */}
          {(() => {
            const topRated = venueDetails
              .filter(v => venueRatingsMap[v.venueKey]?.count >= 2)
              .sort((a, b) => (venueRatingsMap[b.venueKey]?.overallAvg || 0) - (venueRatingsMap[a.venueKey]?.overallAvg || 0))
              .slice(0, 5);
            if (!topRated.length) return null;
            return (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Top Rated</h3>
                <div className="space-y-2">
                  {topRated.map((v, i) => (
                    <div key={v.name} className="flex items-center gap-3 px-4 py-2.5 bg-brand/5 border border-brand/20 rounded-xl">
                      <span className="text-brand/50 font-bold text-sm w-4">#{i+1}</span>
                      <span className="text-primary text-sm flex-1">{v.name}</span>
                      <span className="flex items-center gap-1 text-brand font-semibold text-sm">
                        <Star className="w-3.5 h-3.5" fill="currentColor" />
                        {venueRatingsMap[v.venueKey]?.overallAvg?.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {venueDetails.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">No shows tracked yet</p>
          ) : (
            <div className="space-y-3">
              {venueDetails.map((venue) => (
                <Card key={venue.name} padding="none" className="overflow-hidden">
                  {/* Venue Header */}
                  <button
                    onClick={() => setExpandedVenue(expandedVenue === venue.name ? null : venue.name)}
                    className="w-full flex items-center justify-between px-4 py-4 hover:bg-hover transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown className={`w-5 h-5 text-muted transition-transform ${expandedVenue === venue.name ? 'rotate-180' : ''}`} />
                      <span className="font-medium text-primary">{venue.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      {venueRatingsMap[venue.venueKey] && (
                        <span className="flex items-center gap-1 text-brand text-sm font-semibold">
                          <Star className="w-3.5 h-3.5" fill="currentColor" />
                          {venueRatingsMap[venue.venueKey].overallAvg?.toFixed(1)}
                          <span className="text-brand/50 font-normal">({venueRatingsMap[venue.venueKey].count})</span>
                        </span>
                      )}
                      <Badge tone="neutral" size="sm">{venue.showCount} shows</Badge>
                      <span className="text-secondary text-sm">{venue.artistCount} artists</span>
                    </div>
                  </button>

                  {/* Expanded Years */}
                  {expandedVenue === venue.name && (
                    <div className="border-t border-subtle bg-hover">
                      {onRateVenue && (
                        <div className="px-4 py-3 border-b border-subtle flex items-center justify-between">
                          {venueRatingsMap[venue.venueKey] ? (
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-secondary">Community avg:</span>
                              <span className="text-brand font-semibold flex items-center gap-1">
                                <Star className="w-3.5 h-3.5" fill="currentColor" />
                                {venueRatingsMap[venue.venueKey].overallAvg?.toFixed(1)} / 5
                                <span className="text-brand/50 font-normal">from {venueRatingsMap[venue.venueKey].count} rating{venueRatingsMap[venue.venueKey].count !== 1 ? 's' : ''}</span>
                              </span>
                            </div>
                          ) : <span className="text-muted text-sm">No ratings yet</span>}
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Star}
                            onClick={() => onRateVenue(venue.sampleShow)}
                            className="bg-brand-subtle text-brand hover:bg-brand/30 border border-brand/30"
                          >
                            Rate Venue
                          </Button>
                        </div>
                      )}
                      {venue.years.map(({ year, shows: yearShows }) => (
                        <div key={year}>
                          {/* Year Header */}
                          <button
                            onClick={() => setExpandedYear(expandedYear === `${venue.name}-${year}` ? null : `${venue.name}-${year}`)}
                            className="w-full flex items-center justify-between px-6 py-3 hover:bg-hover transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ChevronDown className={`w-4 h-4 text-muted transition-transform ${expandedYear === `${venue.name}-${year}` ? 'rotate-180' : ''}`} />
                              <span className="font-medium text-brand">{year}</span>
                            </div>
                            <span className="text-secondary text-sm">{yearShows.length} shows</span>
                          </button>

                          {/* Expanded Shows */}
                          {expandedYear === `${venue.name}-${year}` && (
                            <div className="bg-hover">
                              {yearShows.map((show) => (
                                <button
                                  key={show.id}
                                  onClick={() => setSelectedShow(show)}
                                  className="w-full flex items-center justify-between px-8 py-2 hover:bg-hover transition-colors text-left"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-secondary">{formatDate(show.date)}</span>
                                    <span className="text-muted">-</span>
                                    <span style={{ color: artistColor(show.artist) }}>{show.artist}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {show.rating && (
                                      <span className="text-brand text-sm font-medium">{show.rating}/10</span>
                                    )}
                                    <span className="text-muted text-sm">{show.setlist.length} songs</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'years' && (
        <div>
          <SectionHeader title="Shows by Year" className="mb-4" />
          {uniqueYears.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">No shows tracked yet</p>
          ) : (
            <Card variant="elevated" padding="none" className="shadow-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-hover border-b border-subtle">
                    <th className="text-left px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Year</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Shows</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {uniqueYears.map((year) => {
                    const yearShows = showsByYear[year] || [];
                    const ratedShows = yearShows.filter(s => s.rating);
                    const avgRating = ratedShows.length
                      ? (ratedShows.reduce((a, s) => a + s.rating, 0) / ratedShows.length).toFixed(1)
                      : null;
                    const isExpanded = expandedYear === year;

                    return (
                      <React.Fragment key={year}>
                        <tr
                          className="cursor-pointer hover:bg-hover transition-colors"
                          onClick={() => setExpandedYear(isExpanded ? null : year)}
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <ChevronDown className={`w-4 h-4 text-muted flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              <span className="font-bold text-xl text-brand">{year}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <Badge tone="neutral" size="sm">{yearShows.length}</Badge>
                          </td>
                          <td className="px-4 py-4 text-center">
                            {avgRating ? (
                              <span className="text-sm font-semibold text-brand">{avgRating}/10</span>
                            ) : (
                              <span className="text-muted">--</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={3} className="px-4 py-0 bg-hover/30">
                              <div className="py-4 pl-6 border-l-2 border-brand/50 ml-2 mb-2">
                                <div className="text-xs font-semibold text-muted mb-3 uppercase tracking-wide">Shows in {year}</div>
                                <div className="space-y-3">
                                  {yearShows.map((show) => (
                                    <ShowCard
                                      key={show.id}
                                      show={show}
                                      friends={friends}
                                      onClick={() => setSelectedShow(show)}
                                    />
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === 'top' && (
        <div>
          <SectionHeader title="Top Rated Shows" className="mb-4" />
          {topRatedShows.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">No rated shows yet</p>
          ) : (
            <Card variant="elevated" padding="none" className="shadow-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-hover border-b border-subtle">
                    <th className="text-center px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide w-12">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide">Artist</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide">Venue</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide">Date</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide">Rating</th>
                    {onDeleteShow && <th className="px-2 py-3 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {topRatedShows.map((show, i) => (
                    <tr
                      key={show.id}
                      className="group hover:bg-hover transition-colors cursor-pointer"
                      onClick={() => setSelectedShow(show)}
                    >
                      <td className="px-4 py-3 text-center text-lg font-bold text-muted">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium" style={{ color: artistColor(show.artist) }}>{show.artist}</div>
                        {show.tour && <div className="text-xs text-brand font-medium">{show.tour}</div>}
                      </td>
                      <td className="px-4 py-3 text-secondary">
                        {show.venue}{show.city ? `, ${show.city}` : ''}
                      </td>
                      <td className="px-4 py-3 text-secondary">{formatDate(show.date)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone="navy" size="sm">{show.rating || '--'}/10</Badge>
                      </td>
                      {onDeleteShow && (
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowToDelete(show); }}
                            // Was opacity-0 until hover, which on a
                            // touchscreen means never: the control was
                            // invisible and unreachable on a phone. Visible
                            // by default below md:, hover-revealed from
                            // md: up, where the pointer exists.
                            className="tap-target rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-all pressable md:opacity-0 md:group-hover:opacity-100"
                            title="Delete show"
                            aria-label="Delete show"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {onDeleteShow && (
        <DeleteShowModal
          show={showToDelete}
          isOpen={!!showToDelete}
          onClose={() => setShowToDelete(null)}
          onConfirm={onDeleteShow}
        />
      )}
    </div>
  );
}

export default StatsView;
