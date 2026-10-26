'use client';

// A band, at /bands/?band=<slug>, and one of its songs, at
// /bands/?band=<slug>&song=<songSlug> (lib/showRouting.js bandHref and
// bandSongHref). A real pre-rendered route reading the query string, like
// /shows/?show=<id>; see CLAUDE.md's routing section. Not /artist/<slug>/:
// on the web that is the public band page, a Netlify Function with nothing
// in out/ or the iOS bundle.
//
// An unknown band goes to Top Artists; a song of a band without song pages
// goes to the band. lib/navRoutes.js declares `song` as the detail param,
// so the mobile back control on a song returns to its band.

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { configBandBySlug } from '@/lib/bandScreens';
import { bandHref } from '@/lib/showRouting';
import BandScreen from '@/components/bands/BandScreen';
import BandSongScreen from '@/components/bands/BandSongScreen';

export default function BandsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = (searchParams.get('band') || '').toLowerCase().trim();
  const songSlug = (searchParams.get('song') || '').toLowerCase().trim();
  const band = configBandBySlug(slug);
  const songOk = !songSlug || !!band?.songPages;

  useEffect(() => {
    if (!band) router.replace('/stats/top-artists/');
    else if (!songOk) router.replace(bandHref(band.slug));
  }, [band, songOk, router]);

  if (!band || !songOk) return null;
  // Keyed so moving between songs, or a song and its band, starts fresh.
  return songSlug
    ? <BandSongScreen key={`${slug}/${songSlug}`} band={band} songSlug={songSlug} />
    : <BandScreen key={slug} band={band} />;
}
