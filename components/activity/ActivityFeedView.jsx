// components/activity/ActivityFeedView.jsx
//
// /activity page body. Real-time, chronological log of what friends have
// been doing: adding a show, rating one, commenting, or sharing a
// photo/poster/setlist photo. Designed to grow further the same way —
// a new `action` value here plus a matching logActivity() call at the
// write site, no schema change needed.
//
// Moderation (Guideline 1.2): blocking someone removes the friendship, so
// their activity stops arriving at the source — the filter below covers
// the gap between taking the block and the listener re-subscribing.

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Activity, PlusCircle, Star, Users, MessageSquare, Camera } from 'lucide-react';
import { Card, EmptyState, Spinner, Tabs, Avatar } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { subscribeFriendActivity } from '@/lib/activityFeed';
import { timeAgo } from '@/lib/utils';
import { withoutBlocked } from '@/lib/moderation';
import UserLink from '@/components/moderation/UserLink';
import { publicShowUrl, externalLinkClick } from '@/lib/publicProfile';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'added_show', label: 'Shows' },
  { id: 'rated_show', label: 'Ratings' },
  { id: 'commented', label: 'Comments' },
  { id: 'shared_media', label: 'Photos' },
];

const MEDIA_NOUN = { photo: 'a photo', video: 'a video', poster: 'a poster', setlist: 'a setlist photo' };

function ActivityRow({ item }) {
  // Only linkable when the actor's public profile was on at the time this
  // was logged — there's no route for viewing another user's private show
  // (see lib/activityFeed.js's `handle` field for why). Absolute, and opened
  // in the system browser on iOS: the public page is served by a Netlify
  // function, not by the app (lib/publicProfile.js).
  const showHref = item.handle && item.showId ? publicShowUrl(item.handle, item.showId) : null;
  const RowTag = showHref ? 'a' : 'div';

  const Icon = {
    rated_show: Star,
    commented: MessageSquare,
    shared_media: Camera,
  }[item.action] || PlusCircle;

  const iconClass = item.action === 'rated_show' ? 'text-amber' : 'text-brand';

  return (
    <RowTag
      {...(showHref ? {
        href: showHref,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: (e) => externalLinkClick(e, showHref),
      } : {})}
      className="flex items-start gap-3 px-4 py-3.5 hover:bg-hover transition-colors border-b border-subtle last:border-0"
    >
      <Avatar name={item.userName} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-primary">
          <UserLink uid={item.userId} name={item.userName} className="font-semibold">
            {item.userName}
          </UserLink>{' '}
          {item.action === 'rated_show' && <>rated <span className="font-semibold">{item.artist}</span> {item.rating}/10</>}
          {item.action === 'commented' && <>commented on <span className="font-semibold">{item.artist}</span></>}
          {item.action === 'shared_media' && <>shared {MEDIA_NOUN[item.mediaCategory] || 'media'} from <span className="font-semibold">{item.artist}</span></>}
          {item.action === 'added_show' && <>added <span className="font-semibold">{item.artist}</span>{item.venue ? ` at ${item.venue}` : ''}</>}
        </p>
        <p className="text-xs text-muted mt-0.5">{timeAgo(item.timestamp)}</p>
      </div>
      <Icon size={16} className={`${iconClass} flex-shrink-0 mt-1`} fill={item.action === 'rated_show' ? 'currentColor' : 'none'} />
    </RowTag>
  );
}

export default function ActivityFeedView() {
  const { user, visibleFriends: friends, blockedUserIds } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const friendUids = useMemo(() => (friends || []).map((f) => f.friendUid).filter(Boolean), [friends]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsubscribe = subscribeFriendActivity(friendUids, (list) => {
      setItems(list);
      setLoading(false);
    });
    return unsubscribe;
  }, [user, friendUids]);

  const filtered = useMemo(() => {
    // friendUids already excludes blocked accounts, so nothing from one
    // should arrive here in the first place — this is the belt to that
    // brace, and it also covers the window between taking a block and the
    // listener re-subscribing on the new uid list.
    const visible = withoutBlocked(items, blockedUserIds, 'userId');
    if (filter === 'all') return visible;
    return visible.filter((i) => i.action === filter);
  }, [items, filter, blockedUserIds]);

  if (friendUids.length === 0) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={Users}
          tone="brand"
          title="Add some friends first"
          body="Your activity feed shows what friends are up to — add friends to start seeing their shows and ratings here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs value={filter} onChange={setFilter} tabs={FILTERS} />

      {loading ? (
        <div className="py-12"><Spinner size="md" label="Loading activity…" /></div>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={Activity}
            tone="brand"
            title="Nothing here yet"
            body="When your friends add or rate a show, it'll show up here in real time."
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {filtered.map((item) => <ActivityRow key={item.id} item={item} />)}
        </Card>
      )}
    </div>
  );
}
