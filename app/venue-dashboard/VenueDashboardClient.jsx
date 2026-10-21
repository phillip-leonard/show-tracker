'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { PageHeader, Button, Card, Input, StatTile } from '@/components/ui';
import VerificationBadge from '@/components/venues/VerificationBadge';
import VenueAnnouncements from '@/components/venues/VenueAnnouncements';
import VenuePhotoGallery from '@/components/venues/VenuePhotoGallery';
import { subscribeVenue, updateVenueInfo, venueKeyFor } from '@/lib/venues';
import { venueHref } from '@/lib/showRouting';

const FIELDS = [
  { key: 'capacity', label: 'Capacity', type: 'number' },
  { key: 'yearOpened', label: 'Year Opened', type: 'number' },
  { key: 'officialWebsite', label: 'Website' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
];

export default function VenueDashboardClient({ venueKey }) {
  const router = useRouter();
  const { shows, user } = useApp();
  const [venue, setVenue] = useState(null);
  const [form, setForm] = useState({});
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => subscribeVenue(venueKey, (v) => {
    setVenue(v);
    if (v) {
      setForm({
        capacity: v.capacity || '', yearOpened: v.yearOpened || '',
        officialWebsite: v.officialWebsite || '', phone: v.phone || '', address: v.address || '',
      });
      setBio(v.bio || '');
    }
  }), [venueKey]);

  const myShowsHere = useMemo(
    () => shows.filter((s) => venueKeyFor(s.venue, s.city) === venueKey),
    [shows, venueKey]
  );

  const isOwner = !!(venue?.isVerified && venue?.verifiedOwnerUid === user?.uid);

  const handleSave = async () => {
    if (!isOwner) return;
    setSaving(true);
    try {
      await updateVenueInfo(venueKey, {
        capacity: form.capacity ? Number(form.capacity) : null,
        yearOpened: form.yearOpened ? Number(form.yearOpened) : null,
        officialWebsite: form.officialWebsite || null,
        phone: form.phone || null,
        address: form.address || null,
        bio: bio || null,
      }, user.uid);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save venue info:', err);
    }
    setSaving(false);
  };

  if (venue === null) {
    return <div className="py-24 text-center text-secondary">Loading...</div>;
  }

  if (!isOwner) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg text-primary mb-4">You don't manage this venue.</p>
        <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex" onClick={() => router.push(venueHref(venueKey))}>
          Back to venue page
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex mb-4" onClick={() => router.push(venueHref(venueKey))}>
        Back to venue page
      </Button>

      <PageHeader
        eyebrow="Venue Dashboard"
        title={<span className="inline-flex items-center gap-2">{venue.name} <VerificationBadge size={26} /></span>}
        subtitle={`Verified ${venue.verifiedDate?.toDate ? venue.verifiedDate.toDate().toLocaleDateString() : ''}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatTile value={myShowsHere.length} label="Your shows here" />
        <StatTile value={venue.capacity ?? '—'} label="Capacity" />
        <StatTile value={venue.yearOpened ?? '—'} label="Year opened" />
      </div>

      <Card variant="elevated" padding="lg" className="mb-6">
        <h3 className="text-lg font-semibold text-primary mb-4">Venue Information</h3>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type={f.type || 'text'}
              value={form[f.key] ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          ))}
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-secondary mb-2">Venue Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 1000))}
            rows={4}
            placeholder="Tell fans about your venue..."
            className="w-full px-4 py-2.5 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary text-sm placeholder-muted resize-none"
          />
        </div>
        <Button variant="primary" icon={Save} onClick={handleSave} loading={saving}>
          {saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </Card>

      <div className="grid gap-6">
        <VenueAnnouncements venueKey={venueKey} isOwner currentUser={user} venueName={venue.name} />
        <VenuePhotoGallery venueKey={venueKey} isOwner currentUser={user} venueName={venue.name} />
      </div>
    </div>
  );
}
