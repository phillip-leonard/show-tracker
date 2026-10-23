'use client';

// A single song's personal history, at /songs/?artist=<slug>&song=<slug>.
//
// This is a plain static route reading identity from the query string
// rather than a [artistId]/[songSlug] dynamic segment. With
// `output: 'export'`, a dynamic segment can only ever render the exact
// paths listed in generateStaticParams — verified directly against this
// app's existing /shows/[id] route, which 404s (both on a fresh visit and
// on an in-app Link click) for any id beyond its build-time placeholder.
// Query params carry no such restriction: the same static /songs/ page
// serves every artist/song combination, exactly like the already-working
// /shows/?artist=…&year=… drill-down used by Top Artists and Top Venues.

import { useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Music, Heart, ArrowLeft } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import useSongIndex from '@/hooks/useSongIndex';
import { songKeyFromParams } from '@/lib/songIndex';
import SongDetailView from '@/components/songs/SongDetailView';
import { SetlistfmCreditFor } from '@/components/shows/SetlistfmAttribution';
import { Button, PageHeader, EmptyState } from '@/components/ui';

export default function SongPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, guestMode, openAuthModal, shows } = useApp();
  const songIndex = useSongIndex();

  const artistSlug = searchParams.get('artist') || '';
  const songSlug = searchParams.get('song') || '';

  const song = useMemo(() => {
    const key = songKeyFromParams(artistSlug, songSlug);
    return key ? songIndex[key] || null : null;
  }, [songIndex, artistSlug, songSlug]);

  if (guestMode || !user) {
    return (
      <>
        <PageHeader eyebrow="Songs" title="Song history" />
        <EmptyState
          icon={Heart}
          tone="brand"
          title="Sign in to see your song history"
          body="Song pages are built from your own logged shows, so create a free account to see when you last caught this one live."
          action={<Button onClick={() => openAuthModal('signup')}>Create account</Button>}
        />
      </>
    );
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Music className="w-10 h-10 text-muted mb-4" />
        <p className="text-lg text-primary mb-4">Song not found.</p>
        <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex" onClick={() => router.push('/shows/')}>
          Back to shows
        </Button>
      </div>
    );
  }

  const songShowIds = new Set(song.performances.map((p) => p.showId));
  return (
    <>
      <SongDetailView song={song} />
      <SetlistfmCreditFor shows={shows.filter((s) => songShowIds.has(s.id))} className="mt-6 text-[11px] text-muted" />
    </>
  );
}
