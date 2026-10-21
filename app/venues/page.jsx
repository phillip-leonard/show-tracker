'use client';

// A venue's page, at /venues/?venue=<venueKey> (lib/showRouting.js's
// venueHref). Previously /venues/[venueKey]/, a dynamic route with only a
// `_` placeholder in out/, which no real venue key could be served from —
// see CLAUDE.md's routing section. netlify.toml 301s the old shape here.
// With no venue selected, Top Venues is the list this page belongs to.

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import VenueDetailClient from './VenueDetailClient';

export default function VenuePage() {
  const router = useRouter();
  const venueKey = useSearchParams().get('venue') || '';
  useEffect(() => {
    if (!venueKey) router.replace('/stats/top-venues/');
  }, [venueKey, router]);
  if (!venueKey) return null;
  return <VenueDetailClient venueKey={venueKey} />;
}
