// components/activity/ActivityFeedView.jsx
//
// /activity page body. A chronological log of what friends have been
// doing: adding a show, rating one, commenting, or sharing a
// photo/poster/setlist photo. Read through friends.js `activity` since
// 5.60.38 (Stage 6 call B), which keeps it to mutual friends who share
// their activity; a new kind of entry is a new `action` here and on the
// server (netlify/functions/lib/activityLog.js).
//
// Moderation (Guideline 1.2): the server leaves blocks either way out; the
// filter below covers a block taken since the page loaded.

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, PlusCircle, Star, Users, MessageSquare, Camera } from 'lucide-react';
import { Card, EmptyState, Spinner, Tabs, Avatar, Button } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { fetchFriendActivity } from '@/lib/activityFeed';
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
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const friendUids = useMemo(() => (friends || []).map((f) => f.friendUid).filter(Boolean), [friends]);
  const hasFriends = friendUids.length > 0;

  const load = useCallback(async () => {
    setError('');
    try {
      const page = await fetchFriendActivity();
      setItems(page.items);
      setNext(page.next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // On open, and again when the tab comes back into view.
  useEffect(() => {
    if (!user || !hasFriends) { setLoading(false); return undefined; }
    setLoading(true);
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, hasFriends, load]);

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchFriendActivity({ before: next });
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setNext(page.next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = useMemo(() => {
    // The server leaves blocked accounts out; this covers a block taken
    // since the page loaded.
    const visible = withoutBlocked(items, blockedUserIds, 'userId');
    if (filter === 'all') return visible;
    return visible.filter((i) => i.action === filter);
  }, [items, filter, blockedUserIds]);

  if (!hasFriends) {
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
      ) : error && items.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={Activity}
            tone="brand"
            title="Couldn't load activity"
            body={error}
          />
          <div className="flex justify-center mt-3"><Button size="sm" variant="secondary" onClick={load}>Try again</Button></div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={Activity}
            tone="brand"
            title="Nothing here yet"
            body="When your friends add or rate a show, it'll show up here."
          />
        </Card>
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            {filtered.map((item) => <ActivityRow key={item.id} item={item} />)}
          </Card>
          {next && (
            <div className="flex justify-center">
              <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>Show older</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
