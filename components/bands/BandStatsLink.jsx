'use client';

// components/bands/BandStatsLink.jsx
//
// "Band stats" for one band, wherever a band appears (My Shows by artist,
// Stats → Artists): opens its band screen (/bands/?band=<slug>). Renders
// nothing for a band with no snapshot, or until /api/artists has said
// which bands have one (hooks/useBandScreens.js useBandFor).

import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { useBandFor } from '@/hooks/useBandScreens';
import { bandHref } from '@/lib/showRouting';

export default function BandStatsLink({ artist, className = '' }) {
  const bandFor = useBandFor();
  const band = bandFor(artist);
  if (!band) return null;
  return (
    <Link
      href={bandHref(band.slug)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${band.name} band stats`}
      className={`inline-flex items-center gap-1.5 min-h-touch md:fine:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border border-subtle text-secondary hover:text-brand hover:border-brand/50 transition-colors ${className}`}
    >
      <BarChart3 className="w-4 h-4" />
      Band stats
    </Link>
  );
}
