'use client';

import { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { parseDate } from '@/lib/utils';
import StatsView from '@/components/StatsView';
import { PageHeader, StatTile, SectionHeader, Tag, Card } from '@/components/ui';
import YearHeatmap from '@/components/stats/YearHeatmap';
import StatsSubNav from '@/components/stats/StatsSubNav';
import { useStatsPeriod } from '@/lib/useStatsPeriod';
import ShowFilters from '@/components/shows/ShowFilters';
import useShowFilters from '@/hooks/useShowFilters';

export default function StatsPage() {
  const {
    shows, getSongStats, getArtistStats, getVenueStats, getTopRatedShows,
    updateSongRating,
    updateShowRating, updateShowComment, updateShowData, deleteShow,
    addSongToShow, updateSetlistOrder, resyncSetlistFromSource,
    deleteSong, restoreSongToShow,
    user, friends, guestMode, setTagFriendsShow, setVenueRatingShow, statsTab, availableYears,
    getVenueRatings, normalizeVenueKey, computeVenueAggregate,
    toggleFavoriteArtist, isArtistFavorite,
  } = useApp();

  // Everything on this page — the breakdown tabs, the period tiles and the
  // heatmap — is computed from the filtered set, so every number moves with
  // the filter. Song counts are distinct shows (lib/songCounts.js).
  const {
    filters, setSearchTerm, setFilterYear, setFilterDate, clearFilters, filteredShows,
  } = useShowFilters(shows);
  const { period, setPeriod, periodShows, periodLabels } = useStatsPeriod(filteredShows);


  const monthlyCounts = useMemo(() => {
    const counts = Array(12).fill(0);
    periodShows.forEach(s => {
      const d = parseDate(s.date);
      const m = d.getMonth();
      if (m >= 0 && m < 12) counts[m]++;
    });
    return counts;
  }, [periodShows]);

  const totalSongs = useMemo(() =>
    periodShows.reduce((acc, s) => acc + (s.setlist?.length || 0), 0),
  [periodShows]);

  // Estimate hours of live music (~2h avg per show) — good enough without duration data
  const estimatedHours = useMemo(() => Math.round(periodShows.length * 2), [periodShows]);

  const uniqueArtists = useMemo(() =>
    new Set(periodShows.map(s => s.artist)).size,
  [periodShows]);

  const uniqueVenues = useMemo(() =>
    new Set(periodShows.map(s => s.venue)).size,
  [periodShows]);

  return (
    <>
      {/* Header — no actions prop so the title always gets full width */}
      <PageHeader
        eyebrow="Stats"
        title="Your year, in shows."
        subtitle={periodShows.length > 0
          ? `${periodShows.length} shows. ${uniqueArtists} artists. ${uniqueVenues} venues. Let's look at the tape.`
          : shows.length > 0
            ? 'No shows match these filters.'
            : 'Add some shows to start seeing your stats'}
      />

      <StatsSubNav active="overview" />

      {shows.length > 0 && (
        <ShowFilters
          panelId="stats-filter-panel"
          searchTerm={filters.searchTerm}
          filterYear={filters.filterYear}
          filterDate={filters.filterDate}
          onSearchChange={setSearchTerm}
          onYearChange={setFilterYear}
          onDateChange={setFilterDate}
          onClear={clearFilters}
          availableYears={availableYears}
        />
      )}

      <SectionHeader title="Detailed breakdown" className="mb-4" />
      <StatsView
        shows={filteredShows}
        allShows={shows}
        songStats={getSongStats(filteredShows)}
        artistStats={getArtistStats(filteredShows)}
        venueStats={getVenueStats(filteredShows)}
        topRatedShows={getTopRatedShows(filteredShows)}
        onRateSong={updateSongRating}
        onRateShow={updateShowRating}
        onCommentShow={updateShowComment}
        onUpdateVenueRating={(showId, venueRating) => updateShowData(showId, { venueRating })}
        onDeleteShow={deleteShow}
        onAddSong={!guestMode ? addSongToShow : undefined}
        onReorderSetlist={!guestMode ? updateSetlistOrder : undefined}
        onResyncSetlist={!guestMode ? resyncSetlistFromSource : undefined}
        onDeleteSong={!guestMode ? deleteSong : undefined}
        onRestoreSong={restoreSongToShow}
        initialTab={statsTab}
        onTagFriends={!guestMode ? (show) => setTagFriendsShow(show) : undefined}
        onRateVenue={user && !guestMode ? (show) => setVenueRatingShow(show) : undefined}
        onToggleFavoriteArtist={!guestMode ? toggleFavoriteArtist : undefined}
        isArtistFavorite={isArtistFavorite}
        fetchVenueRatings={getVenueRatings}
        normalizeVenueKey={normalizeVenueKey}
        computeVenueAggregate={computeVenueAggregate}
        friends={friends}
        user={user}
      />

      {/* Period selector — scrollable strip */}
      <div data-no-swipe className="flex gap-2 overflow-x-auto pb-1 mb-6 mt-10 scrollbar-none">
        {periodLabels.map((p) => (
          <Tag
            key={p}
            selected={p === period}
            onClick={() => setPeriod(p)}
            className="flex-shrink-0"
          >
            {p === 'all-time' ? 'All-time' : p}
          </Tag>
        ))}
      </div>

      {periodShows.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
            <StatTile value={periodShows.length} label="Shows" />
            <StatTile value={estimatedHours} label="Hours of live music" tone="brand" />
            <StatTile value={totalSongs.toLocaleString()} label="Songs heard" />
            <StatTile value={uniqueArtists} label="Artists" />
          </div>

          <Card padding="lg" className="mb-5">
            <SectionHeader
              title="Show frequency"
              subtitle={period === 'all-time' ? 'All time · shows per month' : `${period} · shows per month`}
            />
            <YearHeatmap
              counts={monthlyCounts}
              year={period === 'all-time' ? null : period}
            />
          </Card>
        </>
      )}
    </>
  );
}
