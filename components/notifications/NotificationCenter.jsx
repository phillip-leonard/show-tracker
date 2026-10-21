// components/notifications/NotificationCenter.jsx
//
// /notifications page body. Full read+unread history (see
// lib/notifications.js's subscribeAllNotifications — separate from
// AppContext's unread-only listener, which only drives the sidebar
// badge). Clicking a row marks it read and, when resolvable, navigates to
// the concert it's about.

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { MessageSquare, Heart, Image as ImageIcon, Megaphone, Bell, AtSign, PartyPopper, Users, MapPin } from 'lucide-react';
import { Card, EmptyState, Spinner, Button } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useApp } from '@/context/AppContext';
import { subscribeAllNotifications } from '@/lib/notifications';
import { meetupIdFor } from '@/lib/meetups';
import { timeAgo } from '@/lib/utils';
import { venueHref } from '@/lib/showRouting';

const ICONS = {
  comment_reply: MessageSquare,
  comment_like: Heart,
  comment_mention: AtSign,
  photo_like: ImageIcon,
  roadmap_published: Megaphone,
  anniversary: PartyPopper,
  meetup_join: Users,
  venue_bucket_list_match: MapPin,
};

function NotificationRow({ notification, showHref, onClick }) {
  const Icon = ICONS[notification.type] || Bell;
  const RowTag = showHref ? 'a' : 'div';

  return (
    <RowTag
      {...(showHref ? { href: showHref } : {})}
      onClick={(e) => {
        if (showHref) e.preventDefault();
        onClick(notification, showHref);
      }}
      className={`flex items-start gap-3 px-4 py-3.5 border-b border-subtle last:border-0 transition-colors cursor-pointer hover:bg-hover ${
        notification.read ? '' : 'bg-brand-subtle/40'
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-hover flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-brand" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${notification.read ? 'text-secondary' : 'text-primary font-medium'}`}>
          {notification.message}
        </p>
        <p className="text-xs text-muted mt-0.5">{timeAgo(notification.createdAt)}</p>
      </div>
      {!notification.read && <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0 mt-2" />}
    </RowTag>
  );
}

export default function NotificationCenter() {
  const { user, shows, normalizeShowKey } = useApp();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsubscribe = subscribeAllNotifications(user.uid, (list) => {
      setNotifications(list);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // A notification about a concert doesn't carry a showId (concertKey
  // isn't scoped to any one user's private show doc — see
  // lib/notifications.js) — resolve it to *this* user's own matching show
  // instead, which always exists if they're getting the notification at
  // all (they had to have logged that concert to comment/upload on it).
  const showByKey = useMemo(() => {
    const map = new Map();
    (shows || []).forEach((s) => map.set(normalizeShowKey(s), s));
    return map;
  }, [shows, normalizeShowKey]);

  const handleClick = async (notification, showHref) => {
    if (!notification.read) {
      updateDoc(doc(db, 'notifications', notification.id), { read: true }).catch(() => {});
    }
    if (showHref) router.push(showHref);
  };

  const hasUnread = notifications.some((n) => !n.read);

  const markAllRead = async () => {
    await Promise.all(
      notifications.filter((n) => !n.read).map((n) =>
        updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {})
      )
    );
  };

  if (loading) {
    return <div className="py-12"><Spinner size="md" label="Loading notifications…" /></div>;
  }

  if (notifications.length === 0) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={Bell}
          tone="brand"
          title="No notifications yet"
          body="When someone replies to your comment or likes your comment or photo, it'll show up here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {hasUnread && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={markAllRead}>Mark all as read</Button>
        </div>
      )}
      <Card padding="none" className="overflow-hidden">
        {notifications.map((n) => {
          let href = null;
          if (n.type === 'meetup_join' && n.concertKey) {
            href = `/meetups/?id=${meetupIdFor(n.concertKey)}`;
          } else if (n.type === 'venue_bucket_list_match' && n.venueKey) {
            href = venueHref(n.venueKey);
          } else if (n.concertKey) {
            const show = showByKey.get(n.concertKey);
            href = show ? `/shows/${show.id}` : null;
          }
          return (
            <NotificationRow
              key={n.id}
              notification={n}
              showHref={href}
              onClick={handleClick}
            />
          );
        })}
      </Card>
    </div>
  );
}
