'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { X, Star, Tag, Share2, Check, Plus, MessageSquare, User, ListMusic, Hash } from 'lucide-react';
import { formatDate, artistColor } from '@/lib/utils';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { attachSetBoundaryLabels, getSetLabels, getSetOptions } from '@/lib/setlistGrouping';
import { Button, Card } from '@/components/ui';
import RatingSelect from '@/components/ui/RatingSelect';
import Tip from '@/components/ui/Tip';
import UpcomingShows from '@/components/UpcomingShows';
import EntityInfoPanel from '@/components/EntityInfoPanel';
import SongHistoryModal from '@/components/SongHistoryModal';
import StreamingLinks from '@/components/StreamingLinks';
import SetlistfmAttribution from '@/components/shows/SetlistfmAttribution';
import { useDismissable } from '@/context/DismissStackContext';
import useSheetDrag from '@/hooks/useSheetDrag';
import useIsMobile from '@/hooks/useIsMobile';
import { showHref } from '@/lib/showRouting';
import FollowBandButton from '@/components/artists/FollowBandButton';

function SetlistEditor({ show, allShows, onAddSong, onRateSong, onCommentSong, onDeleteSong, onRateShow, onCommentShow, onBatchRate, onClose, onCreatePlaylist, onTagFriends, onRateVenue, onToggleFavoriteArtist, isArtistFavorite, friendAnnotations, isReturningUser }) {
  useDismissable(true, onClose, { id: 'setlist-editor' });

  // Presents as a bottom sheet on mobile (items-end, rounded-t-2xl) and a
  // centred dialog from md: up, so the downward drag is mobile-only.
  const isMobileViewport = useIsMobile();
  const { sheetRef, backdropRef, scrollRef, dragHandleProps } = useSheetDrag({
    enabled: isMobileViewport,
    onDismiss: onClose,
  });
  const router = useRouter();
  const [songName, setSongName] = useState('');
  const [songSet, setSongSet] = useState('');
  const [batchRating, setBatchRating] = useState(5);
  const [editingComment, setEditingComment] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [editingShowComment, setEditingShowComment] = useState(false);
  const [showCommentText, setShowCommentText] = useState(show.comment || '');
  const [shareSuccess, setShareSuccess] = useState(false);
  const [showPlaylistTip, setShowPlaylistTip] = useState(false);
  const [showPlayCounts, setShowPlayCounts] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.SHOW_PLAY_COUNTS);
    return stored === null ? true : stored === 'true';
  });
  const [songHistoryTarget, setSongHistoryTarget] = useState(null);

  // Pre-compute play counts for all songs in setlist
  const songPlayCounts = useMemo(() => {
    if (!allShows || !show.setlist?.length) return {};
    const artistShows = allShows.filter(s => s.artist === show.artist && s.id !== show.id);
    const counts = {};
    show.setlist.forEach(song => {
      const key = song.name.trim().toLowerCase();
      let count = 1; // current show counts as 1
      artistShows.forEach(s => {
        if ((s.setlist || []).some(ss => ss.name.trim().toLowerCase() === key)) {
          count++;
        }
      });
      counts[song.id] = count;
    });
    return counts;
  }, [allShows, show.artist, show.setlist, show.id]);

  const togglePlayCounts = () => {
    const newValue = !showPlayCounts;
    setShowPlayCounts(newValue);
    storage.set(STORAGE_KEYS.SHOW_PLAY_COUNTS, String(newValue));
  };

  // Show playlist tooltip for new users who haven't seen it yet
  useEffect(() => {
    // Suppress for returning users (account ≥ 7 days) — fixes mobile tooltip bug
    if (isReturningUser) return;
    if (show.setlist?.length > 0 && onCreatePlaylist) {
      const seen = storage.get(STORAGE_KEYS.PLAYLIST_TOOLTIP_SEEN);
      if (!seen) {
        const timer = setTimeout(() => setShowPlaylistTip(true), 600);
        return () => clearTimeout(timer);
      }
    }
  }, [show.setlist, onCreatePlaylist, isReturningUser]);

  const dismissPlaylistTip = () => {
    setShowPlaylistTip(false);
    storage.set(STORAGE_KEYS.PLAYLIST_TOOLTIP_SEEN, '1');
  };

  const handleShare = async () => {
    const setlistText = show.setlist.map((song, i) => `${i + 1}. ${song.name}${song.rating ? ` (${song.rating}/10)` : ''}`).join('\n');
    const shareText = `${show.artist} @ ${show.venue}${show.city ? `, ${show.city}` : ''}\n${formatDate(show.date)}${show.tour ? `\n${show.tour}` : ''}\n\nSetlist:\n${setlistText}\n\nTracked with MySetlists.net`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${show.artist} - ${formatDate(show.date)}`,
          text: shareText,
        });
      } catch (err) {
        // User cancelled or share failed, try clipboard
        copyToClipboard(shareText);
      }
    } else {
      copyToClipboard(shareText);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const existingSetLabels = getSetLabels(show.setlist);

  const handleAddSong = (e) => {
    e.preventDefault();
    if (songName.trim()) {
      const set = songSet || existingSetLabels[existingSetLabels.length - 1] || 'Set I';
      onAddSong({ name: songName.trim(), set });
      setSongName('');
    }
  };

  const startEditComment = (song) => {
    setEditingComment(song.id);
    setCommentText(song.comment || '');
  };

  const saveComment = (songId) => {
    onCommentSong(songId, commentText.trim());
    setEditingComment(null);
    setCommentText('');
  };

  const unratedCount = show.setlist.filter(s => !s.rating).length;

  // Build friend song rating map if available
  const friendSongMap = useMemo(() => {
    if (!friendAnnotations?.friendShow?.setlist) return {};
    const map = {};
    friendAnnotations.friendShow.setlist.forEach(s => {
      const key = (s.name || '').trim().toLowerCase();
      if (key) map[key] = { rating: s.rating, name: s.name };
    });
    return map;
  }, [friendAnnotations]);

  return (
    <div className="fixed inset-0 md:left-sidebar flex items-end md:items-center justify-center pl-safe-left pr-safe-right md:p-safe-gutter md:[--safe-left:0px] z-[60]">
      {/* Backdrop split out of the wrapper so the swipe-down drag can fade
          it in step with the sheet. */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 bg-sidebar/50 backdrop-blur-xl"
      />
      <div
        ref={sheetRef}
        className="relative bg-surface border border-subtle rounded-t-2xl md:rounded-3xl max-w-[100vw] sm:max-w-lg md:max-w-2xl w-full max-h-[min(92dvh,calc(100dvh_-_var(--safe-top)_-_0.5rem))] md:max-h-[min(90dvh,100%)] overflow-hidden flex flex-col shadow-2xl pb-safe-bottom md:pb-0"
      >
        {/* Grabber — mobile only; the drag region is this plus the top bar. */}
        <div
          {...dragHandleProps}
          className="md:hidden flex-shrink-0 flex items-center justify-center pt-2.5 pb-1"
        >
          <div className="sheet-grabber" />
        </div>
        {/* Compact top bar with close, share, and tag */}
        <div
          {...dragHandleProps}
          className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-subtle bg-surface flex-shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-lg md:text-2xl font-bold truncate" style={{ color: artistColor(show.artist) }}>{show.artist}</h2>
            {!show.isManual && (
              <span className="text-[10px] md:text-xs font-semibold bg-brand-subtle text-brand px-1.5 py-0.5 md:px-2 md:py-1 rounded-full flex-shrink-0">
                setlist.fm
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onToggleFavoriteArtist && <FollowBandButton artist={show.artist} compact />}
            {onRateVenue && show.venue && (
              <Tip text="Rate this venue" position="bottom">
                <button
                  onClick={() => onRateVenue(show)}
                  className="p-3 rounded-xl text-secondary hover:text-brand hover:bg-brand-subtle active:bg-brand-subtle transition-colors"
                >
                  <Star className="w-6 h-6" />
                </button>
              </Tip>
            )}
            {onTagFriends && (
              <Tip text="Tag friends at this show" position="bottom">
                <button
                  onClick={() => onTagFriends(show)}
                  className="p-3 rounded-xl text-secondary hover:text-primary hover:bg-hover active:bg-hover transition-colors"
                >
                  <Tag className="w-6 h-6" />
                </button>
              </Tip>
            )}
            <Tip text="Share setlist" position="bottom">
              <button
                onClick={handleShare}
                className={`p-3 rounded-xl transition-colors ${shareSuccess ? 'bg-brand-subtle text-brand' : 'text-secondary hover:text-primary hover:bg-hover active:bg-hover'}`}
              >
                {shareSuccess ? <Check className="w-6 h-6" /> : <Share2 className="w-6 h-6" />}
              </button>
            </Tip>
            {show.setlist?.length > 0 && onCreatePlaylist && (
              <div className="relative">
                <Tip text={showPlaylistTip ? '' : 'Create playlist'} position="bottom">
                  <button
                    onClick={() => {
                      dismissPlaylistTip();
                      onCreatePlaylist(show);
                    }}
                    className={`p-3 rounded-xl text-secondary hover:text-brand hover:bg-brand-subtle active:bg-brand-subtle transition-colors ${showPlaylistTip ? 'ring-2 ring-brand/60 ring-offset-2 ring-offset-base' : ''}`}
                  >
                    <ListMusic className="w-6 h-6" />
                  </button>
                </Tip>
                {showPlaylistTip && (
                  <>
                    {/* Desktop: tooltip below the button */}
                    <div className="hidden md:block absolute top-full mt-2 right-0 w-60 z-20 animate-in">
                      <div className="bg-brand border border-brand/30 rounded-xl p-3 shadow-xl shadow-brand/20 relative">
                        <div className="absolute -top-2 right-4 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-brand" />
                        <p className="text-primary text-xs leading-relaxed mb-2">
                          Create a Spotify or Apple Music playlist from this setlist with one tap!
                        </p>
                        <button onClick={dismissPlaylistTip} className="text-brand hover:text-primary text-xs font-medium min-h-touch md:min-h-0 inline-flex items-center transition-colors">Got it ✓</button>
                      </div>
                    </div>
                    {/* Mobile: tooltip below the button */}
                    <div className="md:hidden absolute top-full mt-2 right-0 w-56 z-20 animate-in-mobile">
                      <div className="bg-brand border border-brand/30 rounded-xl p-3 shadow-xl shadow-brand/20 relative">
                        <div className="absolute -top-2 right-4 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-brand" />
                        <p className="text-primary text-xs leading-relaxed mb-2">
                          Create a Spotify or Apple Music playlist from this setlist!
                        </p>
                        <button onClick={dismissPlaylistTip} className="text-brand hover:text-primary text-xs font-medium min-h-touch md:min-h-0 inline-flex items-center transition-colors">Got it ✓</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {allShows && show.setlist?.length > 0 && (
              <Tip text={showPlayCounts ? 'Hide play counts' : 'Show play counts'} position="bottom">
                <button
                  onClick={togglePlayCounts}
                  className={`p-3 rounded-xl transition-colors ${showPlayCounts ? 'bg-brand-subtle text-brand' : 'text-secondary hover:text-primary hover:bg-hover active:bg-hover'}`}
                >
                  <Hash className="w-6 h-6" />
                </button>
              </Tip>
            )}
            <button onClick={onClose} className="p-3 rounded-xl text-secondary hover:text-primary hover:bg-hover active:bg-hover transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Scrollable content area with show info + setlist */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {/* Show details */}
          <div className="px-4 py-3 md:px-6 md:py-4 border-b border-subtle bg-surface">
            <p className="text-secondary text-sm">
              {formatDate(show.date)} &middot; {show.venue}
              {show.city && `, ${show.city}`}
            </p>
            {show.tour && (
              <p className="text-brand text-sm font-medium mt-1">Tour: {show.tour}</p>
            )}
            <div className="mt-2">
              <RatingSelect value={show.rating} onChange={onRateShow} label="Show rating:" />
            </div>
            {!editingShowComment && (
              <div className="mt-2">
                {show.comment ? (
                  <div
                    className="text-sm text-secondary italic bg-hover p-2.5 rounded-lg border border-subtle cursor-pointer hover:bg-hover transition-colors"
                    onClick={() => { setEditingShowComment(true); setShowCommentText(show.comment || ''); }}
                  >
                    <div className="flex items-start gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted" />
                      <span>{show.comment}</span>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={MessageSquare}
                    onClick={() => { setEditingShowComment(true); setShowCommentText(''); }}
                    className="text-muted"
                  >
                    Add show note
                  </Button>
                )}
              </div>
            )}
            {editingShowComment && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={showCommentText}
                  onChange={(e) => setShowCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { onCommentShow(showCommentText.trim()); setEditingShowComment(false); }
                  }}
                  placeholder="Add a note about this show..."
                  className="flex-1 px-3 py-2 bg-hover border border-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary placeholder-muted"
                  autoFocus
                />
                <Button variant="primary" size="sm" onClick={() => { onCommentShow(showCommentText.trim()); setEditingShowComment(false); }}>Save</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingShowComment(false)}>Cancel</Button>
              </div>
            )}

            {/* Friend's show-level rating */}
            {friendAnnotations?.friendShow?.rating && (
              <div className="mt-3 bg-amber-subtle border border-amber/20 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber to-amber flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-3 h-3 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-amber">{friendAnnotations.friendName}</span>
                      <span className="text-[10px] bg-amber-subtle text-amber px-1.5 py-0.5 rounded-full font-semibold">
                        Rated {friendAnnotations.friendShow.rating}/10
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Wikipedia info panels */}
            <EntityInfoPanel name={show.artist} type="artist" />
            {show.venue && (
              <EntityInfoPanel name={show.venue} type="venue" city={show.city} />
            )}

            {/* Add song form */}
            <form onSubmit={handleAddSong} className="flex gap-3 mt-3">
              <input
                type="text"
                placeholder="Add song to setlist..."
                value={songName}
                onChange={(e) => setSongName(e.target.value)}
                className="flex-1 px-4 py-2.5 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary placeholder-muted text-sm"
              />
              <select
                value={songSet || existingSetLabels[existingSetLabels.length - 1] || 'Set I'}
                onChange={(e) => setSongSet(e.target.value)}
                className="px-3 py-2.5 bg-hover border border-subtle rounded-xl text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/50 cursor-pointer"
              >
                {getSetOptions(show.setlist).map(label => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
              <Button variant="primary" type="submit" icon={Plus} />
            </form>

            {unratedCount > 0 && (
              <Card variant="inset" padding="none" className="flex items-center gap-3 mt-3 p-3">
                <span className="text-xs font-medium text-secondary">Rate {unratedCount} unrated:</span>
                <RatingSelect value={batchRating} onChange={(v) => setBatchRating(v || 5)} />
                <Button variant="primary" size="sm" onClick={() => onBatchRate(batchRating)}>Apply</Button>
              </Card>
            )}
          </div>

          <div className="p-4 md:p-6 bg-surface/50">
          {show.setlist.length === 0 ? (
            <p className="text-center text-muted py-8 font-medium">No songs in setlist</p>
          ) : (
            <div className="space-y-3">
              {attachSetBoundaryLabels(show.setlist).map((song, index) => (
                <React.Fragment key={song.id}>
                  {song._setLabel && (
                    <div className="text-brand font-semibold text-sm pt-3 pb-1 border-t border-subtle mt-3">
                      {song._setLabel}
                    </div>
                  )}
                  <Card variant="inset" padding="none" className="group p-4 hover:border-active transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-start gap-3 flex-1">
                        <span className="text-muted font-mono text-sm mt-1">{index + 1}.</span>
                        <div className="flex-1 flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-medium text-primary ${allShows ? 'cursor-pointer hover:text-brand transition-colors' : ''}`}
                            onClick={() => allShows && setSongHistoryTarget(song.name)}
                          >
                            {song.name}
                          </span>
                          {song.cover && (
                            <span className="text-sm text-brand">({song.cover})</span>
                          )}
                          {showPlayCounts && allShows && (() => {
                            const count = songPlayCounts[song.id] || 1;
                            const isFirstTime = count === 1;
                            return (
                              <span
                                className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                                  isFirstTime
                                    ? 'bg-amber-subtle text-amber border border-amber/30'
                                    : 'bg-hover text-muted border border-subtle'
                                }`}
                                onClick={() => setSongHistoryTarget(song.name)}
                                title={isFirstTime ? 'First time seeing this!' : `Click to see song history`}
                              >
                                {count}x
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        onClick={() => onDeleteSong(song.id)}
                        className="text-muted hover:text-danger transition-all opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 ml-8">
                      <RatingSelect value={song.rating} onChange={(v) => onRateSong(song.id, v)} label="Rating:" />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={MessageSquare}
                        onClick={() => startEditComment(song)}
                        className={song.comment ? 'bg-brand-subtle text-brand hover:bg-brand/30' : 'text-muted'}
                      >
                        {song.comment ? 'Edit note' : 'Add note'}
                      </Button>
                    </div>
                    {song.comment && editingComment !== song.id && (
                      <div className="ml-8 mt-2 text-sm text-secondary italic bg-hover p-2.5 rounded-lg border border-subtle">
                        {song.comment}
                      </div>
                    )}
                    {editingComment === song.id && (
                      <div className="ml-8 mt-2 flex gap-2">
                        <input
                          type="text"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveComment(song.id)}
                          placeholder="Add a note about this song..."
                          className="flex-1 px-3 py-2 bg-hover border border-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary placeholder-muted"
                          autoFocus
                        />
                        <Button variant="primary" size="sm" onClick={() => saveComment(song.id)}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingComment(null)}>Cancel</Button>
                      </div>
                    )}
                    {/* Friend's song rating */}
                    {(() => {
                      const fSong = friendSongMap[(song.name || '').trim().toLowerCase()];
                      if (!fSong?.rating) return null;
                      return (
                        <div className="ml-8 mt-2 bg-amber-subtle border border-amber/15 rounded-lg p-2.5">
                          <div className="flex items-start gap-2">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber to-amber flex items-center justify-center flex-shrink-0 mt-0.5">
                              <User className="w-2.5 h-2.5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-semibold text-amber">{friendAnnotations.friendName}</span>
                                <span className="text-[10px] bg-amber-subtle text-amber px-1.5 py-0.5 rounded-full font-semibold">
                                  {fSong.rating}/10
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                </React.Fragment>
              ))}
            </div>
          )}
          <SetlistfmAttribution show={show} />
          <UpcomingShows artistName={show.artist} />

          <StreamingLinks show={show} />
          </div>
        </div>
      </div>

      {/* Song History Modal */}
      {songHistoryTarget && allShows && (
        <SongHistoryModal
          songName={songHistoryTarget}
          artistName={show.artist}
          allShows={allShows}
          onClose={() => setSongHistoryTarget(null)}
          onViewShow={(targetShow) => {
            setSongHistoryTarget(null);
            if (targetShow.id !== show.id) { router.push(showHref(targetShow.id)); }
          }}
        />
      )}
    </div>
  );
}

export default SetlistEditor;
