'use client';

// components/bands/BandSongScreen.jsx
//
// One song of a band, at /bands/?band=<slug>&song=<songSlug>: the public
// song page's stats (from /api/artist-song) and the user's own beside them,
// from the same song index entry Stats → Songs and /songs/ read
// (lib/songIndex.js), so "heard 7×" and "your gap" agree everywhere.

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Card, StatFigure } from '@/components/ui';
import SongPerformanceRow from '@/components/songs/SongPerformanceRow';
import { useBandSongData, useBandPersonal } from '@/hooks/useBandScreens';
import { bandHref, showHref } from '@/lib/showRouting';
import { externalLinkClick } from '@/lib/publicProfile';
import { formatDate } from '@/lib/utils';
import { BandLoadState, ThereBadge, Section, RowList, Row, SourceCredit, venueLine } from '@/components/bands/BandParts';

const times = (n) => `${n.toLocaleString()} time${n === 1 ? '' : 's'}`;

function songKind(song) {
  if (song.isOriginal === true) return 'Original';
  if (song.isOriginal !== false) return null;
  return song.originalArtist ? `Cover (${song.originalArtist})` : 'Cover';
}

function YourStats({ song, mine, bandName, hasShows }) {
  const router = useRouter();
  if (!mine) {
    return (
      <Card padding="md" className="mb-8">
        <h2 className="text-lg font-bold text-primary mb-1">Your stats</h2>
        <p className="text-sm text-secondary">
          {hasShows
            ? `You haven't heard ${song.name} at any of your ${bandName} shows yet.`
            : `You haven't logged a ${bandName} show yet.`}
        </p>
      </Card>
    );
  }
  const gap = mine.currentGap.shows;
  return (
    <Card padding="md" className="mb-8">
      <h2 className="text-lg font-bold text-primary mb-4">Your stats</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card padding="sm"><StatFigure value={mine.timesSeen} label="Times heard" /></Card>
        <Card padding="sm">
          <StatFigure value={formatDate(mine.firstSeen.date)} label="First heard" />
          {mine.firstSeen.venue && <div className="text-[11px] text-muted truncate mt-1">{mine.firstSeen.venue}</div>}
        </Card>
        <Card padding="sm">
          <StatFigure value={formatDate(mine.lastSeen.date)} label="Last heard" />
          {mine.lastSeen.venue && <div className="text-[11px] text-muted truncate mt-1">{mine.lastSeen.venue}</div>}
        </Card>
        <Card padding="sm"><StatFigure value={gap} label="Your gap (shows)" /></Card>
      </div>
      <p className="text-[15px] text-secondary mt-4">
        {gap === 0
          ? `You heard it at your most recent ${bandName} show.`
          : `${gap} of your ${bandName} show${gap === 1 ? '' : 's'} since you last heard it.`}
      </p>
      <h3 className="text-[13px] font-bold text-primary mt-5 mb-2 uppercase tracking-wide">Your shows with {song.name}</h3>
      <div className="space-y-1">
        {mine.performances.map((perf, i) => (
          <SongPerformanceRow key={`${perf.showId}-${i}`} perf={perf} compact onOpen={(id) => router.push(showHref(id))} />
        ))}
      </div>
    </Card>
  );
}

export default function BandSongScreen({ band, songSlug }) {
  const { user, guestMode } = useApp();
  const state = useBandSongData(band.slug, songSlug);
  const personal = useBandPersonal(band);

  if (state.status !== 'ready') return <BandLoadState state={state} bandName={band.name} />;

  const { artist, song } = state.data;
  const mine = personal?.songFor(song.name) || null;
  const signedIn = !!user || guestMode;
  const kind = songKind(song);
  const yourShowAt = (date) => personal?.showByDate.get(date) || null;
  const isPhish = artist.source === 'phishnet';

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href={bandHref(band.slug)}
        className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 py-2 -my-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4" />
        {artist.name}
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">
        <Link href={bandHref(band.slug)} className="text-sm text-amber font-semibold hover:underline">{artist.name}</Link>
        <h1 className="text-2xl font-bold text-primary mt-0.5">{song.name}</h1>
        <p className="text-[15px] text-secondary mt-1">
          Played {times(song.timesPlayed)}
          {signedIn && ` · you've heard it ${mine ? times(mine.timesSeen) : '0 times'}`}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
          <Card padding="sm"><StatFigure value={song.timesPlayed.toLocaleString()} label="Times played" /></Card>
          <Card padding="sm">
            <StatFigure value={formatDate(song.firstPlayed?.date)} label="First played" />
            {song.firstPlayed?.venue && <div className="text-[11px] text-muted truncate mt-1">{song.firstPlayed.venue}</div>}
          </Card>
          <Card padding="sm">
            <StatFigure value={formatDate(song.lastPlayed?.date)} label="Last played" />
            {song.lastPlayed?.venue && <div className="text-[11px] text-muted truncate mt-1">{song.lastPlayed.venue}</div>}
          </Card>
          <Card padding="sm"><StatFigure value={song.currentGap.toLocaleString()} label="Shows since played" /></Card>
          <Card padding="sm"><StatFigure value={song.longestGap == null ? '–' : song.longestGap.toLocaleString()} label="Longest gap (shows)" /></Card>
          {kind && <Card padding="sm"><StatFigure value={kind} label="Song" /></Card>}
        </div>
        {song.gapStart && song.gapEnd && (
          <p className="text-xs text-muted mt-3">
            Longest gap ever: {song.longestGap.toLocaleString()} shows, {formatDate(song.gapStart.date)} to {formatDate(song.gapEnd.date)}.
          </p>
        )}
      </div>

      {signedIn && <YourStats song={song} mine={mine} bandName={artist.name} hasShows={!!personal?.shows.length} />}

      {song.recentPerformances?.length > 0 && (
        <Section title="Recent performances">
          <RowList>
            {song.recentPerformances.map((s) => (
              <Row key={`${s.date}-${s.venue}`}>
                <span className="w-24 flex-shrink-0 text-secondary">{formatDate(s.date)}</span>
                <span className="flex-1 min-w-0 text-primary truncate">{venueLine(s)}</span>
                <ThereBadge show={yourShowAt(s.date)} />
              </Row>
            ))}
          </RowList>
        </Section>
      )}

      <SourceCredit
        artist={artist}
        extra={song.sourceUrl ? (
          <>
            {song.name} on {isPhish ? 'Phish.net' : artist.sourceName}:{' '}
            <a
              href={song.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => externalLinkClick(e, song.sourceUrl)}
              className="text-brand hover:underline"
            >
              every performance
            </a>
            .{' '}
          </>
        ) : null}
      />
    </div>
  );
}
