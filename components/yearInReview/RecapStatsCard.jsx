'use client';

// The Year in Review card at the top of Stats, Dec 2 – Jan 15
// (lib/recapLaunch.js), for anyone with a show in the recap year.

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { computeYearRecap } from '@/lib/yearRecap';
import { RECAP_YEAR, recapPromoActive, recapHref } from '@/lib/recapLaunch';

export default function RecapStatsCard({ shows }) {
  const active = recapPromoActive();
  const recap = useMemo(() => (active ? computeYearRecap(shows || [], RECAP_YEAR) : null), [active, shows]);
  if (!recap) return null;
  const top = recap.topBands[0];

  return (
    <Link
      href={recapHref()}
      className="block mb-6 rounded-2xl p-5 bg-gradient-to-br from-[#1c1c36] to-[#2a2a4e] text-white border border-subtle hover:brightness-110 transition-all"
    >
      <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide mb-1 text-[#34D399]">
        <Sparkles size={14} aria-hidden="true" /> Year in Review
      </div>
      <p className="text-lg md:text-xl font-extrabold">
        Your <span className="text-[#FB923C]">{RECAP_YEAR}</span> in live music &rarr;
      </p>
      <p className="text-sm text-white/80 mt-0.5">
        {recap.totalShows} show{recap.totalShows === 1 ? '' : 's'} · {recap.songsHeard} song{recap.songsHeard === 1 ? '' : 's'} heard{top ? ` · most seen: ${top.name}` : ''}
      </p>
    </Link>
  );
}
