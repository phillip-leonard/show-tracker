'use client';

import React, { useMemo } from 'react';
import { X, Star, MapPin, MessageSquare, Calendar, Music, ExternalLink } from 'lucide-react';
import { Button, Card, Badge } from '@/components/ui';
import { formatDate, normalizeSongTitle } from '@/lib/utils';
import { useDismissable } from '@/context/DismissStackContext';
import useSheetDrag from '@/hooks/useSheetDrag';
import useIsMobile from '@/hooks/useIsMobile';
import { SetlistfmCreditFor } from '@/components/shows/SetlistfmAttribution';

function SongHistoryModal({ songName, artistName, allShows, onClose, onViewShow }) {
  useDismissable(true, onClose, { id: 'song-history' });

  const isMobileViewport = useIsMobile();
  const { sheetRef, backdropRef, scrollRef, dragHandleProps } = useSheetDrag({
    enabled: isMobileViewport,
    onDismiss: onClose,
  });
  const performances = useMemo(() => {
    const targetTitle = normalizeSongTitle(songName);
    const results = [];
    allShows
      .filter(show => show.artist === artistName)
      .forEach(show => {
        const matchingSong = (show.setlist || []).find(s =>
          normalizeSongTitle(s.name) === targetTitle
        );
        if (matchingSong) {
          results.push({
            date: show.date,
            venue: show.venue,
            city: show.city,
            rating: matchingSong.rating,
            comment: matchingSong.comment,
            showRating: show.rating,
            showId: show.id,
            show,
          });
        }
      });
    // Sort chronologically (oldest first)
    results.sort((a, b) => new Date(a.date) - new Date(b.date));
    return results;
  }, [songName, artistName, allShows]);

  const stats = useMemo(() => {
    if (performances.length === 0) return null;
    const rated = performances.filter(p => p.rating);
    const avgRating = rated.length > 0
      ? (rated.reduce((sum, p) => sum + p.rating, 0) / rated.length).toFixed(1)
      : null;
    const uniqueVenues = new Set(performances.map(p => `${p.venue}${p.city ? `, ${p.city}` : ''}`)).size;
    const best = rated.length > 0
      ? rated.reduce((best, p) => p.rating > best.rating ? p : best, rated[0])
      : null;

    return {
      avgRating,
      firstHeard: performances[0],
      lastHeard: performances[performances.length - 1],
      uniqueVenues,
      bestPerformance: best,
    };
  }, [performances]);

  return (
    <div className="fixed inset-0 md:left-sidebar flex items-end md:items-center justify-center pl-safe-left pr-safe-right md:p-safe-gutter md:[--safe-left:0px] z-[70]" onClick={onClose}>
      <div ref={backdropRef} aria-hidden="true" className="absolute inset-0 bg-sidebar/50 backdrop-blur-xl" />
      <Card ref={sheetRef} variant="elevated" padding="none" className="relative rounded-t-2xl md:rounded-3xl max-w-[100vw] sm:max-w-lg md:max-w-xl w-full max-h-[85dvh] md:max-h-[min(80dvh,100%)] overflow-hidden flex flex-col shadow-2xl pb-safe-bottom md:pb-0" onClick={e => e.stopPropagation()}>
        {/* Grabber — mobile only */}
        <div {...dragHandleProps} className="md:hidden flex-shrink-0 flex items-center justify-center pt-2.5 pb-1">
          <div className="sheet-grabber" />
        </div>
        {/* Header */}
        <div {...dragHandleProps} className="flex items-start justify-between px-4 py-3 md:px-6 md:py-4 border-b border-subtle flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Music className="w-5 h-5 text-brand flex-shrink-0" />
              <h2 className="text-lg md:text-xl font-bold text-primary truncate">{songName}</h2>
            </div>
            <p className="text-sm text-secondary mt-0.5">by {artistName}</p>
          </div>
          <Button variant="ghost" icon={X} onClick={onClose} />
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Count header */}
          <div className="text-center mb-4">
            <Badge tone="navy" size="sm">
              {performances.length === 1
                ? "You've seen this song 1 time"
                : `You've seen this song ${performances.length} times`}
            </Badge>
          </div>

          {/* Performance list */}
          <div className="space-y-3 mb-6">
            {performances.map((perf, idx) => (
              <Card key={idx} padding="none" interactive className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-muted">Show {idx + 1}</span>
                      <div className="flex items-center gap-1 text-sm font-medium text-primary">
                        <Calendar className="w-3.5 h-3.5 text-secondary" />
                        {formatDate(perf.date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-sm text-secondary">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{perf.venue}{perf.city ? `, ${perf.city}` : ''}</span>
                    </div>
                    {perf.rating && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <Star className="w-3.5 h-3.5 text-amber" />
                        <span className="text-sm font-medium text-primary">Song Rating: {perf.rating}/10</span>
                      </div>
                    )}
                    {perf.comment && (
                      <div className="flex items-start gap-1.5 mt-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-muted mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-secondary italic">{perf.comment}</span>
                      </div>
                    )}
                  </div>
                  {onViewShow && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ExternalLink}
                      onClick={() => onViewShow(perf.show)}
                      className="bg-brand-subtle text-brand hover:bg-brand/20 flex-shrink-0"
                    >
                      View Show
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <SetlistfmCreditFor shows={performances.map(p => p.show)} className="mb-4 text-[11px] text-muted" />

          {/* Stats section */}
          {stats && (
            <div className="border-t border-subtle pt-4">
              <h4 className="text-sm font-bold text-primary mb-3 uppercase tracking-wide">Stats</h4>
              <div className="space-y-2">
                {stats.avgRating && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-secondary">Average Rating:</span>
                    <span className="font-semibold text-primary">{stats.avgRating}/10</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary">First Heard:</span>
                  <span className="font-medium text-primary">
                    {formatDate(stats.firstHeard.date)} at {stats.firstHeard.venue}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary">Last Heard:</span>
                  <span className="font-medium text-primary">
                    {formatDate(stats.lastHeard.date)} at {stats.lastHeard.venue}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary">Venues Seen At:</span>
                  <span className="font-medium text-primary">{stats.uniqueVenues} different venue{stats.uniqueVenues !== 1 ? 's' : ''}</span>
                </div>
                {stats.bestPerformance && stats.bestPerformance.rating > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-secondary">Best Performance:</span>
                    <span className="font-medium text-primary">
                      {formatDate(stats.bestPerformance.date)} at {stats.bestPerformance.venue} ({stats.bestPerformance.rating}/10)
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default SongHistoryModal;
