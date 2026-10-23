// components/shows/SetlistView.jsx
//
// Setlist renderer. Takes sets[] where each set has a label + tracks[]. Tracks
// can be flagged `debut` to render a pill alongside the title.
//
// Example:
//   <SetlistView sets={[
//     { label: 'Set I', tracks: [
//       { title: 'Frankenstein', duration: '8:14' },
//       { title: 'Foam', duration: '9:03', debut: true },
//     ]},
//     { label: 'Encore', tracks: [{ title: 'Tweezer Reprise', duration: '6:55' }] },
//   ]} />

import React, { useState } from 'react';
import Link from 'next/link';

// Props:
//   sets           – array of { label, tracks[] }
//   showPlayCounts – boolean, display "Seen Nx" pill next to each song
//   playCounts     – { [songTitle]: count } map
//   onSongClick    – (title) => void, called when song title is clicked
//   getSongHref    – (title) => string | null, when provided the song title
//                    (and its "Seen Nx" pill) render as a link to that href
//                    instead of calling onSongClick — used to link straight
//                    to a song's own page rather than opening a modal.
//
// ── Band-source fields (El Goose, Phish.net) ──────────────────────────
//
// A track from a band source can additionally carry:
//
//   transitionMark – the literal mark the archive recorded ('>' or '->'),
//                    rendered in place of the generic "> segue" line.
//   footnote       – per-song prose (teases, guests, "first since…").
//   jamchart       – flagged in the source's jam charts.
//   jamchartNote   – why it was flagged.
//
// All optional and all absent on setlist.fm-sourced shows, which still get
// the generic segue indicator off `tape` exactly as before.
//
// Footnotes and jam-chart notes expand on TAP. Deliberately not hover-only:
// on a phone there is no hover, and these notes are most of what makes a
// band source worth having. One detail row is open at a time, across the
// whole list.
export default function SetlistView({ sets = [], showPlayCounts = false, playCounts = {}, onSongClick, getSongHref }) {
  const [expandedKey, setExpandedKey] = useState(null);
  return (
    <div>
      {sets.map((set, si) => (
        <section key={si} className="mb-2">
          <div className="flex items-center gap-3 mt-6 mb-3 first:mt-0">
            <hr className="flex-1 border-t border-subtle m-0" />
            <span className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted">
              {set.label}
            </span>
            <hr className="flex-1 border-t border-subtle m-0" />
          </div>
          <ol className="list-none p-0 m-0">
            {set.tracks.map((t, ti) => {
              const trackKey = `${si}-${ti}`;
              // Two things can expand on one row, so the key names which —
              // one open at a time, across the whole list.
              const footnoteOpen = expandedKey === `${trackKey}:footnote`;
              const jamchartOpen = expandedKey === `${trackKey}:jamchart`;
              const toggle = (key) => setExpandedKey(expandedKey === key ? null : key);
              return (
              <React.Fragment key={ti}>
                <li className="grid grid-cols-[28px_1fr_auto] gap-3 items-center px-2.5 py-2 rounded-lg hover:bg-hover cursor-pointer transition-colors">
                  <span className="font-mono text-xs text-muted font-bold text-right">
                    {String(ti + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[15px] font-medium text-primary leading-snug">
                    {getSongHref?.(t.title) ? (
                      <Link
                        href={getSongHref(t.title)}
                        className="hover:text-brand hover:underline transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      <button
                        onClick={() => onSongClick?.(t.title)}
                        className="hover:text-brand hover:underline transition-colors text-left"
                      >
                        {t.title}
                      </button>
                    )}
                    {t.cover && (
                      <span className="ml-2 inline-block text-[9px] font-extrabold tracking-[0.1em] uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                        {t.cover} cover
                      </span>
                    )}
                    {t.debut && (
                      <span className="ml-2 inline-block text-[9px] font-extrabold tracking-[0.1em] uppercase text-brand bg-brand-subtle px-1.5 py-0.5 rounded">
                        debut
                      </span>
                    )}
                    {t.jamchart && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(`${trackKey}:jamchart`); }}
                        title={t.jamchartNote || 'Jam chart'}
                        aria-expanded={jamchartOpen}
                        className="ml-2 inline-flex items-center gap-1 text-[9px] font-extrabold tracking-[0.1em] uppercase text-accent bg-accent/10 px-1.5 py-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        jam chart
                      </button>
                    )}
                    {t.footnote && (
                      // A deliberately quiet marker — a footnote is on a
                      // large share of a Goose or Phish setlist's rows, and
                      // a full badge on each would drown the titles. The
                      // hit area is padded out to stay tappable on a phone
                      // even though the glyph is small.
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(`${trackKey}:footnote`); }}
                        title={t.footnote}
                        aria-label={footnoteOpen ? 'Hide note' : 'Show note'}
                        aria-expanded={footnoteOpen}
                        className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded text-[11px] font-bold align-middle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                          footnoteOpen ? 'bg-brand-subtle text-brand' : 'text-muted hover:bg-hover hover:text-secondary'
                        }`}
                      >
                        †
                      </button>
                    )}
                    {t.manual && (
                      <span className="ml-2 inline-block text-[9px] font-extrabold tracking-[0.1em] uppercase text-secondary bg-hover px-1.5 py-0.5 rounded">
                        added by you
                      </span>
                    )}
                    {t.notInSource && !t.manual && (
                      // A song the user rated or commented on that the
                      // band's archive doesn't list. Kept so the rating
                      // isn't lost (lib/bandSetlistMerge.js); marked so it
                      // isn't mistaken for the archive's own.
                      <span
                        title="Your rating is kept, but the setlist source doesn't list this song"
                        className="ml-2 inline-block text-[9px] font-extrabold tracking-[0.1em] uppercase text-amber bg-amber-subtle px-1.5 py-0.5 rounded"
                      >
                        not in source
                      </span>
                    )}
                    {showPlayCounts && playCounts[t.title] > 0 && (
                      getSongHref?.(t.title) ? (
                        <Link
                          href={getSongHref(t.title)}
                          className="ml-2 inline-block text-[10px] font-bold text-success hover:text-success/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                        >
                          Seen {playCounts[t.title]}×
                        </Link>
                      ) : (
                        <button
                          onClick={() => onSongClick?.(t.title)}
                          className="relative tap-area ml-2 inline-block text-[10px] font-bold text-success hover:text-success/80 transition-colors"
                        >
                          Seen {playCounts[t.title]}×
                        </button>
                      )
                    )}
                  </span>
                  {t.duration && (
                    <span className="font-mono text-[11px] text-muted font-semibold">
                      {t.duration}
                    </span>
                  )}
                </li>
                {footnoteOpen && (
                  <li className="grid grid-cols-[28px_1fr] gap-3 px-2.5 pb-2">
                    <span />
                    <p className="text-[12px] text-secondary bg-hover rounded-lg px-3 py-2">{t.footnote}</p>
                  </li>
                )}
                {jamchartOpen && (
                  <li className="grid grid-cols-[28px_1fr] gap-3 px-2.5 pb-2">
                    <span />
                    <div className="text-[12px] text-secondary bg-hover rounded-lg px-3 py-2">
                      <p className="font-medium text-primary">Jam chart</p>
                      {t.jamchartNote && <p className="mt-0.5">{t.jamchartNote}</p>}
                    </div>
                  </li>
                )}
                {t.tape && (
                  <li className="grid grid-cols-[28px_1fr] gap-3 px-2.5 py-0.5 pointer-events-none">
                    <span />
                    {/* The literal mark where a band source recorded one —
                        '>' and '->' mean different things to the people who
                        maintain these archives, so the distinction is kept
                        rather than flattened. A setlist.fm-sourced show has
                        only the boolean, and still gets "> segue". */}
                    <span className="text-[11px] text-muted font-medium tracking-wide">
                      {t.transitionMark ? t.transitionMark : '> segue'}
                    </span>
                  </li>
                )}
              </React.Fragment>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
