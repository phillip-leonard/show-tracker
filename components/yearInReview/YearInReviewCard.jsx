'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { computeYearRecap } from '@/lib/yearRecap';
import { RECAP_YEAR, recapPromoActive, recapHref } from '@/lib/recapLaunch';

// The My Shows banner: "Your 2026 in live music is ready →", Dec 2 – Jan
// 15 (lib/recapLaunch.js), for anyone with a 2026 show. Until 5.59.0 it
// showed from Dec 1 through February and came back on every visit.
//
// Dismissing it is remembered on this device. Storage can be blocked (a
// private window, an iOS setting), so every read and write is wrapped:
// without it the banner just comes back next visit.

const DISMISS_KEY = `mysetlists_recap_banner_dismissed_${RECAP_YEAR}`;

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Storage blocked: dismissed for this visit only.
  }
}

export default function YearInReviewCard({ shows, user }) {
  const router = useRouter();
  const active = recapPromoActive();
  const [dismissed, setDismissed] = useState(() => (typeof window !== 'undefined' ? readDismissed() : false));
  const recap = useMemo(() => (active ? computeYearRecap(shows, RECAP_YEAR) : null), [active, shows]);

  if (!active || !recap || dismissed || !user) return null;

  const dismiss = (e) => {
    e.stopPropagation();
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div className="relative mb-6">
      <button
        type="button"
        onClick={() => router.push(recapHref())}
        className="w-full text-left overflow-hidden rounded-2xl p-5 md:p-6 pr-14 bg-gradient-to-br from-[#1c1c36] to-[#2a2a4e] text-white border border-subtle shadow-theme-lg hover:brightness-110 transition-all"
      >
        <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide mb-1.5 text-[#34D399]">
          <Sparkles size={15} aria-hidden="true" /> Year in Review
        </div>
        <h3 className="text-xl md:text-2xl font-extrabold mb-1">
          Your <span className="text-[#FB923C]">{RECAP_YEAR}</span> in live music is ready &rarr;
        </h3>
        <p className="text-sm text-white/80">
          {recap.totalShows} show{recap.totalShows === 1 ? '' : 's'} · {recap.totalBands} band{recap.totalBands === 1 ? '' : 's'} · {recap.songsHeard} song{recap.songsHeard === 1 ? '' : 's'} heard
        </p>
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-3 right-3 p-2 rounded-lg text-white/80 hover:bg-white/15 min-h-[44px] min-w-[44px] md:fine:min-h-0 md:fine:min-w-0 flex items-center justify-center"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
