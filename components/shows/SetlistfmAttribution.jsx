'use client';

// The setlist.fm credit its API terms require wherever its data is shown.
// See lib/setlistfmAttribution.js for where the url comes from.
//
//   <SetlistfmAttribution show={show} />   one show's setlist:
//                                          "Source: Phish setlist on setlist.fm"
//   <SetlistfmCredit />                    a view built from many setlists
//                                          (tours, festival lineups):
//                                          "Setlist data from setlist.fm"
//   <SetlistfmCreditFor shows={shows} />   the same, for a view built from
//                                          the user's own shows (stats, song
//                                          history), and only when at least
//                                          one of them came from setlist.fm
//
// Both links are followable on purpose: the terms forbid rel="nofollow" or
// anything else that discourages search engines from following them.

import React from 'react';
import { useSetlistfmLink, isSetlistfmShow, SETLISTFM_HOME } from '@/lib/setlistfmAttribution';

const LINK_CLASS = 'text-muted underline decoration-dotted hover:text-brand transition-colors';

export default function SetlistfmAttribution({ show, className = 'mt-3 text-[11px] text-muted' }) {
  const { enabled, url, band } = useSetlistfmLink(show);
  if (!enabled) return null;
  return (
    <p className={className}>
      Source:{' '}
      <a href={url} target="_blank" rel="noopener" className={LINK_CLASS}>
        {band ? `${band} setlist on setlist.fm` : 'setlist on setlist.fm'}
      </a>
    </p>
  );
}

// For a caller already holding setlist.fm's response. With `band` and the
// setlist's own `url` (a search result), it reads like the per-show line;
// without them, a general credit to setlist.fm's home page.
export function SetlistfmCredit({ url, band, label = 'Setlist data from setlist.fm', className = 'mt-3 text-[11px] text-muted' }) {
  const href = typeof url === 'string' && /^https:\/\/(www\.)?setlist\.fm\//.test(url) ? url : SETLISTFM_HOME;
  if (band) {
    return (
      <p className={className}>
        Source:{' '}
        <a href={href} target="_blank" rel="noopener" className={LINK_CLASS}>{band} setlist on setlist.fm</a>
      </p>
    );
  }
  return (
    <p className={className}>
      <a href={href} target="_blank" rel="noopener" className={LINK_CLASS}>{label}</a>
    </p>
  );
}

export function SetlistfmCreditFor({ shows, ...props }) {
  if (!Array.isArray(shows) || !shows.some(isSetlistfmShow)) return null;
  return <SetlistfmCredit {...props} />;
}
