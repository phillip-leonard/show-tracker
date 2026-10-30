'use client';

// components/artists/FollowBandButton.jsx
//
// Follow / Following for one band, wherever a band appears. A follow is an
// entry in userProfiles/{uid}.favoriteArtists (toggleFavoriteArtist in
// context/AppContext.jsx). Following a band means the daily job
// (netlify/functions/lib/followedBandAlerts.js) tells you when it announces
// a tour, or a date at a venue on your bucket list.
//
// Renders nothing for guests and signed-out visitors: there is no profile
// to store the follow on.
//
//   <FollowBandButton artist="Goose" />                 labeled pill
//   <FollowBandButton artist="Goose" compact />         icon only, for toolbars

import React from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export default function FollowBandButton({ artist, compact = false, className = '' }) {
  const { user, guestMode, isArtistFavorite, toggleFavoriteArtist } = useApp();
  if (!user || guestMode || !artist) return null;

  const following = isArtistFavorite(artist);
  const Icon = following ? BellRing : Bell;
  const label = following ? `Following ${artist}` : `Follow ${artist}`;
  const onClick = (e) => {
    e.stopPropagation();
    toggleFavoriteArtist(artist);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={following}
        aria-label={label}
        title={following ? `Unfollow ${artist}` : `Follow ${artist} for tour announcements`}
        className={`inline-flex items-center justify-center min-w-touch min-h-touch md:min-w-0 md:min-h-0 p-2 rounded-lg transition-colors ${
          following ? 'text-brand bg-brand/10' : 'text-muted hover:text-primary hover:bg-hover'
        } ${className}`}
      >
        <Icon className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 min-h-touch md:fine:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
        following
          ? 'bg-brand/10 text-brand border-brand/40'
          : 'bg-transparent text-secondary border-subtle hover:text-primary hover:border-active'
      } ${className}`}
    >
      <Icon className="w-4 h-4" />
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
