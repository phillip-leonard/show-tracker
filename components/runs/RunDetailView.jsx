// components/runs/RunDetailView.jsx
//
// A multi-night run: header + stat row, the repeats readout (the heart of
// the page — a genuine no-repeat run gets celebratory treatment since it's
// rare and it's what people brag about), night-by-night setlists (reusing
// SetlistView + groupSongsBySet, same as the show detail page), the best
// night by rating, and a combined setlist showing which nights each song
// landed on.

'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, PartyPopper, Star, AlertTriangle } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Card, Badge, StatFigure } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { groupSongsBySet } from '@/lib/setlistGrouping';
import { artistSlugFromName, songSlugFromTitle } from '@/lib/songIndex';
import SetlistView from '@/components/shows/SetlistView';
import SetlistfmAttribution from '@/components/shows/SetlistfmAttribution';
import { showHref } from '@/lib/showRouting';

function buildSets(setlist = []) {
  return groupSongsBySet(setlist).map(({ label, songs }) => ({
    label,
    tracks: songs.map(song => ({
      title: song.song || song.name || song.title || '',
      duration: song.duration || null,
      tape: song.tape || false,
      manual: !!song.manuallyAdded,
      // Same band-source extras the show detail passes through, so a run
      // night renders identically to that night's own show page.
      transitionMark: song.transitionMark || null,
      footnote: song.footnote || null,
      jamchart: !!song.jamchart,
      jamchartNote: song.jamchartNote || null,
    })),
  }));
}

export default function RunDetailView({ run }) {
  const router = useRouter();

  const goToShow = (showId) => {
    router.push(showHref(showId));
  };

  const artistSlug = run.artistSlug;
  const getSongHref = (title) => {
    if (!artistSlug) return null;
    const songSlug = songSlugFromTitle(title);
    return songSlug ? `/songs/?artist=${artistSlug}&song=${songSlug}` : null;
  };

  const summaryLine = `${run.nightCount} night${run.nightCount !== 1 ? 's' : ''} at ${run.venueName}`;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/shows/"
        // Hidden below md:: components/layout/MobileHeader.jsx now carries
        // the back control on this screen, and two back affordances stacked
        // on one screen is the doubled-header problem this work removes.
        // Desktop keeps it, with a real vertical hit area.
        className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 py-2 -my-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4" />
        All shows
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">
        <h1 className="text-2xl font-bold text-primary mb-1">
          {formatDate(run.dateRange.start)} – {formatDate(run.dateRange.end)}
        </h1>
        <Link
          href={`/shows/?artist=${encodeURIComponent(run.artistName)}`}
          className="text-sm text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
        >
          {run.artistName}
        </Link>
        <p className="text-sm text-secondary mt-1">{summaryLine}</p>

        {/* Stat row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <Card padding="sm"><StatFigure value={run.nightCount} label="Nights" /></Card>
          <Card padding="sm"><StatFigure value={run.uniqueSongs} label="Unique Songs" /></Card>
          <Card padding="sm"><StatFigure value={run.totalSongs} label="Total Songs" /></Card>
          <Card padding="sm">
            <StatFigure value={run.avgRating != null ? run.avgRating.toFixed(1) : '—'} label="Avg Rating" />
          </Card>
        </div>
      </div>

      {/* ── Repeats readout — the heart of the page ────────────────────── */}
      <Card padding="md" className={`mb-6 ${run.noRepeat === true ? 'border-amber/40 bg-amber/5' : ''}`}>
        {run.hasIncompleteData ? (
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-muted flex-shrink-0 mt-0.5" />
            <p className="text-sm text-secondary">
              At least one night's setlist hasn't been logged yet, so whether this run repeated any songs can't be determined.
            </p>
          </div>
        ) : run.noRepeat ? (
          <div className="flex items-start gap-2.5">
            <PartyPopper className="w-5 h-5 text-amber flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-base font-bold text-primary">No repeats across {run.nightCount} nights!</p>
              <p className="text-sm text-secondary mt-0.5">Every one of the {run.uniqueSongs} songs played was played exactly once.</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-primary mb-2">
              {run.repeats.length} song{run.repeats.length !== 1 ? 's' : ''} repeated ({run.uniqueSongs} unique of {run.totalSongs} total)
            </p>
            <ul className="space-y-1">
              {run.repeats.map(r => (
                <li key={r.key} className="text-sm text-secondary">
                  <span className="text-primary font-medium">{r.title}</span> — Night{r.nightNumbers.length !== 1 ? 's' : ''} {r.nightNumbers.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Night by night ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-primary mb-4">Night by Night</h2>
        <div className="space-y-6">
          {run.nights.map((night, i) => (
            <Card key={night.showId} padding="md">
              <div className="flex items-center justify-between gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => goToShow(night.showId)}
                  className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                >
                  <span className="text-sm font-bold text-primary hover:text-brand transition-colors">
                    Night {i + 1} · {formatDate(night.date)}
                  </span>
                  {i === run.bestNightIndex && (
                    <Badge tone="amber" size="sm" className="ml-2">Best night</Badge>
                  )}
                </button>
                {night.rating > 0 && (
                  <div className="flex items-center gap-1 text-sm font-semibold text-amber flex-shrink-0">
                    <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    {night.rating}/10
                  </div>
                )}
              </div>
              {night.hasSetlist ? (
                <>
                  <SetlistView sets={buildSets(night.setlist)} getSongHref={getSongHref} />
                  <SetlistfmAttribution show={night} />
                </>
              ) : (
                <p className="text-sm text-muted">Setlist not logged for this night.</p>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* ── Combined setlist ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-primary mb-4">Combined Setlist</h2>
        <Card padding="none">
          <ul className="list-none p-0 m-0 divide-y divide-subtle">
            {run.combinedSetlist.map(s => (
              <li key={s.key} className="flex items-center justify-between gap-3 px-4 py-3">
                {getSongHref(s.title) ? (
                  <Link
                    href={getSongHref(s.title)}
                    className="text-[15px] font-medium text-primary hover:text-brand hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                  >
                    {s.title}
                  </Link>
                ) : (
                  <span className="text-[15px] font-medium text-primary">{s.title}</span>
                )}
                <span className="text-xs text-muted flex-shrink-0">
                  Night{s.nightNumbers.length !== 1 ? 's' : ''} {s.nightNumbers.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
