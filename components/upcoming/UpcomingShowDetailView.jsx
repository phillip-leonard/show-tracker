'use client';

// One upcoming show: /shows/?upcoming=<id> (see lib/showRouting.js).
//
// Date, venue and who's going; tag or remove friends; edit; delete. Once
// the date has passed it asks "Did you go?" — yes looks the setlist up on
// setlist.fm and turns this into a normal show in My Shows (tags carried
// over); no deletes it.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Calendar, MapPin, Clock, Ticket, Users, UserPlus, X, Edit2, Trash2, Check, StickyNote,
} from 'lucide-react';
import { Card, Button, Modal, Badge } from '@/components/ui';
import { goingFriends, isUpcomingPast, todayIso } from '@/lib/upcomingShows';

function formatLongDate(date) {
  if (!date) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatTime(time) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const STATUS_LABEL = { accepted: 'Going', pending: 'Invited', declined: 'Declined' };

export default function UpcomingShowDetailView({
  show,
  friends = [],
  blockedUserIds = [],
  backLabel = 'All shows',
  onClose,
  onEdit,
  onDelete,
  onTagFriends,
  onUntagFriend,
  loadTagStatuses,
  onConvert,
}) {
  const [statuses, setStatuses] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(null); // friendUid being removed
  const [converting, setConverting] = useState(false);

  const past = isUpcomingPast(show, todayIso());
  const going = useMemo(() => goingFriends(show, friends, blockedUserIds), [show, friends, blockedUserIds]);
  const taggedKey = (show.taggedFriendUids || []).join(',');
  // Who tagged *me*, when this is my copy of a friend's show. Hidden if I've
  // since blocked them.
  const invitedBy = show.taggedBy && !blockedUserIds.includes(show.taggedByUid) ? show.taggedBy : null;

  useEffect(() => {
    let cancelled = false;
    if (!loadTagStatuses || !taggedKey) return undefined;
    loadTagStatuses(show.id).then(s => { if (!cancelled) setStatuses(s || {}); });
    return () => { cancelled = true; };
  }, [show.id, taggedKey, loadTagStatuses]);

  const time = formatTime(show.time);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(show);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleUntag = async (uid) => {
    setRemoving(uid);
    try {
      await onUntagFriend(show, uid);
    } finally {
      setRemoving(null);
    }
  };

  const handleConvert = async () => {
    setConverting(true);
    try {
      await onConvert(show);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Desktop back control; on phones the MobileHeader provides it
          (lib/navRoutes.js declares ?upcoming= a /shows detail view). */}
      <button
        type="button"
        onClick={onClose}
        className="hidden md:flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 transition-colors py-2 -my-2"
      >
        <ArrowLeft className="w-4 h-4" />
        {backLabel}
      </button>

      <Card padding="none" className="overflow-hidden mb-4">
        <div className="p-5 md:p-6 bg-gradient-to-br from-amber/15 to-brand/10 border-b border-subtle">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge tone={past ? 'amber' : 'green'} size="sm" uppercase>{past ? 'Happened' : 'Upcoming'}</Badge>
              <h1 className="text-[24px] md:text-[28px] font-bold tracking-[-0.015em] text-primary mt-2 break-words">{show.artist}</h1>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button variant="ghost" icon={Edit2} onClick={() => onEdit(show)} aria-label="Edit upcoming show" className="tap-target" />
              <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete upcoming show" className="tap-target text-danger" />
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-primary">
              <Calendar className="w-4 h-4 text-amber flex-shrink-0" />
              <span>{formatLongDate(show.date)}</span>
            </div>
            {time && (
              <div className="flex items-center gap-2 text-secondary">
                <Clock className="w-4 h-4 text-muted flex-shrink-0" />
                <span>{time}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-secondary">
              <MapPin className="w-4 h-4 text-muted flex-shrink-0" />
              <span>{show.venue}{show.city ? `, ${show.city}` : ''}</span>
            </div>
            {invitedBy && (
              <div className="flex items-center gap-2 text-secondary">
                <UserPlus className="w-4 h-4 text-muted flex-shrink-0" />
                <span>Tagged by {invitedBy}</span>
              </div>
            )}
          </div>
          {show.ticketUrl && !past && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline min-h-touch md:min-h-0"
            >
              <Ticket className="w-4 h-4" />
              Tickets
            </a>
          )}
        </div>

        {show.notes && (
          <div className="p-5 md:p-6 border-b border-subtle flex gap-2 text-sm text-secondary whitespace-pre-wrap">
            <StickyNote className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
            <p>{show.notes}</p>
          </div>
        )}

        {past && (
          <div className="p-5 md:p-6 border-b border-subtle bg-amber-subtle">
            <h2 className="text-base font-bold text-primary mb-1">Did you go?</h2>
            <p className="text-sm text-secondary mb-4">
              Add it to My Shows. We&apos;ll pull the setlist from setlist.fm if there is one, and keep the friends you tagged.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="primary" icon={Check} onClick={handleConvert} loading={converting}>
                {converting ? 'Finding the setlist…' : 'Yes, add to My Shows'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={converting}>
                I didn&apos;t go
              </Button>
            </div>
          </div>
        )}

        {/* Who's going */}
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-primary">
              <Users className="w-4 h-4 text-brand" />
              Who&apos;s going
            </h2>
            {onTagFriends && (
              <Button variant="secondary" size="sm" icon={UserPlus} onClick={() => onTagFriends(show)}>
                Tag friends
              </Button>
            )}
          </div>
          {going.length === 0 ? (
            <p className="text-sm text-muted">
              {onTagFriends ? 'Tag the friends you’re going with. They’ll get a notification and an email.' : 'Just you so far.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {going.map(friend => {
                const status = statuses[friend.friendUid];
                return (
                  <li key={friend.friendUid} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-hover">
                    <div className="w-8 h-8 rounded-full bg-brand-subtle text-brand flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {(friend.friendName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-primary truncate">{friend.friendName || 'Friend'}</div>
                      {STATUS_LABEL[status] && (
                        <div className={`text-xs ${status === 'accepted' ? 'text-brand' : 'text-muted'}`}>{STATUS_LABEL[status]}</div>
                      )}
                    </div>
                    {onUntagFriend && (
                      <button
                        type="button"
                        onClick={() => handleUntag(friend.friendUid)}
                        disabled={removing === friend.friendUid}
                        className="tap-target rounded-lg text-muted hover:text-danger hover:bg-surface transition-colors disabled:opacity-50"
                        aria-label={`Remove ${friend.friendName || 'friend'}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        title={past ? 'Remove this show?' : 'Delete upcoming show?'}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>Delete</Button>
          </>
        )}
      >
        <p className="text-secondary text-sm">
          {show.artist} on {formatLongDate(show.date)} will be removed from your upcoming shows.
          {going.length > 0 && ' Friends who haven’t answered your tag yet won’t see it any more.'}
        </p>
      </Modal>
    </div>
  );
}
