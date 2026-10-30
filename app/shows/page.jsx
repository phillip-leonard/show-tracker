'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { useDismissStack } from '@/context/DismissStackContext';
import { formatDate, artistColor } from '@/lib/utils';
import ShowForm from '@/components/ShowForm';
import TagFriendsModal from '@/components/TagFriendsModal';
import PlaylistCreatorModal from '@/components/PlaylistCreatorModal';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';
import ArtistShowsRow from '@/components/ArtistShowsRow';
import ShowsListSkeleton from '@/components/ui/ShowsListSkeleton';
import { Button, Card, PageHeader, StatFigure } from '@/components/ui';
import ShowCard from '@/components/shows/ShowCard';
import ShowFilters from '@/components/shows/ShowFilters';
import useRunIndex, { useTourIndex } from '@/hooks/useRunIndex';
import { tourKeyFor, tourHref } from '@/lib/runIndex';
import DeleteShowModal from '@/components/shows/DeleteShowModal';
import { removeFromBucketList } from '@/lib/bucketList';
import YearInReviewCard from '@/components/yearInReview/YearInReviewCard';
import ReliveThisNightCard from '@/components/shows/ReliveThisNightCard';
import { reliveShowFor } from '@/lib/reliveThisNight';
import ShowDetailView from '@/components/shows/ShowDetailView';
import SplitView from '@/components/layout/SplitView';
import useContentColumnWidth from '@/hooks/useContentColumnWidth';
import { SPLIT_VIEW_MIN_WIDTH, splitPaneHasSideColumn } from '@/lib/platform';
import ArchiveBackfillCard from '@/components/shows/ArchiveBackfillCard';
import ArchiveProposalReview from '@/components/shows/ArchiveProposalReview';
import VenueShowsView from '@/components/shows/VenueShowsView';
import UpcomingShowsSection from '@/components/upcoming/UpcomingShowsSection';
import UpcomingShowForm from '@/components/upcoming/UpcomingShowForm';
import UpcomingShowDetailView from '@/components/upcoming/UpcomingShowDetailView';
import { showHref } from '@/lib/showRouting';
import { getSavedSearches } from '@/lib/savedSearches';
import { filterShows } from '@/lib/advancedSearch';
import {
  Search, Camera, Upload,
  Bell, ChevronRight, ChevronLeft, Calendar, MapPin, Check, Tag, Sparkles, ArrowLeft,
  Bookmark,
} from 'lucide-react';

