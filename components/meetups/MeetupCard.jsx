// components/meetups/MeetupCard.jsx
//
// Compact meetup widget embedded on a bucket-list item — shows how many
// people are meeting up for this show and a Join/Leave control. See
// lib/meetups.js for why this is keyed off a shared concertKey rather than
// the bucket-list item's own doc id.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Plus, LogOut } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { subscribeMeetup, createOrJoinMeetup, leaveMeetup, meetupIdFor } from '@/lib/meetups';
import { Button } from '@/components/ui';

export default function MeetupCard({ show }) {
  const { user, guestMode, normalizeShowKey, setToast } = useApp();
  const concertKey = normalizeShowKey(show);
  const meetupId = meetupIdFor(concertKey);

  const [meetup, setMeetup] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => subscribeMeetup(concertKey, setMeetup), [concertKey]);

  if (guestMode || !user) return null;

  const attendeeCount = meetup?.attendeeUids?.length || 0;
  const isAttending = (meetup?.attendeeUids || []).includes(user.uid);

  const handleJoin = async () => {
    setLoading(true);
    try {
      await createOrJoinMeetup(show);
    } catch (err) {
      console.error('[meetups] Failed to join:', err);
      setToast?.("Couldn't join the meetup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    try {
      await leaveMeetup(meetupId);
    } catch (err) {
      console.error('[meetups] Failed to leave:', err);
      setToast?.("Couldn't leave the meetup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {attendeeCount > 0 && (
        <Link href={`/meetups/?id=${meetupId}`} className="flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
          <Users className="w-3.5 h-3.5" />
          {attendeeCount} {attendeeCount === 1 ? 'person' : 'people'} meeting up
        </Link>
      )}
      {isAttending ? (
        <>
          <Link href={`/meetups/?id=${meetupId}`}>
            <Button size="sm" variant="ghost">View meetup</Button>
          </Link>
          <Button size="sm" variant="ghost" icon={LogOut} loading={loading} className="text-danger hover:bg-[#fdecec]" onClick={handleLeave}>
            Leave
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" icon={Plus} loading={loading} onClick={handleJoin}>
          {attendeeCount > 0 ? 'Join meetup' : 'Find or create meetup'}
        </Button>
      )}
    </div>
  );
}
