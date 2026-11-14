'use client';

import React from 'react';
import { Star, Users, User, Building2, TrendingUp, Trophy, UserPlus } from 'lucide-react';
import Tip from '@/components/ui/Tip';
import { Card, SectionHeader, StatTile, SpinnerBlock } from '@/components/ui';

// A leaderboard entry's user id: `userId` since 5.59.10, falling back to
// the misspelled `odubleserId` that older communityStats docs carry (B-03).
const entryUid = (entry) => entry?.userId || entry?.odubleserId;

function CommunityStatsView({ communityStats, onAddFriend, currentUserUid, currentFriendUids }) {
  if (!communityStats) {
    return <SpinnerBlock label="Loading community stats..." />;
  }

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Show-Goers */}
        <Card padding="md">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <SectionHeader title="Top Show-Goers" className="mb-0" />
          </div>
          <div className="space-y-3">
            {(communityStats.topShowsAttended || []).slice(0, 5).map((user, i) => (
              <div key={entryUid(user)} className="flex items-center gap-3">
                <span className={`text-lg font-bold w-6 ${i === 0 ? 'text-brand' : i === 1 ? 'text-secondary' : i === 2 ? 'text-brand' : 'text-muted'}`}>
                  {i + 1}
                </span>
                <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <span className="text-secondary flex-1">{user.firstName}</span>
                {onAddFriend && entryUid(user) !== currentUserUid && !(currentFriendUids || []).includes(entryUid(user)) && (
                  <Tip text="Add friend">
                    <button
                      onClick={() => onAddFriend(entryUid(user), user.firstName, '')}
                      className="px-2 py-1 bg-brand-subtle text-brand rounded-lg text-xs font-medium hover:bg-brand/30 transition-colors"
                    >
                      <UserPlus className="w-3 h-3 inline mr-1" />
                      Add
                    </button>
                  </Tip>
                )}
                <span className="bg-brand-subtle text-brand px-3 py-1 rounded-full text-sm font-semibold">
                  {user.count} shows
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Raters */}
        <Card padding="md">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-danger rounded-xl flex items-center justify-center">
              <Star className="w-5 h-5 text-white" />
            </div>
            <SectionHeader title="Top Raters" className="mb-0" />
          </div>
          <div className="space-y-3">
            {(communityStats.topSongsRated || []).slice(0, 5).map((user, i) => (
              <div key={entryUid(user)} className="flex items-center gap-3">
                <span className={`text-lg font-bold w-6 ${i === 0 ? 'text-amber' : i === 1 ? 'text-secondary' : i === 2 ? 'text-amber' : 'text-muted'}`}>
                  {i + 1}
                </span>
                <div className="w-8 h-8 rounded-full bg-danger flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <span className="text-secondary flex-1">{user.firstName}</span>
                {onAddFriend && entryUid(user) !== currentUserUid && !(currentFriendUids || []).includes(entryUid(user)) && (
                  <Tip text="Add friend">
                    <button
                      onClick={() => onAddFriend(entryUid(user), user.firstName, '')}
                      className="px-2 py-1 bg-brand-subtle text-brand rounded-lg text-xs font-medium hover:bg-brand/30 transition-colors"
                    >
                      <UserPlus className="w-3 h-3 inline mr-1" />
                      Add
                    </button>
                  </Tip>
                )}
                <span className="bg-amber-subtle text-amber px-3 py-1 rounded-full text-sm font-semibold">
                  {user.count} ratings
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Rated Songs */}
        <Card padding="md">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-amber rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <SectionHeader title="Top Rated Songs" className="mb-0" />
          </div>
          <div className="space-y-3">
            {(communityStats.topSongsByRating || []).slice(0, 5).map((song, i) => (
              <div key={song.songName} className="flex items-center gap-3">
                <span className={`text-lg font-bold w-6 ${i === 0 ? 'text-amber' : i === 1 ? 'text-secondary' : i === 2 ? 'text-amber' : 'text-muted'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-secondary truncate">{song.songName}</div>
                  <div className="text-muted text-xs truncate">{song.artists?.join(', ')}</div>
                </div>
                <div className="text-right">
                  <span className="bg-amber-subtle text-amber px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap">
                    {song.avgRating}/10
                  </span>
                  <div className="text-muted text-xs mt-1">{song.ratingCount} ratings</div>
                </div>
              </div>
            ))}
            {(!communityStats.topSongsByRating || communityStats.topSongsByRating.length === 0) && (
              <p className="text-muted text-sm">Not enough ratings yet. Songs need at least 2 ratings to appear.</p>
            )}
          </div>
        </Card>

        {/* Top Venues */}
        <Card padding="md">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-amber rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <SectionHeader title="Top Venues" className="mb-0" />
          </div>
          <div className="space-y-3">
            {(communityStats.topVenues || []).slice(0, 5).map((venue, i) => (
              <div key={venue.venueName} className="flex items-center gap-3">
                <span className={`text-lg font-bold w-6 ${i === 0 ? 'text-amber' : i === 1 ? 'text-secondary' : i === 2 ? 'text-amber/60' : 'text-muted'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-secondary truncate">{venue.venueName}</div>
                  <div className="text-muted text-xs">{venue.artistCount} artists</div>
                </div>
                <span className="bg-amber-subtle text-amber px-3 py-1 rounded-full text-sm font-semibold">
                  {venue.showCount} shows
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Overall Stats */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatTile value={communityStats.totalUsers || 0} label="Total Users" tone="brand" />
        <StatTile value={communityStats.totalShows || 0} label="Total Shows" tone="amber" />
        <StatTile value={communityStats.totalSongs || 0} label="Total Songs" tone="brand" />
      </div>
    </div>
  );
}

export default CommunityStatsView;
