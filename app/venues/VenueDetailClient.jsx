'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Star, Flag, ExternalLink } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useApp } from '@/context/AppContext';
import { PageHeader, Button, Card, StatTile } from '@/components/ui';
import VerificationBadge from '@/components/venues/VerificationBadge';
import VerifyVenueButton from '@/components/venues/VerifyVenueButton';
import VenueBucketListButton from '@/components/venues/VenueBucketListButton';
import ReportVenueModal from '@/components/venues/ReportVenueModal';
import VenueAnnouncements from '@/components/venues/VenueAnnouncements';
import VenuePhotoGallery from '@/components/venues/VenuePhotoGallery';
import { subscribeVenue, venueKeyFor } from '@/lib/venues';
import { venueDashboardHref } from '@/lib/showRouting';

export default function VenueDetailClient({ venueKey }) {
  const router = useRouter();
  const { shows, user } = useApp();
  const [venue, setVenue] = useState(null);
  const [communityRatings, setCommunityRatings] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => subscribeVenue(venueKey, setVenue), [venueKey]);

  useEffect(() => {
    if (!venueKey) return;
    getDocs(query(collection(db, 'venueRatings'), where('venueKey', '==', venueKey)))
      .then((snap) => setCommunityRatings(snap.docs.map((d) => d.data())))
      .catch((err) => console.error('Failed to load venue ratings:', err));
  }, [venueKey]);

  const myShowsHere = useMemo(
    () => shows.filter((s) => venueKeyFor(s.venue, s.city) === venueKey),
    [shows, venueKey]
  );

  const venueName = venue?.name || myShowsHere[0]?.venue || 'Venue';
  const venueCity = venue?.city || myShowsHere[0]?.city || '';

  const avgRating = communityRatings.length
    ? (communityRatings.reduce((sum, r) => sum + (r.overallRating || 0), 0) / communityRatings.length).toFixed(1)
    : null;

  const isOwner = !!(venue?.isVerified && venue?.verifiedOwnerUid === user?.uid);

  return (
    <div>
      <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex mb-4" onClick={() => router.back()}>Back</Button>

      <PageHeader
        eyebrow="Venue"
        title={
          <span className="inline-flex items-center gap-2">
            {venueName}
            {venue?.isVerified && <VerificationBadge size={26} />}
          </span>
        }
        subtitle={venueCity}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <VerifyVenueButton venue={venue} venueKey={venueKey} venueName={venueName} venueCity={venueCity} currentUser={user} />
            <VenueBucketListButton venueKey={venueKey} venueName={venueName} venueCity={venueCity} venueState={venue?.state} currentUser={user} />
            {isOwner && (
              <Button variant="secondary" onClick={() => router.push(venueDashboardHref(venueKey))}>
                Manage Venue
              </Button>
            )}
            {user && (
              <Button variant="ghost" icon={Flag} onClick={() => setReportOpen(true)}>Report</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatTile value={myShowsHere.length} label="Your shows here" />
        <StatTile value={communityRatings.length} label="Community ratings" />
        <StatTile value={avgRating ?? '—'} unit={avgRating ? '/5' : ''} label="Avg. rating" tone="brand" />
        <StatTile value={venue?.capacity ?? '—'} label="Capacity" />
      </div>

      {venue?.bio && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <p className="text-secondary text-sm">{venue.bio}</p>
        </Card>
      )}

      {(venue?.officialWebsite || venue?.yearOpened || venue?.address) && (
        <Card variant="elevated" padding="lg" className="mb-6">
          <h3 className="text-lg font-semibold text-primary mb-3">Venue Info</h3>
          <div className="space-y-1.5 text-sm text-secondary">
            {venue.address && <p>{venue.address}</p>}
            {venue.yearOpened && <p>Opened {venue.yearOpened}</p>}
            {venue.officialWebsite && (
              <a href={venue.officialWebsite} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                Official Website <ExternalLink size={13} />
              </a>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 mb-6">
        <VenueAnnouncements venueKey={venueKey} isOwner={isOwner} currentUser={user} venueName={venueName} />
        <VenuePhotoGallery venueKey={venueKey} isOwner={isOwner} currentUser={user} venueName={venueName} />
      </div>

      {myShowsHere.length > 0 && (
        <Card variant="elevated" padding="lg">
          <h3 className="text-lg font-semibold text-primary mb-3">Your Shows Here</h3>
          <div className="space-y-2">
            {myShowsHere.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-subtle last:border-0">
                <span className="text-primary font-medium">{s.artist}</span>
                <span className="text-secondary flex items-center gap-3">
                  {s.date}
                  {typeof s.rating === 'number' && (
                    <span className="flex items-center gap-1 text-amber"><Star size={13} fill="currentColor" />{s.rating}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ReportVenueModal open={reportOpen} onClose={() => setReportOpen(false)} venueKey={venueKey} venueName={venueName} currentUser={user} />
    </div>
  );
}
