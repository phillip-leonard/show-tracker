// components/bucketlist/VenueBucketListSection.jsx
//
// "Venues" section of /bucket-list — venues (not specific shows) a user
// wants to see a show at. See lib/bucketListVenues.js for the schema.
// Matched against favorite artists' upcoming events by the daily
// netlify/functions/venue-bucket-list-notifications.js scheduled job,
// which creates a 'venue_bucket_list_match' notification on a hit.

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Plus, Trash2, Bell, ChevronRight } from 'lucide-react';
import { Card, EmptyState, Button, Input } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import {
  subscribeBucketListVenues, addVenueToBucketList, removeVenueFromBucketList,
} from '@/lib/bucketListVenues';
import { venueHref } from '@/lib/showRouting';

function AddVenueForm({ onAdd, adding }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ venueName: '', venueCity: '', venueState: '' });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.venueName.trim()) return;
    await onAdd(form);
    setForm({ venueName: '', venueCity: '', venueState: '' });
    setOpen(false);
  };

  if (!open) {
    return (
      <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
        Add a venue
      </Button>
    );
  }

  return (
    <Card variant="inset" padding="md">
      <form onSubmit={submit} className="space-y-3">
        <Input placeholder="Venue name" value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} required />
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="City" value={form.venueCity} onChange={(e) => setForm({ ...form, venueCity: e.target.value })} />
          <Input placeholder="State" value={form.venueState} onChange={(e) => setForm({ ...form, venueState: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={adding}>Add to Bucket List</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function VenueCard({ venue, onRemove, removing }) {
  const router = useRouter();
  const goToVenue = () => router.push(venueHref(venue.venueKey));

  return (
    <Card
      padding="md"
      interactive
      onClick={goToVenue}
      className="flex items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="font-bold text-primary truncate">{venue.venueName}</div>
        {(venue.venueCity || venue.venueState) && (
          <div className="flex items-center gap-1.5 text-sm text-muted mt-0.5">
            <MapPin size={13} className="flex-shrink-0" />
            <span className="truncate">{[venue.venueCity, venue.venueState].filter(Boolean).join(', ')}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-secondary mt-2">
          <Bell size={12} className="flex-shrink-0 text-brand" />
          We'll notify you if a favorite artist announces a show here
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <ChevronRight size={16} className="text-muted mt-1" />
        <Button
          size="sm" variant="ghost" icon={Trash2}
          loading={removing}
          className="text-danger hover:bg-[#fdecec]"
          onClick={(e) => { e.stopPropagation(); onRemove(venue); }}
        />
      </div>
    </Card>
  );
}

export default function VenueBucketListSection() {
  const { user, setToast } = useApp();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingKey, setRemovingKey] = useState(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsub = subscribeBucketListVenues(user.uid, (list) => { setVenues(list); setLoading(false); });
    return unsub;
  }, [user]);

  const handleAdd = async (form) => {
    setAdding(true);
    try {
      await addVenueToBucketList(user.uid, form);
      setToast?.('Added to your venue bucket list.');
    } catch (err) {
      console.error('[bucketListVenues] Failed to add:', err);
      setToast?.("Couldn't add that venue. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (venue) => {
    setRemovingKey(venue.venueKey);
    try {
      await removeVenueFromBucketList(user.uid, venue.venueKey);
    } catch (err) {
      setToast?.("Couldn't remove that venue. Please try again.");
    } finally {
      setRemovingKey(null);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-5">
      <AddVenueForm onAdd={handleAdd} adding={adding} />

      {venues.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={MapPin}
            tone="brand"
            title="No venues on your bucket list yet"
            body="Add a venue you've always wanted to see a show at — we'll notify you when one of your favorite artists announces a show there."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {venues.map((v) => (
            <VenueCard key={v.venueKey} venue={v} onRemove={handleRemove} removing={removingKey === v.venueKey} />
          ))}
        </div>
      )}
    </div>
  );
}
