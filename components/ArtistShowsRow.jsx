'use client';

import React from 'react';
import { ChevronDown, Calendar, MapPin, Music, MessageSquare, X } from 'lucide-react';
import { formatDate, artistColor, avgSongRating } from '@/lib/utils';
import RatingSelect from '@/components/ui/RatingSelect';
import UpcomingShows from '@/components/UpcomingShows';

function ArtistShowsRow({ artist, shows, expanded, onToggle, onSelectShow, onDeleteShow, onRateShow }) {
  const avgRating = (() => {
    const rated = shows.filter(s => s.rating);
    if (rated.length === 0) return null;
    return (rated.reduce((a, s) => a + s.rating, 0) / rated.length).toFixed(1);
  })();

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-hover transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-4">
          <div className="flex items-center gap-3">
            <ChevronDown className={`w-4 h-4 text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: artistColor(artist) }} />
            <span className="font-medium" style={{ color: artistColor(artist) }}>{artist}</span>
          </div>
        </td>
        <td className="px-4 py-4 text-center">
          <span className="bg-brand-subtle text-brand px-2.5 py-1 rounded-full text-sm font-semibold">
            {shows.length}
          </span>
        </td>
        <td className="px-4 py-4 text-center">
          {avgRating ? (
            <span className="text-sm font-semibold text-brand">{avgRating}/10</span>
          ) : (
            <span className="text-muted">--</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={3} className="px-4 py-0 bg-hover/30">
            <div className="py-4 pl-6 border-l-2 border-brand/50 ml-2 mb-2">
              <div className="text-xs font-semibold text-muted mb-3 uppercase tracking-wide">Shows</div>
              <div className="space-y-3">
                {shows.map(show => {
                  const songAvg = avgSongRating(show.setlist);
                  return (
                    <div
                      key={show.id}
                      className="group flex items-start justify-between bg-hover rounded-2xl p-4 border cursor-pointer transition-all border-subtle hover:bg-hover hover:border-active"
                      onClick={() => onSelectShow(show)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <Calendar className="w-3.5 h-3.5 text-muted" />
                          <span className="text-secondary">{formatDate(show.date)}</span>
                          <span className="text-muted">&middot;</span>
                          <MapPin className="w-3.5 h-3.5 text-muted" />
                          <span className="text-secondary">{show.venue}{show.city ? `, ${show.city}` : ''}</span>
                          <span className="text-muted">&middot;</span>
                          <Music className="w-3.5 h-3.5 text-muted" />
                          <span className="text-secondary">{show.setlist.length} songs</span>
                        </div>
                        {show.tour && (
                          <div className="text-xs text-brand font-medium mt-1.5">Tour: {show.tour}</div>
                        )}
                        {show.comment && (
                          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-secondary italic">
                            <MessageSquare className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            {show.comment}
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-3" onClick={(e) => e.stopPropagation()}>
                          <RatingSelect value={show.rating} onChange={(r) => onRateShow(show.id, r)} label="Show:" />
                          {songAvg && (
                            <span className="text-xs font-medium text-muted">Songs avg: {songAvg}/10</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteShow(show);
                        }}
                        className="text-muted hover:text-danger transition-all opacity-0 group-hover:opacity-100 ml-2"
                        title="Delete show"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <UpcomingShows artistName={artist} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default ArtistShowsRow;
