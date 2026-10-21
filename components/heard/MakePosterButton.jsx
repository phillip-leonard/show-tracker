'use client';

// components/heard/MakePosterButton.jsx
//
// "Make my poster" for one band, wherever a band appears (My Shows by
// artist, Stats → Top Artists): opens the Songs I've heard tool on the
// poster made from every show the user has logged for that band
// (lib/heardLinks.js). Renders nothing for a band the tool doesn't cover,
// or for someone signed out. The tool is a web page, so on iOS it opens in
// the system browser (externalLinkClick).

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { heardBandFor, heardHref } from '@/lib/heardLinks';
import { artistNameKeyLoose } from '@/lib/setlistSources';
import { externalLinkClick } from '@/lib/publicProfile';

export default function MakePosterButton({ artist, className = '' }) {
  const { user, guestMode, shows } = useApp();
  const band = heardBandFor(artist);
  const href = useMemo(() => {
    if (!band) return '';
    const mine = shows
      .filter((s) => artistNameKeyLoose(s.artist) === band.key && /^\d{4}-\d{2}-\d{2}$/.test(s.date || ''))
      .map((s) => ({ date: s.date, venue: s.venue || '' }));
    return heardHref(band.slug, mine);
  }, [band, shows]);
  if (!user || guestMode || !band) return null;

  const onClick = (e) => {
    e.stopPropagation();
    externalLinkClick(e, href);
  };
  const label = `Make my ${band.name} poster`;

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 min-h-touch md:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border border-subtle text-secondary hover:text-amber hover:border-amber/50 transition-colors ${className}`}
    >
      <Sparkles className="w-4 h-4" />
      Make my poster
    </a>
  );
}
