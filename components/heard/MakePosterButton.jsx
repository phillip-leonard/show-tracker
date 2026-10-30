'use client';

// components/heard/MakePosterButton.jsx
//
// "Make my poster" for one band, wherever a band appears (My Shows by
// artist, Stats → Top Artists, a band screen):
//
//   an archive-backed band   the Songs I've heard tool, on the poster made
//                            from every show the user has logged for it
//                            (lib/heardLinks.js). A web page, so on iOS it
//                            opens in the system browser (externalLinkClick).
//   any other band           /my-poster/?artist=<name>, the user's own
//                            record and poster from their shows and
//                            setlists (lib/myPoster.js), an app screen on
//                            the web and in the iOS app alike. Hidden until
//                            the band has MIN_SHOWS_WITH_SETLIST shows with
//                            a setlist.
//
// Renders nothing for someone signed out.

import { useMemo } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { heardBandFor, heardHref } from '@/lib/heardLinks';
import { canMakeMyPoster } from '@/lib/myPoster';
import { myPosterHref } from '@/lib/showRouting';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { externalLinkClick } from '@/lib/publicProfile';

const CLASSES = 'inline-flex items-center gap-1.5 min-h-touch md:fine:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border border-subtle text-secondary hover:text-amber hover:border-amber/50 transition-colors';

export default function MakePosterButton({ artist, className = '' }) {
  const { user, guestMode, shows } = useApp();
  const band = heardBandFor(artist);
  const href = useMemo(() => {
    if (!band) return canMakeMyPoster(shows, artist) ? myPosterHref(artist) : '';
    const mine = shows
      .filter((s) => artistNameKeyLoose(s.artist) === band.key && /^\d{4}-\d{2}-\d{2}$/.test(s.date || ''))
      .map((s) => ({ date: s.date, venue: s.venue || '' }));
    return heardHref(band.slug, mine);
  }, [band, shows, artist]);
  if (!user || guestMode || !href) return null;

  const label = `Make my ${band ? band.name : String(artist).trim()} poster`;
  const content = (
    <>
      <Sparkles className="w-4 h-4" />
      Make my poster
    </>
  );

  if (!band) {
    return (
      <Link href={href} onClick={(e) => e.stopPropagation()} aria-label={label} className={`${CLASSES} ${className}`}>
        {content}
      </Link>
    );
  }

  const onClick = (e) => {
    e.stopPropagation();
    externalLinkClick(e, href);
  };
  return (
    <a href={href} onClick={onClick} aria-label={label} className={`${CLASSES} ${className}`}>
      {content}
    </a>
  );
}
