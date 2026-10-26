'use client';

// components/bands/BandParts.jsx
//
// Pieces the band screen and the song screen share: the loading and error
// states, the "heard N×" and "You were there" marks, a song name that links
// to its song screen, and the source credit.

import React from 'react';
import Link from 'next/link';
import { AlertCircle, Clock, Ear, Ticket } from 'lucide-react';
import { Button, EmptyState, SpinnerBlock } from '@/components/ui';
import { bandSongHref, showHref } from '@/lib/showRouting';
import { externalLinkClick } from '@/lib/publicProfile';
import { formatDate } from '@/lib/utils';

/** Loading, or why the data isn't here, with a retry where one can help. */
export function BandLoadState({ state, bandName }) {
  if (state.status !== 'error') return <SpinnerBlock label={`Loading ${bandName} stats…`} className="py-24" />;
  const kind = state.error?.kind;
  if (kind === 'unavailable') {
    return (
      <EmptyState
        icon={Clock}
        title={`${bandName} stats are temporarily unavailable`}
        body="Phish.net's terms let us show its data for 24 hours after we fetch it. It will be back after the next update."
        action={<Button variant="secondary" onClick={state.retry}>Try again</Button>}
      />
    );
  }
  if (kind === 'not_found') {
    return (
      <EmptyState
        icon={AlertCircle}
        title={`No ${bandName} stats here`}
        body="We don't have stats for this yet."
      />
    );
  }
  return (
    <EmptyState
      icon={AlertCircle}
      title={`Couldn't load ${bandName} stats. Try again`}
      body="Check your connection, then try again."
      action={<Button onClick={state.retry}>Try again</Button>}
    />
  );
}

/** "heard 7×", for a song the user has heard. */
export function HeardBadge({ count, className = '' }) {
  if (!count) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-brand-subtle text-brand whitespace-nowrap ${className}`}
      title={`You've heard it ${count} time${count === 1 ? '' : 's'}`}
    >
      <Ear className="w-3 h-3" aria-hidden="true" />
      heard {count}×
    </span>
  );
}

/** "You were there", linking to the user's own show that night. */
export function ThereBadge({ show, className = '' }) {
  if (!show) return null;
  return (
    <Link
      href={showHref(show.id)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-subtle text-[#a0680f] whitespace-nowrap hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
    >
      <Ticket className="w-3 h-3" aria-hidden="true" />
      You were there
    </Link>
  );
}

/** A song name, linking to its song screen when the band has song pages. */
export function SongName({ band, song, songPages }) {
  if (!songPages || !song.slug) return <span className="text-primary">{song.name}</span>;
  return (
    <Link
      href={bandSongHref(band.slug, song.slug)}
      className="text-primary hover:text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
    >
      {song.name}
    </Link>
  );
}

export function CoverTag() {
  return <span className="ml-1.5 px-1.5 rounded-full border border-subtle text-[10px] text-muted align-[1px]">Cover</span>;
}

export function Section({ title, note, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-primary mb-1">{title}</h2>
      {note && <p className="text-xs text-muted mb-3">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

/** A plain list of rows in one card. */
export function RowList({ children }) {
  return <ul className="bg-surface border border-subtle rounded-2xl divide-y divide-subtle overflow-hidden">{children}</ul>;
}

export function Row({ children, className = '' }) {
  return <li className={`flex items-center gap-3 px-4 py-3 min-h-[44px] text-sm ${className}`}>{children}</li>;
}

/** Where the data comes from, as the public pages credit it. */
export function SourceCredit({ artist, extra }) {
  const a = artist?.attribution;
  if (!a) return null;
  const host = a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return (
    <p className="text-xs text-muted mt-8">
      {extra}
      {a.text}:{' '}
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => externalLinkClick(e, a.url)}
        className="text-brand hover:underline"
      >
        {host}
      </a>
      {artist.fetchedAt ? `. Updated ${formatDate(artist.fetchedAt.slice(0, 10))}.` : '.'}
    </p>
  );
}

export function venueLine(show) {
  if (!show) return '';
  return [show.venue, show.city].filter(Boolean).join(', ');
}
