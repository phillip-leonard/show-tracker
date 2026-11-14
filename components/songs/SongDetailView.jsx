// components/songs/SongDetailView.jsx
//
// A single song's personal history: times seen, first/last seen, the
// current personal gap stated as a sentence, every performance in reverse
// chronological order, a by-year strip, a set-position breakdown, and the
// user's best-rated versions (per-performance ratings — there's no
// separate per-song-overall rating field to read instead).

'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, StatFigure } from '@/components/ui';
import { formatDate, humanizeGapDuration } from '@/lib/utils';
import SongPerformanceRow from '@/components/songs/SongPerformanceRow';
import { showHref } from '@/lib/showRouting';
import { showYear } from '@/lib/showDate';

function venueLabel({ venue, city }) {
  if (!venue) return null;
  return city ? `${venue}, ${city}` : venue;
}

function gapSentence(song) {
  const { currentGap, lastSeen } = song;
  const where = venueLabel(lastSeen);
  const when = formatDate(lastSeen.date);

  if (currentGap.shows === 0) {
    return `You saw this at your most recent show${where ? ` — ${where}, ${when}` : ` (${when})`}.`;
  }

  const showsPhrase = `${currentGap.shows} show${currentGap.shows !== 1 ? 's' : ''}`;
  const duration = humanizeGapDuration(currentGap.days);
  const sinceBit = where ? `since ${where}, ${when}` : `since ${when}`;
  return `You haven't seen this in ${showsPhrase}${duration ? ` — ${duration} ${sinceBit}` : ` — ${sinceBit}`}.`;
}

function positionBreakdown(performances) {
  if (!performances.some(p => p.setLabel)) return null;

  const openerCount = performances.filter(p => p.isShowOpener).length;
  const encoreCount = performances.filter(p => p.isEncore).length;
  const closerCounts = new Map();
  performances.forEach(p => {
    if (p.isSetCloser && p.setLabel && !p.isEncore) {
      closerCounts.set(p.setLabel, (closerCounts.get(p.setLabel) || 0) + 1);
    }
  });

  const countPhrase = (n) => (n === 1 ? 'once' : `${n}×`);
  const parts = [];
  if (openerCount > 0) parts.push(`Opened the show ${countPhrase(openerCount)}`);
  closerCounts.forEach((count, label) => parts.push(`Closed ${label} ${countPhrase(count)}`));
  if (encoreCount > 0) parts.push(`Played in the encore ${countPhrase(encoreCount)}`);

  return parts.length ? `${parts.join(', ')}.` : null;
}

function PerformancesByYear({ performances }) {
  const counts = new Map();
  performances.forEach(p => {
    const year = showYear(p.date);
    if (!year) return;
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  const years = [...counts.keys()].sort();
  if (years.length === 0) return <p className="text-sm text-secondary">No dated performances yet.</p>;

  const max = Math.max(...counts.values());
  return (
    <div className="flex items-end gap-2 h-24">
      {years.map(year => {
        const count = counts.get(year);
        return (
          <div key={year} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[11px] font-bold text-primary">{count}</span>
            <div
              className="w-full bg-brand rounded-t-md min-h-[6px]"
              style={{ height: `${Math.max(6, (count / max) * 64)}px` }}
              aria-hidden="true"
            />
            <span className="text-[10px] text-muted font-semibold truncate w-full text-center">{year}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function SongDetailView({ song }) {
  const router = useRouter();

  const goToShow = (showId) => {
    router.push(showHref(showId));
  };

  const bestVersions = song.performances
    .filter(p => p.rating > 0)
    .slice()
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);

  const breakdown = positionBreakdown(song.performances);

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
        <h1 className="text-2xl font-bold text-primary mb-1 flex items-center gap-2 flex-wrap">
          {song.title}
        </h1>
        <Link
          href={`/shows/?artist=${encodeURIComponent(song.artistName)}`}
          className="text-sm text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
        >
          {song.artistName}
        </Link>

        {/* Stat row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <Card padding="sm"><StatFigure value={song.timesSeen} label="Times Seen" /></Card>
          <Card padding="sm">
            <StatFigure value={formatDate(song.firstSeen.date)} label="First Seen" />
            {song.firstSeen.venue && <div className="text-[11px] text-muted truncate mt-1">{song.firstSeen.venue}</div>}
          </Card>
          <Card padding="sm">
            <StatFigure value={formatDate(song.lastSeen.date)} label="Last Seen" />
            {song.lastSeen.venue && <div className="text-[11px] text-muted truncate mt-1">{song.lastSeen.venue}</div>}
          </Card>
          <Card padding="sm">
            <StatFigure value={song.currentGap.shows} label="Current Gap" />
          </Card>
        </div>

        {/* Gap line — the feature */}
        <p className="text-[15px] text-secondary mt-5 leading-relaxed">
          {gapSentence(song)}
        </p>
        {song.longestGap && (
          <p className="text-xs text-muted mt-1.5">
            Longest gap: {song.longestGap.shows} show{song.longestGap.shows !== 1 ? 's' : ''}
            {' '}({humanizeGapDuration(song.longestGap.days) || `${song.longestGap.days} days`}) — {formatDate(song.longestGap.fromDate)} to {formatDate(song.longestGap.toDate)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
        <section>
          <h2 className="text-lg font-bold text-primary mb-4">Every Time You've Seen It</h2>
          <div className="space-y-2.5">
            {song.performances.map((perf, i) => (
              <SongPerformanceRow key={`${perf.showId}-${i}`} perf={perf} onOpen={goToShow} />
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <Card padding="md">
            <h3 className="text-[13px] font-bold text-primary mb-3 uppercase tracking-wide">Performances By Year</h3>
            <PerformancesByYear performances={song.performances} />
          </Card>

          {breakdown && (
            <Card padding="md">
              <h3 className="text-[13px] font-bold text-primary mb-2 uppercase tracking-wide">Where It Lands</h3>
              <p className="text-sm text-secondary">{breakdown}</p>
            </Card>
          )}

          {bestVersions.length > 0 && (
            <Card padding="md">
              <h3 className="text-[13px] font-bold text-primary mb-3 uppercase tracking-wide">Your Best Versions</h3>
              <ul className="space-y-1">
                {bestVersions.map((p, i) => (
                  <li key={`${p.showId}-${i}`}>
                    <button
                      type="button"
                      onClick={() => goToShow(p.showId)}
                      className="w-full flex items-center justify-between gap-2 px-1 py-1.5 rounded-lg hover:bg-hover hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 text-left"
                    >
                      <span className="text-sm text-primary truncate">{formatDate(p.date)} · {p.venue}</span>
                      <span className="text-sm font-bold text-amber flex-shrink-0">{p.rating}/10</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
