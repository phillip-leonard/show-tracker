'use client';

// components/discover/FansAlsoSeeLink.jsx
//
// "Fans also see" for one band, next to Follow and Band stats wherever a
// band appears: opens /discover/?band=<name> (lib/showRouting.js
// discoverHref). Signed-in only, like Discover itself. Hidden while
// DISCOVER_NAV_ENABLED (lib/constants.js) is false (5.60.2).

import Link from 'next/link';
import { Users } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { discoverHref } from '@/lib/showRouting';
import { DISCOVER_NAV_ENABLED } from '@/lib/constants';

export default function FansAlsoSeeLink({ artist, className = '' }) {
  const { user, guestMode } = useApp();
  if (!DISCOVER_NAV_ENABLED || !user || guestMode || !artist) return null;
  return (
    <Link
      href={discoverHref(artist)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Bands ${artist} fans also see`}
      className={`inline-flex items-center gap-1.5 min-h-touch md:fine:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border border-subtle text-secondary hover:text-brand hover:border-brand/50 transition-colors ${className}`}
    >
      <Users className="w-4 h-4" />
      Fans also see
    </Link>
  );
}
