'use client';

import { Music, Calendar, MapPin, Star } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { SetlistfmCredit } from '@/components/shows/SetlistfmAttribution';

export default function SharedCollectionView({ data }) {
  if (!data) return null;

  const { ownerName, shows, stats } = data;

  // Group shows by artist
  const artistGroups = {};
  shows.forEach(show => {
    const artist = show.artist || 'Unknown';
    if (!artistGroups[artist]) artistGroups[artist] = [];
    artistGroups[artist].push(show);
  });

  const sortedArtists = Object.entries(artistGroups).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base text-primary">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-amber flex items-center justify-center mb-4">
            <Music className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-primary mb-1">
            {ownerName}&apos;s Concert Collection
          </h1>
          <p className="text-secondary">Shared from MySetlists</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-hover rounded-2xl p-5 border border-subtle">
            <div className="text-3xl font-bold text-brand">{stats.totalShows || shows.length}</div>
            <div className="text-sm text-secondary mt-1">Shows</div>
          </div>
          <div className="bg-hover rounded-2xl p-5 border border-subtle">
            <div className="text-3xl font-bold text-amber">{stats.totalSongs || 0}</div>
            <div className="text-sm text-secondary mt-1">Songs</div>
          </div>
          <div className="bg-hover rounded-2xl p-5 border border-subtle">
            <div className="text-3xl font-bold text-amber">{sortedArtists.length}</div>
            <div className="text-sm text-secondary mt-1">Artists</div>
          </div>
          {stats.avgRating && (
            <div className="bg-hover rounded-2xl p-5 border border-subtle">
              <div className="text-3xl font-bold text-brand">{stats.avgRating}</div>
              <div className="text-sm text-secondary mt-1">Avg Rating</div>
            </div>
          )}
        </div>

        {/* Shows by Artist */}
        <div className="space-y-4 mb-8">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2">
            <Music className="w-4 h-4 text-brand" />
            Shows by Artist
          </h2>
          {sortedArtists.map(([artist, artistShows]) => (
            <div key={artist} className="bg-hover rounded-2xl border border-subtle p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-primary font-semibold">{artist}</h3>
                <span className="text-brand text-xs font-semibold bg-brand-subtle px-2 py-0.5 rounded-full">
                  {artistShows.length} show{artistShows.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {artistShows.map((show, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-subtle last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm text-secondary">
                        <MapPin className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                        <span className="truncate">{show.venue}{show.city ? `, ${show.city}` : ''}</span>
                      </div>
                      {show.setlist && show.setlist.length > 0 && (
                        <div className="text-xs text-muted mt-0.5 ml-5.5">
                          {show.setlist.length} song{show.setlist.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      {show.rating && (
                        <span className="flex items-center gap-1 text-brand text-xs font-semibold">
                          <Star className="w-3 h-3" />
                          {show.rating}/10
                        </span>
                      )}
                      <span className="text-muted text-xs">
                        {show.date ? formatDate(show.date) : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Song counts come from setlists, most of them setlist.fm's. A
            snapshot keeps no setlist ids, so the credit is to setlist.fm
            itself. */}
        {shows.some(s => s.setlist?.length > 0) && (
          <SetlistfmCredit className="-mt-4 mb-8 text-[11px] text-muted" />
        )}

        {/* CTA */}
        <div className="text-center">
          <p className="text-secondary mb-4 text-sm">Track your own concert history for free</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-semibold shadow-lg shadow-brand/20 transition-all"
          >
            <Music className="w-4 h-4" />
            Start Tracking on MySetlists
          </a>
        </div>
      </div>
    </div>
  );
}
