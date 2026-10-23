'use client';

// components/shows/ReliveThisNightCard.jsx
//
// "Relive this night's magic": the show from today's month and day in an
// earlier year, at the top of My Shows. Which show, and whether to offer
// one at all today, is decided by reliveShowFor (lib/reliveThisNight.js);
// this only draws it, around the same ShowCard the timeline uses.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import ShowCard from '@/components/shows/ShowCard';
import { dismissReliveShow, localIsoDate } from '@/lib/reliveThisNight';
import { showHref } from '@/lib/showRouting';
import { toIsoDate } from '@/lib/utils';

const GREEN = '#34D399';
const ORANGE = '#FB923C';

export default function ReliveThisNightCard({ show, friends, runInfo, tourHref, festival }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (!show || dismissed) return null;

  const yearsAgo = Number(localIsoDate().slice(0, 4)) - Number(toIsoDate(show.date).slice(0, 4));

  return (
    <section
      aria-labelledby="relive-this-night-heading"
      className="relative mb-6 rounded-2xl border p-3 md:p-4"
      style={{
        borderColor: `${GREEN}55`,
        background: `linear-gradient(135deg, ${GREEN}1f, ${ORANGE}14)`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3 px-1">
        <div className="min-w-0">
          <h2
            id="relive-this-night-heading"
            className="flex items-center gap-2 text-lg md:text-xl font-extrabold text-primary"
          >
            <Sparkles className="w-5 h-5 flex-shrink-0" style={{ color: GREEN }} aria-hidden="true" />
            Relive this night&apos;s magic
          </h2>
          <p className="text-sm font-semibold mt-0.5" style={{ color: ORANGE }}>
            {yearsAgo} year{yearsAgo !== 1 ? 's' : ''} ago tonight
          </p>
        </div>
        <button
          type="button"
          onClick={() => { dismissReliveShow(); setDismissed(true); }}
          className="flex-shrink-0 inline-flex items-center justify-center min-w-touch min-h-touch md:min-w-0 md:min-h-0 md:p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ShowCard
        show={show}
        friends={friends}
        onClick={() => router.push(showHref(show.id))}
        runInfo={runInfo}
        tourHref={tourHref}
        festival={festival}
      />
    </section>
  );
}
