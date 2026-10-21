'use client';

// A verified owner's venue dashboard, at /venue-dashboard/?venue=<venueKey>
// (lib/showRouting.js's venueDashboardHref). Moved off the
// /venue-dashboard/[venueKey]/ dynamic route for the same reason as
// app/venues/page.jsx.

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import VenueDashboardClient from './VenueDashboardClient';

export default function VenueDashboardPage() {
  const router = useRouter();
  const venueKey = useSearchParams().get('venue') || '';
  useEffect(() => {
    if (!venueKey) router.replace('/stats/top-venues/');
  }, [venueKey, router]);
  if (!venueKey) return null;
  return <VenueDashboardClient venueKey={venueKey} />;
}
