'use client';

// components/discover/BandSuggestionRow.jsx
//
// One suggested band: its name (linking to its band screen when it has one),
// why it's suggested, the follow bell, and optionally "Not interested".
// Used by Discover, "Fans of X also see…" and festival picks.
//
// Every number shown here is a count of distinct people at or above
// MIN_CO_FANS (lib/recommendations.js); the job never stores smaller ones.

import Link from 'next/link';
import { X } from 'lucide-react';
import FollowBandButton from '@/components/artists/FollowBandButton';
import { useBandFor } from '@/hooks/useBandScreens';
import { bandHref } from '@/lib/showRouting';
import { artistColor } from '@/lib/utils';

export default function BandSuggestionRow({ name, reason, detail, badge, onDismiss, compact = false }) {
  const bandFor = useBandFor();
  const band = bandFor(name);
  const title = (
    <span className="font-semibold" style={{ color: artistColor(name) }}>{name}</span>
  );
  return (
    <li className={`flex items-center gap-3 ${compact ? 'py-2.5' : 'py-3.5'} border-b border-subtle last:border-b-0`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {band ? (
            <Link href={bandHref(band.slug)} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded">
              {title}
            </Link>
          ) : title}
          {badge && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted bg-hover rounded px-1.5 py-0.5">{badge}</span>
          )}
        </div>
        {reason && <p className="text-sm text-secondary mt-0.5">{reason}</p>}
        {detail && <p className="text-xs text-muted mt-0.5">{detail}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <FollowBandButton artist={name} compact={compact} />
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`Not interested in ${name}`}
            title="Not interested"
            className="min-w-touch min-h-touch md:fine:min-w-0 md:fine:min-h-0 p-2 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </li>
  );
}
