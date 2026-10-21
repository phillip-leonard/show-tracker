'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trophy, Star, MapPin, Music, Flame, Lock, Globe } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { PageHeader, Button, Card, StatTile } from '@/components/ui';
import ShareYearInReview from '@/components/yearInReview/ShareYearInReview';
import {
  computeYearInReview, saveYearInReview, getYearInReview, setYearInReviewPrivacy,
} from '@/lib/yearInReview';
import { yearInReviewHref } from '@/lib/showRouting';

export default function YearInReviewClient({ userId, year }) {
  const router = useRouter();
  const { shows, user } = useApp();
  const isOwner = user?.uid === userId;

  const ownStats = useMemo(() => (isOwner ? computeYearInReview(shows, year) : null), [isOwner, shows, year]);
  const [remoteDoc, setRemoteDoc] = useState(undefined); // undefined = loading, null = not found
  const [privacy, setPrivacy] = useState('private');

  useEffect(() => {
    if (isOwner && ownStats) {
      saveYearInReview(userId, year, ownStats, privacy).catch((err) => console.error('Failed to cache year-in-review:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, ownStats]);

  useEffect(() => {
    if (isOwner) return;
    getYearInReview(userId, year).then(setRemoteDoc).catch(() => setRemoteDoc(null));
  }, [isOwner, userId, year]);

  useEffect(() => {
    if (isOwner) return;
    getYearInReview(userId, year).then((d) => { if (d?.privacy) setPrivacy(d.privacy); });
  }, [isOwner, userId, year]);

  const stats = isOwner ? ownStats : remoteDoc?.stats;

  const handlePrivacyToggle = async () => {
    const next = privacy === 'public' ? 'private' : 'public';
    setPrivacy(next);
    await setYearInReviewPrivacy(userId, year, next).catch((err) => console.error('Failed to update privacy:', err));
  };

  if (!isOwner && remoteDoc === undefined) {
    return <div className="py-24 text-center text-secondary">Loading...</div>;
  }

  if (!stats) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg text-primary mb-4">
          {isOwner ? `No shows logged for ${year} yet.` : 'This year in review is private or unavailable.'}
        </p>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push('/')}>Back home</Button>
      </div>
    );
  }

  const shareUrl = typeof window !== 'undefined' ? window.location.href : `https://mysetlists.net${yearInReviewHref(userId, year)}`;

  return (
    <div className="max-w-3xl mx-auto">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push('/')} className="hidden md:inline-flex mb-4">Back</Button>

      <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-brand to-[#059669] text-white p-8 md:p-12 text-center mb-8">
        <p className="text-sm font-bold uppercase tracking-wide opacity-90 mb-2">MySetlists</p>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-2">Your {year}</h1>
        <h2 className="text-3xl md:text-4xl font-extrabold mb-6">in Concerts</h2>
        <p className="text-lg opacity-95 max-w-xl mx-auto">{stats.shareableQuote}</p>
      </div>

      {/* The three headline counts. Each has one color, and the same one
          everywhere a Year in Review count appears (the share image, the
          My Shows banner, the landing page): Shows green, Bands amber,
          Venues white. The label under each number is its legend. */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-3">
        <StatTile value={stats.totalShows} label={stats.totalShows === 1 ? 'Show' : 'Shows'} tone="brand" />
        <StatTile value={stats.totalArtists} label={stats.totalArtists === 1 ? 'Band' : 'Bands'} tone="amber" />
        <StatTile value={stats.totalVenues} label={stats.totalVenues === 1 ? 'Venue' : 'Venues'} />
      </div>
      {stats.countriesVisited.length > 1 && (
        <p className="text-sm text-secondary text-center mb-8">Across {stats.countriesVisited.length} countries</p>
      )}
      {stats.countriesVisited.length <= 1 && <div className="mb-8" />}

      {stats.topArtist && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2 mb-3"><Trophy size={18} className="text-brand" /> Top Band</h3>
          <p className="text-2xl font-extrabold text-primary">{stats.topArtist.name}</p>
          <p className="text-secondary text-sm mt-1">
            {stats.topArtist.showCount} show{stats.topArtist.showCount !== 1 ? 's' : ''}
            {stats.topArtist.avgRating ? ` · avg rating ${stats.topArtist.avgRating}/10` : ''}
          </p>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        {stats.favoriteVenue && (
          <Card variant="elevated" padding="lg">
            <h3 className="text-lg font-semibold text-primary flex items-center gap-2 mb-3"><MapPin size={18} className="text-brand" /> Favorite Venue</h3>
            <p className="text-xl font-bold text-primary">{stats.favoriteVenue.name}</p>
            <p className="text-secondary text-sm mt-1">{stats.favoriteVenue.city} · {stats.favoriteVenue.frequency} visits</p>
          </Card>
        )}
        {stats.mostSeenSong && (
          <Card variant="elevated" padding="lg">
            <h3 className="text-lg font-semibold text-primary flex items-center gap-2 mb-3"><Music size={18} className="text-brand" /> Most Heard Song</h3>
            <p className="text-xl font-bold text-primary">{stats.mostSeenSong.name}</p>
            <p className="text-secondary text-sm mt-1">Heard {stats.mostSeenSong.count} times</p>
          </Card>
        )}
      </div>

      {stats.topRatedShows.length > 0 && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2 mb-4"><Star size={18} className="text-brand" /> Top Rated Shows</h3>
          <div className="space-y-2">
            {stats.topRatedShows.slice(0, 8).map((s) => (
              <div key={s.showId} className="flex items-center justify-between text-sm py-2 border-b border-subtle last:border-0">
                <div>
                  <p className="text-primary font-medium">{s.artist}</p>
                  <p className="text-muted text-xs">{s.venue}{s.city ? `, ${s.city}` : ''} · {s.date}</p>
                </div>
                <span className="flex items-center gap-1 text-amber font-semibold"><Star size={14} fill="currentColor" />{s.rating}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {stats.achievements.length > 0 && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2 mb-4"><Flame size={18} className="text-brand" /> Achievements</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {stats.achievements.map((a, i) => (
              <div key={i} className="bg-hover rounded-xl p-4">
                <p className="font-semibold text-primary text-sm">{a.title}</p>
                <p className="text-secondary text-xs mt-1">{a.description}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isOwner && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-primary flex items-center gap-2">
                {privacy === 'public' ? <Globe size={16} className="text-brand" /> : <Lock size={16} className="text-muted" />}
                {privacy === 'public' ? 'Public — anyone with the link can view' : 'Private — only you can view'}
              </h3>
            </div>
            <Button variant="secondary" size="sm" onClick={handlePrivacyToggle}>
              {privacy === 'public' ? 'Make Private' : 'Make Public'}
            </Button>
          </div>
        </Card>
      )}

      {(isOwner ? privacy === 'public' : true) && (
        <div>
          <h3 className="text-sm font-semibold text-muted uppercase mb-3">Share</h3>
          <ShareYearInReview stats={stats} shareUrl={shareUrl} userName={user?.displayName} />
        </div>
      )}
    </div>
  );
}
