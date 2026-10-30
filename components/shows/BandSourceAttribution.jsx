'use client';

// The credit for a setlist that came from a band source (the Internet
// Archive, a Songfish site, Phish.net): the show's own page on that source.
// setlist.fm's credit is SetlistfmAttribution; a show gets one or the other.
//
// Rendered off the stored `setlistSource` rather than by sniffing for
// band-source fields, and only when the show has songs to credit. The
// Archive holds many tapes of a night, so its line names the one the
// setlist was read from, and says what a tape setlist is: what one fan
// recording captured, which can be incomplete
// (docs/setlist-sources/internet-archive.md).

import React from 'react';
import { sourceLabel, sourceHomeUrl } from '@/lib/setlistSources';

const LINK_CLASS = 'text-muted underline decoration-dotted hover:text-brand transition-colors';

export function bandSourceHref(show) {
  if (show.sourcePermalink) return show.sourcePermalink;
  // Shows saved before the permalink was stored still have the item id.
  if (show.setlistSource === 'archive' && show.sourceShowId) {
    return `https://archive.org/details/${encodeURIComponent(show.sourceShowId)}`;
  }
  return sourceHomeUrl(show.setlistSource);
}

export default function BandSourceAttribution({ show, className = 'mt-3 text-[11px] text-muted' }) {
  if (!show?.setlistSource || show.setlistSource === 'setlistfm') return null;
  if (!Array.isArray(show.setlist) || show.setlist.length === 0) return null;
  if (show.setlistSource === 'archive') {
    return (
      <p className={className}>
        Setlist from a tape on{' '}
        <a href={bandSourceHref(show)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          the {sourceLabel(show.setlistSource)}
        </a>
        {show.sourceShowId ? `, recording ${show.sourceShowId}` : ''}. Tape setlists can be incomplete.
      </p>
    );
  }
  return (
    <p className={className}>
      Setlist via{' '}
      <a href={bandSourceHref(show)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {sourceLabel(show.setlistSource)}
      </a>
    </p>
  );
}
