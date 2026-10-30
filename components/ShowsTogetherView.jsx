'use client';

import React, { useState, useEffect } from 'react';
import { Music, Calendar, MapPin, ChevronLeft, ChevronDown, MessageSquare, RefreshCw, Eye } from 'lucide-react';
import { formatDate, parseDate, artistColor, normalizeSongTitle } from '@/lib/utils';
import { attachSetBoundaryLabels } from '@/lib/setlistGrouping';
import SetlistEditor from '@/components/SetlistEditor';
import SetlistfmAttribution from '@/components/shows/SetlistfmAttribution';
import BandSourceAttribution from '@/components/shows/BandSourceAttribution';
import PlaylistCreatorModal from '@/components/PlaylistCreatorModal';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';
import SongHistoryModal from '@/components/SongHistoryModal';
import { useRouter } from 'next/navigation';
import { showHref } from '@/lib/showRouting';

function ShowsTogetherView({ friend, getShowsTogether, onBack, onSelectShow, onAddSong, onRateSong, onCommentSong, onDeleteSong, onRateShow, onCommentShow, onBatchRate, onTagFriends, onRateVenue, allShows }) {
  const router = useRouter();
  const [sharedShows, setSharedShows] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [playlistShow, setPlaylistShow] = useState(null);
  const [expandedShowId, setExpandedShowId] = useState(null);
  const [songHistory, setSongHistory] = useState(null); // { songName, artistName }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const shows = await getShowsTogether(friend.uid);
        if (!cancelled) setSharedShows(shows.sort((a, b) => parseDate(b.date) - parseDate(a.date)));
      } catch (e) {
        if (!cancelled) setError('Failed to load shows.');
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend.uid]);

  const mostSeenArtist = sharedShows ? (() => {
    const counts = {};
    sharedShows.forEach(s => { counts[s.artist] = (counts[s.artist] || 0) + 1; });
    const [artist, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
    return artist ? { artist, count } : null;
  })() : null;

  // Build a map of friend song ratings keyed by normalized song name
  const getFriendSongMap = (friendShow) => {
    if (!friendShow?.setlist) return {};
    const map = {};
    friendShow.setlist.forEach(s => {
      const key = normalizeSongTitle(s.name);
      if (key) map[key] = { rating: s.rating, name: s.name };
    });
    return map;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-secondary hover:text-primary text-sm mb-6 min-h-touch md:fine:min-h-0 -my-1 md:my-0 transition-colors pressable"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Friends
      </button>
      <h1 className="text-xl md:text-2xl font-bold text-primary mb-1">
        Shows with {friend.name}
      </h1>
      {sharedShows === null ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-muted animate-spin" />
        </div>
      ) : error ? (
        <p className="text-danger">{error}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 mb-6 text-sm">
            <span className="text-secondary">
              <span className="text-primary font-semibold">{sharedShows.length}</span> show{sharedShows.length !== 1 ? 's' : ''} together
            </span>
            {mostSeenArtist && (
              <span className="text-secondary">
                Most seen: <span className="text-brand font-semibold">{mostSeenArtist.artist}</span>
                {mostSeenArtist.count > 1 && <span className="text-muted"> ({mostSeenArtist.count}x)</span>}
              </span>
            )}
          </div>
          {sharedShows.length === 0 ? (
            <div className="text-center py-12">
              <Music className="w-12 h-12 text-muted mx-auto mb-4" />
              <p className="text-muted">No shared shows found yet.</p>
              <p className="text-muted text-sm mt-1">Shows are matched by artist, venue, and date.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sharedShows.map(show => {
                const friendShow = show.friendShow;
                const isExpanded = expandedShowId === show.id;
                const friendSongMap = isExpanded ? getFriendSongMap(friendShow) : {};
                const friendHasRatings = friendShow?.rating || friendShow?.setlist?.some(s => s.rating);

                return (
                  <div key={show.id} className="bg-hover border border-subtle rounded-2xl overflow-hidden transition-all">
                    {/* Clickable show header */}
                    <div
                      className="p-4 cursor-pointer hover:bg-hover transition-colors"
                      onClick={() => setExpandedShowId(isExpanded ? null : show.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium mb-1" style={{ color: artistColor(show.artist) }}>{show.artist}</div>
                          <div className="flex items-center gap-3 text-sm text-secondary flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(show.date)}</span>
                            {show.venue && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{show.venue}{show.city ? `, ${show.city}` : ''}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          {/* Your rating */}
                          {show.rating && (
                            <span className="text-xs bg-brand-subtle text-brand px-2 py-0.5 rounded-full font-semibold">
                              {show.rating}/10
                            </span>
                          )}
                          {/* Friend rating */}
                          {friendShow?.rating && (
                            <span className="text-xs bg-amber-subtle text-amber px-2 py-0.5 rounded-full font-semibold">
                              {friend.name.split(' ')[0]}: {friendShow.rating}/10
                            </span>
                          )}
                          {/* Indicators */}
                          {friendHasRatings && (
                            <span className="w-2 h-2 rounded-full bg-amber flex-shrink-0" title={`${friend.name} has rated this show`} />
                          )}
                          <ChevronDown className={`w-4 h-4 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    </div>

                    {/* Expanded show detail */}
                    {isExpanded && (
                      <div className="border-t border-subtle">
                        {/* Your show comment */}
                        {show.comment && (
                          <div className="px-4 py-3 bg-brand/5 border-b border-brand/10">
                            <div className="flex items-start gap-2">
                              <MessageSquare className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-semibold text-brand">You</span>
                                <p className="text-sm text-secondary italic mt-0.5">{show.comment}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Venue info with friend's venue context */}
                        {show.venue && (
                          <div className="px-4 py-2 border-b border-subtle bg-hover/30">
                            <div className="flex items-center gap-2 text-sm text-secondary">
                              <MapPin className="w-3.5 h-3.5" />
                              <span>{show.venue}{show.city ? `, ${show.city}` : ''}</span>
                            </div>
                          </div>
                        )}

                        {/* Setlist with friend annotations */}
                        {show.setlist && show.setlist.length > 0 && (
                          <div className="px-4 py-3">
                            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                              Setlist ({show.setlist.length} songs)
                            </div>
                            <div className="space-y-1.5">
                              {attachSetBoundaryLabels(show.setlist).map((song, i) => {
                                const songKey = normalizeSongTitle(song.name);
                                const friendSong = friendSongMap[songKey];
                                return (
                                  <React.Fragment key={song.id || i}>
                                    {song._setLabel && (
                                      <div className="text-brand font-semibold text-xs pt-2 pb-1 border-t border-subtle mt-2">
                                        {song._setLabel}
                                      </div>
                                    )}
                                    <div className="flex items-start gap-2 py-1 group">
                                      <span className="text-primary/25 font-mono text-xs mt-0.5 w-5 text-right flex-shrink-0">{i + 1}.</span>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <button
                                            onClick={() => setSongHistory({ songName: song.name, artistName: show.artist })}
                                            className="text-sm text-primary hover:text-brand hover:underline transition-colors text-left"
                                          >
                                            {song.name}
                                          </button>
                                          {song.cover && <span className="text-xs text-brand">({song.cover})</span>}
                                          {/* Your rating */}
                                          {song.rating && (
                                            <span className="text-[10px] bg-brand-subtle text-brand px-1.5 py-0.5 rounded-full font-semibold">
                                              {song.rating}/10
                                            </span>
                                          )}
                                          {/* Friend's rating */}
                                          {friendSong?.rating && (
                                            <span className="text-[10px] bg-amber-subtle text-amber px-1.5 py-0.5 rounded-full font-semibold">
                                              {friend.name.split(' ')[0]}: {friendSong.rating}/10
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                            <SetlistfmAttribution show={show} />
                            <BandSourceAttribution show={show} />
                          </div>
                        )}

                        {/* Action bar -- open full editor */}
                        <div className="px-4 py-3 border-t border-subtle bg-hover/30">
                          <button
                            onClick={() => setSelectedShow(show)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-brand/20 to-amber/20 hover:from-brand/30 hover:to-amber/30 text-brand border border-brand/20 rounded-xl text-sm font-medium transition-all"
                          >
                            <Eye className="w-4 h-4" />
                            Open Full Show Details
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* SetlistEditor modal for selected show */}
      {selectedShow && (() => {
        const friendShow = selectedShow.friendShow;
        return (
          <SetlistEditor
            show={selectedShow}
            allShows={allShows}
            onAddSong={(song) => onAddSong(selectedShow.id, song)}
            onRateSong={(songId, rating) => onRateSong(selectedShow.id, songId, rating)}
            onCommentSong={(songId, comment) => onCommentSong(selectedShow.id, songId, comment)}
            onDeleteSong={(songId) => onDeleteSong(selectedShow.id, songId)}
            onRateShow={(rating) => onRateShow(selectedShow.id, rating)}
            onCommentShow={(comment) => onCommentShow(selectedShow.id, comment)}
            onBatchRate={(rating) => onBatchRate(selectedShow.id, rating)}
            onClose={() => setSelectedShow(null)}
            onTagFriends={onTagFriends}
            onRateVenue={onRateVenue}
            friendAnnotations={friendShow ? { friendName: friend.name, friendShow } : null}
            onCreatePlaylist={PLAYLIST_CREATION_ENABLED ? (show) => setPlaylistShow(show) : undefined}
          />
        );
      })()}

      {playlistShow && (
        <PlaylistCreatorModal
          show={playlistShow}
          onClose={() => setPlaylistShow(null)}
        />
      )}

      {songHistory && (
        <SongHistoryModal
          songName={songHistory.songName}
          artistName={songHistory.artistName}
          allShows={allShows}
          onClose={() => setSongHistory(null)}
          onViewShow={(targetShow) => { setSongHistory(null); router.push(showHref(targetShow.id)); }}
        />
      )}
    </div>
  );
}

export default ShowsTogetherView;
