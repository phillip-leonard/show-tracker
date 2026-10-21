'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, BookMarked } from 'lucide-react';
import { Button } from '@/components/ui';
import { subscribeBucketListVenues, addVenueToBucketList, removeVenueFromBucketList } from '@/lib/bucketListVenues';

// Toggle shown on the venue detail page — lets a signed-in user add this
// venue to their venue bucket list (see lib/bucketListVenues.js). Distinct
// from lib/bucketList.js's "add this specific show" flow: this just marks
// interest in the venue itself, which the daily
// followed-band-notifications job matches against followed bands.
export default function VenueBucketListButton({ venueKey, venueName, venueCity, venueState, currentUser }) {
  const [onList, setOnList] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentUser || !venueKey) return;
    return subscribeBucketListVenues(currentUser.uid, (list) => {
      setOnList(list.some((v) => v.venueKey === venueKey));
    });
  }, [currentUser, venueKey]);

  if (!currentUser) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (onList) {
        await removeVenueFromBucketList(currentUser.uid, venueKey);
      } else {
        await addVenueToBucketList(currentUser.uid, { venueName, venueCity, venueState });
      }
    } catch (err) {
      console.error('Failed to toggle venue bucket list:', err);
    }
    setBusy(false);
  };

  return (
    <Button
      variant={onList ? 'secondary' : 'ghost'}
      icon={onList ? BookMarked : Bookmark}
      onClick={toggle}
      loading={busy}
    >
      {onList ? 'On Bucket List' : 'Add to Bucket List'}
    </Button>
  );
}
