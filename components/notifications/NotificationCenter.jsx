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
import { MessageSquare, Heart, Image as ImageIcon, Megaphone, Bell, AtSign, PartyPopper, Users, MapPin, CalendarPlus } from 'lucide-react';
import { Card, EmptyState, Spinner, Button, Tabs } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useApp } from '@/context/AppContext';
import { subscribeAllNotifications } from '@/lib/notifications';
import { meetupIdFor } from '@/lib/meetups';
import { timeAgo } from '@/lib/utils';
import { venueHref, showHref as showDetailHref } from '@/lib/showRouting';
import { externalLinkClick } from '@/lib/publicProfile';

const ICONS = {
  comment_reply: MessageSquare,
  comment_like: Heart,
  comment_mention: AtSign,
  photo_like: ImageIcon,
  roadmap_published: Megaphone,
  anniversary: PartyPopper,
  meetup_join: Users,
  venue_bucket_list_match: MapPin,
  followed_band_tour: CalendarPlus,
};

// What the daily followed-band job writes (netlify/functions/lib/
// followedBandAlerts.js): the "Band alerts" tab is just these.
const BAND_ALERT_TYPES = new Set(['followed_band_tour', 'venue_bucket_list_match']);

// A tour alert lists its dates, each linking out to its tickets. The row
// itself has no single destination, so it isn't a link (no nested <a>).
function TourDates({ notification }) {
  const dates = notification.dates || [];
  if (!dates.length) return null;
  const more = (notification.dateCount || dates.length) - dates.length;
  return (
    <ul className="mt-2 space-y-1">
      {dates.map((d, i) => {
        const line = [d.date, d.venue, d.city].filter(Boolean).join(' · ');
        return (
          <li key={i} className="text-xs text-secondary">
            {d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.stopPropagation(); externalLinkClick(e, d.url); }}
                className="hover:text-brand underline-offset-2 hover:underline"
              >
                {line}
              </a>
            ) : line}
          </li>
        );
      })}
      {more > 0 && <li className="text-xs text-muted">…and {more} more</li>}
    </ul>
  );
}

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
        {notification.type === 'followed_band_tour' && <TourDates notification={notification} />}
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
  const [tab, setTab] = useState('all');

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
  const bandAlerts = notifications.filter((n) => BAND_ALERT_TYPES.has(n.type));
  const visible = tab === 'bands' ? bandAlerts : notifications;

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
          body="Replies and likes on your comments and photos, and news from the bands you follow, show up here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'bands', label: 'Band alerts', count: bandAlerts.length },
          ]}
        />
        {hasUnread && <Button size="sm" variant="ghost" onClick={markAllRead}>Mark all as read</Button>}
      </div>
      {visible.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={CalendarPlus}
            tone="brand"
            title="No band alerts yet"
            body="Follow a band and you'll see it here when they announce a tour, or a date at a venue on your bucket list."
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {visible.map((n) => {
            let href = null;
            if (n.type === 'meetup_join' && n.concertKey) {
              href = `/meetups/?id=${meetupIdFor(n.concertKey)}`;
            } else if (n.type === 'venue_bucket_list_match' && n.venueKey) {
              href = venueHref(n.venueKey);
            } else if (n.concertKey) {
              const show = showByKey.get(n.concertKey);
              href = show ? showDetailHref(show.id) : null;
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
      )}
    </div>
  );
}
