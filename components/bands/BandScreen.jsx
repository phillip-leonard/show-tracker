'use client';

// components/bands/BandScreen.jsx
//
// A band, at /bands/?band=<slug>: the public band page's stats (from
// /api/artist, lib/bandScreens.js) with the user's own beside them: their
// shows, the songs they've heard and how often, and which of the band's
// overdue songs, bust-outs and recent shows they were there for.

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Card, StatFigure } from '@/components/ui';
import FollowBandButton from '@/components/artists/FollowBandButton';
import MakePosterButton from '@/components/heard/MakePosterButton';
import { useBandData, useBandPersonal } from '@/hooks/useBandScreens';
import { songSlugIndex, songSlugFor } from '@/lib/bandScreens';
import { bandSongHref } from '@/lib/showRouting';
import { songSlugFromTitle, artistSlugFromName } from '@/lib/songIndex';
import { formatDate } from '@/lib/utils';
import {
  BandLoadState, HeardBadge, ThereBadge, SongName, CoverTag, Section, RowList, Row, SourceCredit, venueLine,
} from '@/components/bands/BandParts';

const MOST_HEARD = 10;

function YouAndBand({ band, personal, songSlugForTitle }) {
  const { user, guestMode } = useApp();
  if (!user && !guestMode) return null;
  if (!personal.shows.length) {
    return (
      <Card padding="md" className="mb-8">
        <h2 className="text-lg font-bold text-primary mb-1">You and {band.name}</h2>
        <p className="text-sm text-secondary">You haven&apos;t logged a {band.name} show yet. Add one and your songs, gaps and shows appear here.</p>
      </Card>
    );
  }
  const top = personal.songs.slice(0, MOST_HEARD);
  // A heard song links to the band's song screen when there is one, else
  // to the user's own song page.
  const hrefFor = (entry) => {
    const slug = songSlugForTitle(entry.title);
    if (slug) return bandSongHref(band.slug, slug);
    return `/songs/?artist=${artistSlugFromName(personal.artistName)}&song=${songSlugFromTitle(entry.title)}`;
  };
  return (
    <Card padding="md" className="mb-8">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-lg font-bold text-primary">You and {band.name}</h2>
        <MakePosterButton artist={band.name} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card padding="sm"><StatFigure value={personal.shows.length} label="Your shows" /></Card>
        <Card padding="sm"><StatFigure value={personal.songs.length} label="Songs heard" /></Card>
        <Card padding="sm"><StatFigure value={formatDate(personal.shows[personal.shows.length - 1].date)} label="Your first" /></Card>
        <Card padding="sm"><StatFigure value={formatDate(personal.shows[0].date)} label="Your last" /></Card>
      </div>
      {top.length > 0 && (
        <>
          <h3 className="text-[13px] font-bold text-primary mb-2 uppercase tracking-wide">Your most heard</h3>
          <ol className="space-y-1">
            {top.map((entry, i) => (
              <li key={entry.key}>
                <Link
                  href={hrefFor(entry)}
                  className="flex items-center justify-between gap-3 px-1 py-2 min-h-[44px] rounded-lg hover:bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span className="text-sm text-primary truncate"><span className="text-muted mr-2">{i + 1}</span>{entry.title}</span>
                  <span className="text-sm font-bold text-brand flex-shrink-0">{entry.timesSeen}×</span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

function GapList({ title, note, list, band, songPages, personal }) {
  if (!list?.length) return null;
  return (
    <Section title={title} note={note}>
      <RowList>
        {list.map((s) => {
          const mine = personal?.songFor(s.name);
          return (
            <Row key={s.slug || s.name}>
              <div className="flex-1 min-w-0">
                <SongName band={band} song={s} songPages={songPages} />
                {mine && <HeardBadge count={mine.timesSeen} className="ml-2" />}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-semibold text-primary">{s.currentGap.toLocaleString()} shows</div>
                <div className="text-[11px] text-muted">last {formatDate(s.lastPlayed)}</div>
              </div>
            </Row>
          );
        })}
      </RowList>
    </Section>
  );
}

export default function BandScreen({ band }) {
  const state = useBandData(band.slug);
  const personal = useBandPersonal(band);

  if (state.status !== 'ready') return <BandLoadState state={state} bandName={band.name} />;

  const { artist, band: stats } = state.data;
  const songPages = !!artist.songPages;
  const coverage = artist.coverage || {};
  const windowed = coverage.kind === 'window' && coverage.shows < stats.totalShows;
  const slugIndex = songSlugIndex(state.data, band);
  const songSlugForTitle = (title) => songSlugFor(slugIndex, band, title);

  const split = !!stats.overdueOriginals;
  const inWindow = coverage.kind === 'window' ? ' in these setlists' : '';
  const recently = 'in the five years up to their latest show';
  const yourShowAt = (date) => personal?.showByDate.get(date) || null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/stats/top-artists/"
        className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 py-2 -my-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4" />
        Top artists
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-amber">{artist.name}</h1>
          <FollowBandButton artist={band.name} />
        </div>
        <p className="text-sm text-secondary mt-1">
          {stats.totalShows.toLocaleString()} shows
          {stats.firstShow && stats.lastShow ? ` · ${formatDate(stats.firstShow.date)} to ${formatDate(stats.lastShow.date)}` : ''}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <Card padding="sm"><StatFigure value={stats.totalShows.toLocaleString()} label="Shows" /></Card>
          <Card padding="sm"><StatFigure value={stats.songCount.toLocaleString()} label={windowed ? 'Songs (recent)' : 'Songs'} /></Card>
          <Card padding="sm"><StatFigure value={formatDate(stats.firstShow?.date)} label="First show" /></Card>
          <Card padding="sm"><StatFigure value={formatDate(stats.lastShow?.date)} label="Last show" /></Card>
        </div>
        {windowed && (
          <p className="text-xs text-muted mt-3">
            Song stats cover the {coverage.shows.toLocaleString()} most recent setlists, {formatDate(coverage.from)} to {formatDate(coverage.to)}.
          </p>
        )}
      </div>

      {personal && <YouAndBand band={band} personal={personal} songSlugForTitle={songSlugForTitle} />}

      {stats.mostPlayed?.length > 0 && (
        <Section title={`Most played ${artist.name} songs`}>
          <RowList>
            {stats.mostPlayed.map((s, i) => {
              const mine = personal?.songFor(s.name);
              return (
                <Row key={s.slug}>
                  <span className="w-6 text-muted text-xs flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <SongName band={band} song={s} songPages={songPages} />
                    {s.isOriginal === false && <CoverTag />}
                    {mine && <HeardBadge count={mine.timesSeen} className="ml-2" />}
                  </div>
                  <span className="text-sm font-semibold text-primary flex-shrink-0">{s.timesPlayed.toLocaleString()}</span>
                </Row>
              );
            })}
          </RowList>
        </Section>
      )}

      <GapList
        title={split ? `${artist.name} songs most overdue` : `${artist.name} songs with the longest gaps`}
        note={`Originals played at least 5 times${inWindow}${split ? ` and at least once ${recently}` : ''}, by shows since they were last played.`}
        list={split ? stats.overdueOriginals : stats.originalGapLeaders}
        band={band}
        songPages={songPages}
        personal={personal}
      />
      <GapList
        title={split ? `${artist.name} covers most overdue` : `${artist.name} covers with the longest gaps`}
        note={`Covers played at least 5 times${inWindow}${split ? ` and at least once ${recently}` : ''}, by shows since ${artist.name} last played them.`}
        list={split ? stats.overdueCovers : stats.coverGapLeaders}
        band={band}
        songPages={songPages}
        personal={personal}
      />
      <GapList
        title={`${artist.name} songs not played in 5+ years`}
        note={`Originals played at least 5 times${inWindow} but not ${recently}, longest ago first.`}
        list={stats.notPlayedSince}
        band={band}
        songPages={songPages}
        personal={personal}
      />

      {stats.bustOuts?.length > 0 && (
        <Section
          title={`Biggest ${artist.name} bust-outs`}
          note={`Originals that went the most shows without being played, counted as ${artist.sourceName} counts them.`}
        >
          <RowList>
            {stats.bustOuts.map((s) => {
              const mine = personal?.songFor(s.name);
              return (
                <Row key={s.slug}>
                  <div className="flex-1 min-w-0">
                    <SongName band={band} song={s} songPages={songPages} />
                    {mine && <HeardBadge count={mine.timesSeen} className="ml-2" />}
                    <div className="text-[11px] text-muted mt-0.5">
                      {formatDate(s.gapStart?.date)} to {formatDate(s.gapEnd?.date)}
                    </div>
                    <ThereBadge show={yourShowAt(s.gapEnd?.date)} className="mt-1" />
                  </div>
                  <span className="text-sm font-semibold text-primary flex-shrink-0">{s.longestGap.toLocaleString()} shows</span>
                </Row>
              );
            })}
          </RowList>
        </Section>
      )}

      {stats.recentShows?.length > 0 && (
        <Section title={`Recent ${artist.name} shows`}>
          <RowList>
            {stats.recentShows.map((s) => (
              <Row key={`${s.date}-${s.venue}`}>
                <span className="w-24 flex-shrink-0 text-secondary">{formatDate(s.date)}</span>
                <span className="flex-1 min-w-0 text-primary truncate">{venueLine(s)}</span>
                <ThereBadge show={yourShowAt(s.date)} />
              </Row>
            ))}
          </RowList>
        </Section>
      )}

      <SourceCredit artist={artist} />
    </div>
  );
}
