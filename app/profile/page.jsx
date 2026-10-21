'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy, Music, Star, Users, Calendar, MapPin, Send, Bell, Activity } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import ProfileView from '@/components/profile/ProfileView';
import ProfileHero from '@/components/profile/ProfileHero';
import AchievementCard from '@/components/profile/AchievementCard';
import { SectionHeader, Card, Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { showHref } from '@/lib/showRouting';

export default function ProfilePage() {
  const {
    user, guestMode, shows, userRank, friends,
    favoriteArtists, toggleFavoriteArtist,
    pendingNotificationCount, unreadNotifications,
  } = useApp();
  const unreadNotificationCount = unreadNotifications?.length || 0;
  const router = useRouter();

  if (guestMode || !user) return null;

  const stats = {
    shows: shows.length,
    artists: new Set(shows.map(s => s.artist)).size,
    venues: new Set(shows.map(s => s.venue)).size,
    friends: friends.length,
  };

  const achievements = [
    shows.length >= 1   && { icon: Music,    name: 'First show',     description: 'Tracked your first show',   tone: 'green'  },
    shows.length >= 10  && { icon: Star,      name: 'Getting into it', description: '10+ shows tracked',        tone: 'amber'  },
    shows.length >= 50  && { icon: Trophy,    name: 'Dedicated fan',  description: '50+ shows tracked',         tone: 'amber'  },
    shows.length >= 100 && { icon: Trophy,    name: 'Centurion',      description: '100+ shows tracked',        tone: 'amber'  },
    stats.artists >= 10 && { icon: Music,     name: 'Eclectic',       description: '10+ different artists',     tone: 'green'  },
    stats.venues >= 10  && { icon: MapPin,    name: 'Venue hopper',   description: '10+ different venues',      tone: 'purple' },
    friends.length >= 1 && { icon: Users,     name: 'Connected',      description: 'Made a friend on the app',  tone: 'blue'   },
    friends.length >= 5 && { icon: Users,     name: 'Social butterfly', description: '5+ friends',             tone: 'blue'   },
    favoriteArtists.length >= 1 && { icon: Star, name: 'Fan club',   description: 'Followed a band', tone: 'amber' },
  ].filter(Boolean).slice(0, 4);

  const recentShows = useMemo(() =>
    [...shows]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6),
  [shows]);

  return (
    <>
      <ProfileHero
        name={user.displayName || 'Music Fan'}
        stats={[
          { value: stats.shows,   label: 'Shows'   },
          { value: stats.artists, label: 'Artists' },
          { value: stats.venues,  label: 'Venues'  },
          { value: stats.friends, label: 'Friends' },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              icon={Users}
              onClick={() => router.push('/friends/')}
              className="relative"
            >
              Friends
              {pendingNotificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center">
                  {pendingNotificationCount}
                </span>
              )}
            </Button>
            <Button variant="secondary" icon={Send} onClick={() => router.push('/invite/')}>
              Invite Friends
            </Button>
            <Button
              variant="secondary"
              icon={Bell}
              onClick={() => router.push('/notifications/')}
              className="relative"
            >
              Notifications
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center">
                  {unreadNotificationCount}
                </span>
              )}
            </Button>
            <Button variant="secondary" icon={Activity} onClick={() => router.push('/activity/')}>
              Activity
            </Button>
          </>
        }
      />

      {achievements.length > 0 && (
        <>
          <SectionHeader title="Achievements" className="mt-2 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {achievements.map((a) => (
              <AchievementCard
                key={a.name}
                icon={a.icon}
                name={a.name}
                description={a.description}
                tone={a.tone}
              />
            ))}
          </div>
        </>
      )}

      {recentShows.length > 0 && (
        <>
          <SectionHeader title="Recent shows" className="mb-4" />
          <div className="space-y-2 mb-8">
            {recentShows.map((s) => (
              <Card
                key={s.id}
                as="button"
                padding="none"
                interactive
                onClick={() => router.push(showHref(s.id))}
                className="w-full flex items-center gap-4 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-primary truncate">{s.artist}</div>
                  <div className="text-sm text-secondary truncate">
                    {s.venue}{s.city ? ` · ${s.city}` : ''}
                  </div>
                </div>
                <div className="text-sm text-muted whitespace-nowrap">{formatDate(s.date)}</div>
                {s.rating && (
                  <div className="text-amber font-bold text-sm">★ {s.rating}</div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionHeader title="Profile settings" className="mb-4" />
      <ProfileView
        user={user}
        shows={shows}
        userRank={userRank}
        onProfileUpdate={() => {}}
        onViewShow={(show) => {
          router.push(showHref(show.id));
        }}
        friends={friends}
        favoriteArtists={favoriteArtists}
        onToggleFavoriteArtist={toggleFavoriteArtist}
      />
    </>
  );
}