export default function ShowsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailShowId = searchParams.get('show');
  const venueKeyParam = searchParams.get('venueKey');
  const upcomingParam = searchParams.get('upcoming');

  const {
    shows, isLoading, showsLoadedFor, user, guestMode,
    selectedArtist, setSelectedArtist,
    showForm, setShowForm,
    bucketListPrefill, setBucketListPrefill,
    setToast,
    searchTerm, setSearchTerm,
    filterYear, setFilterYear, filterDate, setFilterDate, availableYears,
    sortBy, setSortBy,
    addShow, updateShowRating, updateShowComment, deleteShow, updateShowData, backfillArtistImages,
    addSongToShow, updateSetlistOrder, resyncSetlistFromSource,
    proposeSetlistFromSource, applySetlistProposal,
    pendingProposalShows, acceptStoredProposal, declineStoredProposal, clearSetlistReview,
    deleteSong, restoreSongToShow,
    tagFriendsAtShow, tagFriendByEmail,
    tagFriendsShow, setTagFriendsShow,
    friends, visibleFriends, festivals,
    pendingNotificationCount, pendingFriendRequests, pendingShowTags,
    setFriendsInitialTab, navigateTo,
    summaryStats, userRank, statsTab, setStatsTab,
    sortedFilteredShows, artistGroups, importedIds,
    pendingTagsForReview, acceptPendingEmailTag, declinePendingEmailTag,
    toggleFavoriteArtist, isArtistFavorite,
    blockedUserIds,
    upcomingShows, upcomingLoaded, addUpcomingShow, updateUpcomingShow, deleteUpcomingShow,
    tagFriendsAtUpcomingShow, untagFriendFromUpcomingShow, loadUpcomingTagStatuses,
    findSetlistForUpcomingShow, convertUpcomingShow,
  } = useApp();

  // Closing a show returns to wherever it was opened from — Search after
  // adding one, a toast's "View show", My Shows itself — the same rule the
  // mobile header's back control follows. With no in-app history (a cold
  // deep link) it falls back to the list.
  const { canGoBack } = useDismissStack();
  const closeDetail = () => (canGoBack ? router.back() : router.push('/shows/'));

  const [playlistShow, setPlaylistShow] = useState(null);
  // Upcoming shows (5.43.0): the add/edit form ({ show } when editing) and
  // the friend picker, shared by the list section and the detail view.
  const [upcomingForm, setUpcomingForm] = useState(null);
  const [upcomingTagShow, setUpcomingTagShow] = useState(null);
  const [showToDelete, setShowToDelete] = useState(null);
  const [showsTab, setShowsTab] = useState('timeline'); // 'timeline' | 'artist'

  // Saved searches from Advanced Search (lib/savedSearches.js), surfaced
  // here as quick-filter toggles next to Sort — see toggleSavedSearch below.
  const [savedSearches, setSavedSearches] = useState([]);
  const [activeSavedSearch, setActiveSavedSearch] = useState(null); // { name, filters } | null

  useEffect(() => {
    if (!user) return;
    setSavedSearches(getSavedSearches(user.uid));
  }, [user]);

  const upcomingDetail = useMemo(() =>
    upcomingParam ? (upcomingShows || []).find(u => u.id === upcomingParam) || null : null,
    [upcomingShows, upcomingParam]
  );

  // Rendered by both the list and the upcoming detail view.
  const upcomingModals = (
    <>
      {upcomingForm && (
        <UpcomingShowForm
          open
          initial={upcomingForm.show || null}
          onClose={() => setUpcomingForm(null)}
          onSave={(input) => (upcomingForm.show
            ? updateUpcomingShow(upcomingForm.show, input)
            : addUpcomingShow(input))}
        />
      )}
      {upcomingTagShow && (
        <TagFriendsModal
          upcoming
          show={upcomingTagShow}
          // Friends already on the list aren't offered again.
          friends={visibleFriends.filter(f => !(upcomingTagShow.taggedFriendUids || []).includes(f.friendUid))}
          onTag={async (uids) => { await tagFriendsAtUpcomingShow(upcomingTagShow, uids); setUpcomingTagShow(null); }}
          onClose={() => setUpcomingTagShow(null)}
        />
      )}
    </>
  );

  const detailShow = useMemo(() =>
    detailShowId ? shows.find(s => s.id === detailShowId) : null,
    [shows, detailShowId]
  );

  // Native app with a wide content column (iPad, iPhone Duo open): the open show
  // sits beside a list of the others. See hooks/useSplitView.js.
  const columnWidth = useContentColumnWidth();
  const splitView = columnWidth >= SPLIT_VIEW_MIN_WIDTH;

  // Arriving from BucketListView's "Mark Attended" — open the manual add
  // form pre-filled with the saved show, and clear the prefill so it
  // doesn't re-trigger on a later visit to this page.
  useEffect(() => {
    if (bucketListPrefill) setShowForm(true);
  }, [bucketListPrefill, setShowForm]);

  const handleAddShowFromBucketList = async (formData) => {
    const result = await addShow(formData);
    if (bucketListPrefill?.bucketListKey) {
      try {
        await removeFromBucketList(user.uid, bucketListPrefill.bucketListKey);
      } catch (err) {
        console.error('[bucketList] Failed to remove after marking attended:', err);
        setToast?.('Show added, but removing it from your bucket list failed.');
      }
    }
    setBucketListPrefill(null);
    return result;
  };

  // Lightweight badges on each ShowCard for a run ("Night 2 of 3") or a
  // linkable tour name — kept as a shallow lookup by showId so ShowCard
  // itself stays a plain presentational component.
  const runIndex = useRunIndex();
  const tourIndex = useTourIndex();
  const runInfoByShowId = useMemo(() => {
    const map = new Map();
    Object.values(runIndex).forEach(run => {
      run.nights.forEach((night, i) => {
        map.set(night.showId, { runKey: run.key, nightNumber: i + 1, nightCount: run.nightCount });
      });
    });
    return map;
  }, [runIndex]);
  const tourHrefFor = (show) => {
    if (!show.tour) return null;
    const key = tourKeyFor(show.artist, show.tour);
    return key && tourIndex[key] ? tourHref(key) : null;
  };
  const festivalById = useMemo(() => new Map((festivals || []).map(f => [f.id, f])), [festivals]);

  // A saved search's filters can include a tour/festival, which (like
  // AdvancedSearchView) need to be resolved to show-id sets before
  // lib/advancedSearch.js's filterShows can match on them.
  const activeTourShowIds = useMemo(() => {
    const key = activeSavedSearch?.filters?.tourKey;
    if (!key || !tourIndex[key]) return null;
    return new Set(tourIndex[key].stops.map(s => s.showId));
  }, [activeSavedSearch, tourIndex]);
  const activeFestivalShowIds = useMemo(() => {
    const key = activeSavedSearch?.filters?.festivalKey;
    if (!key) return null;
    return new Set(shows.filter(s => s.festivalId === key).map(s => s.id));
  }, [activeSavedSearch, shows]);
  const savedSearchShows = useMemo(() => {
    if (!activeSavedSearch) return null;
    return filterShows(shows, activeSavedSearch.filters, {
      tourShowIds: activeTourShowIds,
      festivalShowIds: activeFestivalShowIds,
    })
      .map(r => r.show)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [activeSavedSearch, shows, activeTourShowIds, activeFestivalShowIds]);
  // What the list actually renders — the saved search's richer filter when
  // one is active, otherwise the simple searchTerm/year/date filter from
  // context. Kept as one name so the render below never has to choose.
  const displayedShows = activeSavedSearch ? (savedSearchShows || []) : sortedFilteredShows;

  // Arriving from a Top Artists / Top Venues row: seed the filter from the
  // URL once, then drop it from the URL so refreshing doesn't re-trigger it.
  const [filterLabel, setFilterLabel] = useState(null); // { type: 'artist'|'venue', name }

  // The single source of truth for "no filter is active" — used both by the
  // mount effect below and by any in-page control (the venue page's own
  // back button) that needs to guarantee an unfiltered list without waiting
  // on a route change to remount this component.
  const clearFilters = () => {
    setSearchTerm('');
    setFilterYear('');
    setFilterDate('');
    setFilterLabel(null);
  };

  // Applying a saved search replaces the simple text/year/date filter
  // (they're separate filtering systems — see displayedShows above), and
  // clicking the same one again turns it back off.
  const toggleSavedSearch = (s) => {
    if (activeSavedSearch?.name === s.name) {
      setActiveSavedSearch(null);
    } else {
      clearFilters();
      setActiveSavedSearch(s);
    }
  };

  // Runs once per mount — deliberately not keyed on `searchParams`, so
  // opening/closing a show detail (?show=) on this same route (no remount)
  // never touches the filter. The reset half only fires because navigating
  // here via the "My Shows" nav link (href="/") lands on a *different*
  // route than /shows/?venue=..., which does remount this component fresh.
  //
  // This is the single source of truth for "did I arrive with a filter":
  // when none of artist/venue/year is present, every filter field is
  // cleared explicitly — the previous version only ever set these fields
  // from the URL and never cleared them, so a filter picked up from Top
  // Venues/Top Artists/a venue link stuck around forever, including after
  // navigating to the unfiltered My Shows list.
  useEffect(() => {
    const artist = searchParams.get('artist');
    const venue = searchParams.get('venue');
    const year = searchParams.get('year');
    if (artist) {
      setSearchTerm(artist);
      setFilterLabel({ type: 'artist', name: artist });
      setFilterYear(year || '');
      setFilterDate('');
    } else if (venue) {
      setSearchTerm(venue);
      setFilterLabel({ type: 'venue', name: venue });
      setFilterYear(year || '');
      setFilterDate('');
    } else {
      clearFilters();
    }
    if (artist || venue || year) {
      const url = new URL(window.location.href);
      url.searchParams.delete('artist');
      url.searchParams.delete('venue');
      url.searchParams.delete('year');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backfill artist images for existing shows — runs once after shows load, non-blocking
  useEffect(() => {
    if (isLoading || !shows.length) return;
    const hasMissing = shows.some(s => !s.artistImage);
    if (hasMissing) {
      // Delay start so the page renders first
      const timer = setTimeout(() => backfillArtistImages(), 3000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (isLoading) {
    return <ShowsListSkeleton />;
  }

  // Detail view: when ?show=<id> is present, render the detail instead of the list
  if (detailShowId) {
    if (!detailShow) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-lg text-primary mb-4">Show not found.</p>
          <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push('/shows/')}>
            Back to shows
          </Button>
        </div>
      );
    }

    const detailView = (
      <ShowDetailView
        show={detailShow}
        sideColumn={splitView ? splitPaneHasSideColumn(columnWidth) : undefined}
        friends={friends}
        onClose={closeDetail}
        backLabel={canGoBack ? 'Back' : 'All shows'}
        onUpdateRating={updateShowRating}
        onUpdateVenueRating={(showId, venueRating) => updateShowData(showId, { venueRating })}
        onUpdateComment={!guestMode ? (showId, comment) => updateShowComment(showId, comment) : undefined}
        festival={detailShow.festivalId ? festivals.find(f => f.id === detailShow.festivalId) || null : null}
        onTagFriends={!guestMode ? (s) => setTagFriendsShow(s) : undefined}
        onCreatePlaylist={PLAYLIST_CREATION_ENABLED && !guestMode ? (s) => setPlaylistShow(s) : undefined}
        onDeleteShow={deleteShow}
        onAddSong={!guestMode ? addSongToShow : undefined}
        onReorderSetlist={!guestMode ? updateSetlistOrder : undefined}
        onResyncSetlist={!guestMode ? resyncSetlistFromSource : undefined}
        onProposeSetlist={!guestMode ? proposeSetlistFromSource : undefined}
        onApplySetlist={!guestMode ? applySetlistProposal : undefined}
        onAcceptProposal={!guestMode ? acceptStoredProposal : undefined}
        onDeclineProposal={!guestMode ? declineStoredProposal : undefined}
        onClearReview={!guestMode ? clearSetlistReview : undefined}
        onDeleteSong={!guestMode ? deleteSong : undefined}
        onRestoreSong={restoreSongToShow}
        toggleFavoriteArtist={!guestMode ? toggleFavoriteArtist : undefined}
        isArtistFavorite={isArtistFavorite}
        allShows={shows}
        user={user}
      />
    );

    return (
      <>
        {splitView ? (
          <SplitView
            label="Your shows"
            items={displayedShows.map((s) => ({
              id: s.id,
              title: s.artist,
              titleColor: artistColor(s.artist),
              subtitle: `${formatDate(s.date)}${s.venue ? ` · ${s.venue}` : ''}`,
            }))}
            selectedId={detailShow.id}
            onSelect={(id) => {
              // Replace, not push: switching shows in the pane is one
              // place in history, so back still leaves the detail in a
              // single step. The page itself is what scrolls, so start
              // the new show at its top.
              router.replace(showHref(id));
              window.scrollTo({ top: 0 });
            }}
          >
            {detailView}
          </SplitView>
        ) : detailView}
        {tagFriendsShow && (
          <TagFriendsModal
            show={tagFriendsShow}
            friends={visibleFriends}
            onTag={(selectedFriendUids) => tagFriendsAtShow(tagFriendsShow, selectedFriendUids)}
            onInviteByEmail={(params) => tagFriendByEmail({ ...params, show: tagFriendsShow })}
            onClose={() => setTagFriendsShow(null)}
          />
        )}
        {playlistShow && (
          <PlaylistCreatorModal
            show={playlistShow}
            onClose={() => setPlaylistShow(null)}
          />
        )}
      </>
    );
  }

  // Upcoming show detail: ?upcoming=<id>. Same real /shows route as a past
  // show (CLAUDE.md's routing section), its own view.
  if (upcomingParam) {
    if (!upcomingLoaded) return <ShowsListSkeleton />;
    if (!upcomingDetail) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-lg text-primary mb-4">That upcoming show isn&apos;t here any more.</p>
          <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push('/shows/')}>
            Back to shows
          </Button>
        </div>
      );
    }
    return (
      <>
        <UpcomingShowDetailView
          show={upcomingDetail}
          friends={visibleFriends}
          blockedUserIds={blockedUserIds}
          backLabel={canGoBack ? 'Back' : 'All shows'}
          onClose={closeDetail}
          onEdit={(show) => setUpcomingForm({ show })}
          onDelete={async (show) => { await deleteUpcomingShow(show); router.replace('/shows/'); }}
          onTagFriends={(show) => setUpcomingTagShow(show)}
          onUntagFriend={untagFriendFromUpcomingShow}
          loadTagStatuses={loadUpcomingTagStatuses}
          onConvert={async (show) => {
            const setlist = await findSetlistForUpcomingShow(show);
            const result = await convertUpcomingShow(show, { setlist });
            // replace, not push: the upcoming show no longer exists, so
            // back from the new show shouldn't land on "not here any more".
            if (result?.id) router.replace(showHref(result.id));
          }}
        />
        {upcomingModals}
      </>
    );
  }

  // Venue view: when ?venueKey=<key> is present, render the user's shows at
  // that venue instead of the list. Distinct from the ?artist=/?venue=
  // params the Top Artists/Top Venues rows use (which just seed the text
  // filter below) — this is a dedicated page, reached from the venue info
  // dropdown's "All shows at this venue" link.
  if (venueKeyParam) {
    return (
      <VenueShowsView
        venueKey={venueKeyParam}
        shows={shows}
        friends={friends}
        runInfoByShowId={runInfoByShowId}
        tourHrefFor={tourHrefFor}
        festivalById={festivalById}
        onBackToMyShows={() => { clearFilters(); router.push('/shows/'); }}
      />
    );
  }

  // "Relive this night's magic" — only on the plain, unfiltered list of a
  // signed-in user's own loaded shows. Asked only here, because the first
  // ask of the day is what uses up the day (lib/reliveThisNight.js): a
  // filtered visit, or the email-tag review, must not spend it unseen.
  const reliveShow = user && !guestMode && showsLoadedFor === user.uid
    && !filterLabel && !activeSavedSearch
    && !(pendingTagsForReview && pendingTagsForReview.length > 0)
    ? reliveShowFor(user.uid, shows)
    : null;

  return (
    <>
      {/* Pending email tags review — shown once after signup if shows were tagged */}
      {pendingTagsForReview && pendingTagsForReview.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-brand-subtle rounded-xl flex items-center justify-center">
              <Tag className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary">Your friends tagged you in some shows!</h1>
              <p className="text-secondary text-sm">Review them and add any to your history.</p>
            </div>
          </div>
          <div className="space-y-4">
            {pendingTagsForReview.map(tag => (
              <Card key={tag.id} padding="none" className="p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="text-lg font-bold" style={{ color: '#f59e0b' }}>{tag.showData?.artist}</div>
                    <div className="flex items-center gap-3 text-sm text-secondary mt-1 flex-wrap">
                      {tag.showData?.date && (
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(tag.showData.date)}</span>
                      )}
                      {tag.showData?.venue && (
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{tag.showData.venue}</span>
                      )}
                      {tag.showData?.city && <span>{tag.showData.city}</span>}
                    </div>
                    <div className="text-sm text-muted mt-1">Tagged by {tag.fromName}</div>
                    {tag.personalMessage && (
                      <p className="text-sm text-secondary italic mt-2">&ldquo;{tag.personalMessage}&rdquo;</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Check}
                    onClick={() => acceptPendingEmailTag(tag)}
                    className="flex-1"
                  >
                    Add to My History
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => declinePendingEmailTag(tag)}
                    className="flex-1"
                  >
                    Not Me — Skip
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {(!pendingTagsForReview || pendingTagsForReview.length === 0) && (
        <>
          {filterLabel && (
            <Link
              href={filterLabel.type === 'artist' ? '/stats/top-artists' : '/stats/top-venues'}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:text-primary mb-3 min-h-touch md:fine:min-h-0"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to {filterLabel.type === 'artist' ? 'Top Artists' : 'Top Venues'}
            </Link>
          )}
          <PageHeader
            compact
            eyebrow={activeSavedSearch ? 'Saved Search' : filterLabel ? (filterLabel.type === 'artist' ? 'Top Artists' : 'Top Venues') : 'Library'}
            title={activeSavedSearch
              ? `"${activeSavedSearch.name}"`
              : filterLabel
                ? (filterLabel.type === 'artist'
                    ? `Your${filterYear ? ` ${filterYear}` : ''} shows seeing ${filterLabel.name}`
                    : `Your${filterYear ? ` ${filterYear}` : ''} shows at ${filterLabel.name}`)
                : 'My Shows'}
            subtitle={activeSavedSearch
              ? `${displayedShows.length} show${displayedShows.length !== 1 ? 's' : ''}`
              : filterLabel
                ? `${sortedFilteredShows.length} show${sortedFilteredShows.length !== 1 ? 's' : ''}`
                : (shows.length > 0
                  ? `${shows.length} shows · ${summaryStats.uniqueArtists} artists · ${summaryStats.uniqueVenues} venues`
                  : 'Your concert journey starts here')}
            actions={
              <>
                <Button variant="secondary" icon={Camera} onClick={() => navigateTo('scan-import')}>Scan / Import</Button>
                <Button icon={Search} onClick={() => navigateTo('search')}>Search for a Show</Button>
              </>
            }
          />

          {reliveShow && (
            <ReliveThisNightCard
              show={reliveShow}
              friends={friends}
              runInfo={runInfoByShowId.get(reliveShow.id) || null}
              tourHref={tourHrefFor(reliveShow)}
              festival={reliveShow.festivalId ? festivalById.get(reliveShow.festivalId) || null : null}
            />
          )}

          {!filterLabel && !activeSavedSearch && !guestMode && <YearInReviewCard shows={shows} user={user} />}

          {/* Grateful Dead shows with no setlist, offered from the Internet
              Archive for review — nothing is saved without a tap per show. */}
          {/* Proposals from the Internet Archive backfill for shows that
              already have a setlist: reviewed here, accepted or kept one at
              a time, or all at once after seeing the total. */}
          {!filterLabel && !activeSavedSearch && !guestMode && (
            <ArchiveProposalReview
              shows={pendingProposalShows}
              onAccept={acceptStoredProposal}
              onDecline={declineStoredProposal}
            />
          )}

          {!filterLabel && !activeSavedSearch && !guestMode && (
            <ArchiveBackfillCard
              shows={shows}
              onPropose={proposeSetlistFromSource}
              onApply={applySetlistProposal}
            />
          )}

          {/* Friend request / show tag notification banner */}
          {!guestMode && pendingNotificationCount > 0 && (
            <button
              onClick={() => {
                setFriendsInitialTab('requests');
                navigateTo('friends');
              }}
              className="w-full mb-4 flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber/20 to-brand-glow border border-amber/30 rounded-xl hover:from-amber/30 hover:to-brand-glow transition-all group"
            >
              <div className="relative">
                <Bell className="w-5 h-5 text-amber" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-danger rounded-full animate-pulse" />
              </div>
              <span className="text-primary text-sm font-medium">
                {pendingFriendRequests.length > 0 && pendingShowTags.length > 0
                  ? `You have ${pendingFriendRequests.length} friend request${pendingFriendRequests.length !== 1 ? 's' : ''} and ${pendingShowTags.length} show tag${pendingShowTags.length !== 1 ? 's' : ''}`
                  : pendingFriendRequests.length > 0
                    ? `You have ${pendingFriendRequests.length} pending friend request${pendingFriendRequests.length !== 1 ? 's' : ''}`
                    : `You were tagged in ${pendingShowTags.length} show${pendingShowTags.length !== 1 ? 's' : ''} by friends`
                }
              </span>
              <ChevronRight className="w-4 h-4 text-amber/60 ml-auto group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          {shows.length > 0 && (
            // One compact four-across row on phones; from md: up this is the
            // original grid (gap-3.5, mb-6, p-4 cards, full-size figures).
            <div className="grid grid-cols-4 gap-2 mb-4 md:gap-3.5 md:mb-6">
              <Card padding="none" className="px-2.5 py-2 md:p-4"><StatFigure compact value={shows.length} label="Shows" /></Card>
              <Card padding="none" className="px-2.5 py-2 md:p-4"><StatFigure compact value={summaryStats.uniqueArtists} label="Artists" /></Card>
              <Card padding="none" className="px-2.5 py-2 md:p-4"><StatFigure compact value={summaryStats.uniqueVenues} label="Venues" /></Card>
              <Card padding="none" className="px-2.5 py-2 md:p-4"><StatFigure compact value={summaryStats.avgRating ? `${summaryStats.avgRating}★` : '--'} label="Avg Rating" /></Card>
            </div>
          )}

          {/* Upcoming shows — signed-in only (they live in Firestore), and
              out of the way while a filter or saved search narrows the list. */}
          {user && !guestMode && !filterLabel && !activeSavedSearch && upcomingLoaded && (
            <UpcomingShowsSection
              upcomingShows={upcomingShows}
              onAdd={() => setUpcomingForm({})}
            />
          )}

          {/* View tabs — Timeline (card grid) vs By Artist (table). Hidden
              while a saved search is active: it has its own single-list
              display below, like Advanced Search's own results. */}
          {shows.length > 0 && !activeSavedSearch && (
            <div className="flex items-center gap-1 border-b border-subtle mb-4 md:mb-6">
              {[
                { id: 'timeline', label: 'Timeline', count: sortedFilteredShows.length },
                { id: 'artist', label: 'By artist', count: artistGroups.length },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setShowsTab(t.id)}
                  className={`px-4 pb-2.5 md:pb-3 pt-1 text-[14px] font-semibold transition-colors border-b-2 -mb-px ${
                    showsTab === t.id
                      ? 'border-brand text-primary'
                      : 'border-transparent text-muted hover:text-secondary'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-[11px] font-bold ${showsTab === t.id ? 'text-brand' : 'text-muted'}`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Search, Filter & Sort — the shared filter card (also on Stats,
              Tours and Festivals), with My Shows' own extras in its slots:
              Advanced search on the filter row, Sort and saved searches
              below it. */}
          <ShowFilters
            panelId="shows-filter-panel"
            searchTerm={searchTerm}
            filterYear={filterYear}
            filterDate={filterDate}
            onSearchChange={setSearchTerm}
            onYearChange={(y) => { setFilterYear(y); setFilterDate(''); }}
            onDateChange={(d) => { setFilterDate(d); setFilterYear(''); }}
            onClear={() => { setFilterYear(''); setFilterDate(''); setSearchTerm(''); setFilterLabel(null); setActiveSavedSearch(null); }}
            availableYears={availableYears}
            extraActiveCount={activeSavedSearch ? 1 : 0}
            actions={
              <Link href="/advanced-search/">
                <Button variant="ghost" size="sm" icon={Search}>Advanced search</Button>
              </Link>
            }
          >
            {/* Sort buttons, plus any saved searches from Advanced Search as
                quick-filter toggles — a saved search replaces sortBy's
                artist/rating ordering with its own filtered, date-sorted
                list (see displayedShows above), so the two button groups
                are visually separated rather than implying they combine. */}
            {(shows.length > 1 || savedSearches.length > 0) && (
              <>
                {shows.length > 1 && (
                  <>
                    <span className="text-sm font-medium text-secondary">Sort:</span>
                    {['artist', 'rating'].map(opt => (
                      <Button
                        key={opt}
                        size="sm"
                        variant="ghost"
                        onClick={() => setSortBy(opt)}
                        className={sortBy === opt
                          ? 'bg-brand-subtle text-brand border border-brand/30'
                          : 'text-secondary border border-subtle'}
                      >
                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                      </Button>
                    ))}
                  </>
                )}
                {savedSearches.length > 0 && (
                  <>
                    {shows.length > 1 && <span className="w-px h-4 bg-subtle mx-1" aria-hidden="true" />}
                    <span className="text-sm font-medium text-secondary">Saved:</span>
                    {savedSearches.map(s => (
                      <Button
                        key={s.name}
                        size="sm"
                        variant="ghost"
                        icon={Bookmark}
                        onClick={() => toggleSavedSearch(s)}
                        className={activeSavedSearch?.name === s.name
                          ? 'bg-brand-subtle text-brand border border-brand/30'
                          : 'text-secondary border border-subtle'}
                      >
                        {s.name}
                      </Button>
                    ))}
                  </>
                )}
              </>
            )}
          </ShowFilters>

          {/* Empty state */}
          {displayedShows.length === 0 && !showForm && (
            <div className="text-center py-12 md:py-16">
              <div className="w-24 h-24 bg-gradient-to-br from-brand/20 to-amber/20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-brand/30">
                <Sparkles className="w-12 h-12 text-brand" />
              </div>
              <h2 className="text-2xl font-bold text-primary mb-2">Your Concert Journey Starts Here</h2>
              <p className="text-secondary mb-6 max-w-md mx-auto">
                Build your personal concert history with setlists, ratings, and stats.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-3 mb-8">
                <Button
                  variant="primary"
                  size="lg"
                  icon={Search}
                  onClick={() => navigateTo('search')}
                  className="relative"
                >
                  {/* Decorative pulse. Hidden below sm: — animate-ping
                      scales to 2x, and this button is near full-width when
                      the row stacks, so the ring's bounding box ran past a
                      390px viewport and gave the page a horizontal scroll.
                      Kept from sm: up, where the button is narrow enough
                      for the halo to fit. */}
                  <span className="hidden sm:block absolute inset-0 rounded-full bg-brand animate-ping opacity-20 pointer-events-none" />
                  Search for a Show
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  icon={Upload}
                  onClick={() => navigateTo('scan-import')}
                  className="bg-amber-subtle text-amber border border-amber/30 hover:bg-amber/20"
                >
                  Bulk Import
                </Button>
              </div>
              <Card padding="md" className="max-w-lg mx-auto text-left">
                <h3 className="text-primary font-semibold mb-4 text-center">Quick ways to add your shows</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-amber-subtle rounded-lg flex items-center justify-center flex-shrink-0">
                      <Camera className="w-4 h-4 text-amber" />
                    </div>
                    <div>
                      <p className="text-primary font-medium text-sm">Screenshot Import</p>
                      <p className="text-secondary text-xs">Take a screenshot of your Ticketmaster, AXS, or StubHub past events and our AI will extract your shows</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-brand-subtle rounded-lg flex items-center justify-center flex-shrink-0">
                      <Upload className="w-4 h-4 text-brand" />
                    </div>
                    <div>
                      <p className="text-primary font-medium text-sm">CSV / Excel Import</p>
                      <p className="text-secondary text-xs">Upload a .csv, .xlsx, or .xls spreadsheet with your concert history</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-brand-subtle rounded-lg flex items-center justify-center flex-shrink-0">
                      <Search className="w-4 h-4 text-brand" />
                    </div>
                    <div>
                      <p className="text-primary font-medium text-sm">Search setlist.fm</p>
                      <p className="text-secondary text-xs">Search by artist to find shows with full setlists from setlist.fm</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Manual add form */}
          {showForm && (
            <ShowForm
              onSubmit={bucketListPrefill ? handleAddShowFromBucketList : addShow}
              onCancel={() => { setShowForm(false); setBucketListPrefill(null); }}
              friends={user && !guestMode ? visibleFriends : []}
              onTagFriends={tagFriendsAtShow}
              initialData={bucketListPrefill}
            />
          )}

          {/* Timeline: show list. Always the timeline shape while a saved
              search is active — see the tab switcher above, hidden in that
              state for the same reason. */}
          {(showsTab === 'timeline' || activeSavedSearch) && displayedShows.length > 0 && (
            <div className="space-y-3 mb-8">
              {displayedShows.map(show => (
                <ShowCard
                  key={show.id}
                  show={show}
                  friends={friends}
                  onClick={() => router.push(showHref(show.id))}
                  onDelete={() => setShowToDelete(show)}
                  runInfo={runInfoByShowId.get(show.id) || null}
                  tourHref={tourHrefFor(show)}
                  festival={show.festivalId ? festivalById.get(show.festivalId) || null : null}
                />
              ))}
            </div>
          )}

          {/* Artist groups table */}
          {showsTab === 'artist' && !activeSavedSearch && sortedFilteredShows.length > 0 && (
            <Card variant="elevated" padding="none" className="shadow-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-hover border-b border-subtle">
                    <th className="text-left px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Artist</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Shows</th>
                    <th className="text-center px-4 py-4 text-xs font-semibold text-secondary uppercase tracking-wide">Avg Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {artistGroups.map(([artist, artistShows]) => (
                    <ArtistShowsRow
                      key={artist}
                      artist={artist}
                      shows={artistShows}
                      expanded={selectedArtist === artist}
                      onToggle={() => setSelectedArtist(selectedArtist === artist ? null : artist)}
                      onSelectShow={(show) => router.push(showHref(show.id))}
                      onDeleteShow={(show) => setShowToDelete(show)}
                      onRateShow={updateShowRating}
                    />
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Tag friends modal */}
          {tagFriendsShow && (
            <TagFriendsModal
              show={tagFriendsShow}
              friends={visibleFriends}
              onTag={(selectedFriendUids) => tagFriendsAtShow(tagFriendsShow, selectedFriendUids)}
              onInviteByEmail={(params) => tagFriendByEmail({ ...params, show: tagFriendsShow })}
              onClose={() => setTagFriendsShow(null)}
            />
          )}

          {/* Playlist creator modal */}
          {playlistShow && (
            <PlaylistCreatorModal
              show={playlistShow}
              onClose={() => setPlaylistShow(null)}
            />
          )}

          {upcomingModals}

          {/* Delete show confirmation modal */}
          <DeleteShowModal
            show={showToDelete}
            isOpen={!!showToDelete}
            onClose={() => setShowToDelete(null)}
            onConfirm={deleteShow}
          />

        </>
      )}
    </>
  );
}
