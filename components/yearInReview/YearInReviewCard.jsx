'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { computeYearInReview } from '@/lib/yearInReview';
import { yearInReviewHref } from '@/lib/showRouting';

// Determines which year's review is "ready" right now — available
// mid-December through February per the spec. December shows the review
// for the year currently ending; January/February show the prior year's.
function currentReviewYear(now = new Date()) {
  const month = now.getMonth(); // 0-indexed
  if (month === 11) return now.getFullYear(); // December
  if (month <= 1) return now.getFullYear() - 1; // Jan/Feb
  return null;
}

// Promo banner shown on the home/shows page mid-December through
// February: "Your <year> Year in Concerts is Ready!"
export default function YearInReviewCard({ shows, user }) {
  const [dismissed, setDismissed] = useState(false);
  const router = useRouter();

  const year = useMemo(() => currentReviewYear(), []);
  const stats = useMemo(() => (year ? computeYearInReview(shows, year) : null), [shows, year]);

  if (!year || !stats || dismissed || !user) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(yearInReviewHref(user.uid, year))}
      className="w-full text-left mb-6 relative overflow-hidden rounded-2xl p-5 md:p-6 bg-gradient-to-br from-brand to-[#059669] text-white shadow-theme-lg hover:brightness-105 transition-all"
    >
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setDismissed(true); } }}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/20"
        aria-label="Dismiss"
      >
        <X size={16} />
      </span>
      <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide mb-1.5 opacity-90">
        <Sparkles size={15} /> Year in Review
      </div>
      <h3 className="text-xl md:text-2xl font-extrabold mb-1">Your {year} Year in Concerts is Ready!</h3>
      <p className="text-sm opacity-90">{stats.totalShows} shows · {stats.totalArtists} bands · {stats.totalVenues} venues — see your full recap &rarr;</p>
    </button>
  );
}
