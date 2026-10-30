'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Music, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
import { PageHeader, SectionHeader, Card, EmptyState, Select } from '@/components/ui';
import StatsSubNav from '@/components/stats/StatsSubNav';
import SongPerformanceRow from '@/components/songs/SongPerformanceRow';
import useSongIndex from '@/hooks/useSongIndex';
import { songSlugFromTitle } from '@/lib/songIndex';
import { useApp } from '@/context/AppContext';
import { showHref } from '@/lib/showRouting';

// An `aria-controls` target needs a whitespace-free id, and a song key is
// `artistSlug:normalized title` — spaces and all.
function panelId(songKey) {
  return `song-performances-${songKey.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

// Per-artist song list — times seen + current personal gap, sortable by
// both. Deliberately not scoped to the year/all-time period the other
// Stats subpages use: a "gap" is measured against the artist's *entire*
// show history, so filtering it to one year would make the numbers wrong,
// not just narrower.
//
// Clicking a song expands it in place to list every performance of it the
// user has logged. Toggles are independent (not an accordion) — comparing
// two songs' histories side by side is the obvious next thing to do here,
// and nothing about the list makes several open panels awkward. The rows
// come straight out of the already-memoized song index, so expanding reads
// state that is loaded regardless and never touches Firestore.
export default function StatsSongsPage() {
  const router = useRouter();
  const { shows, setSelectedShow } = useApp();
  const songIndex = useSongIndex();
  const [artistSlug, setArtistSlug] = useState('');
  const [sortKey, setSortKey] = useState('timesSeen'); // 'timesSeen' | 'gap'
  const [sortDir, setSortDir] = useState('desc');
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());

  const artists = useMemo(() => {
    const map = new Map();
    Object.values(songIndex).forEach((song) => {
      if (!map.has(song.artistSlug)) {
        map.set(song.artistSlug, { artistSlug: song.artistSlug, artistName: song.artistName, songCount: 0 });
      }
      map.get(song.artistSlug).songCount += 1;
    });
    return [...map.values()].sort((a, b) => a.artistName.localeCompare(b.artistName));
  }, [songIndex]);

  const effectiveArtistSlug = artistSlug || artists[0]?.artistSlug || '';
  const selectedArtist = artists.find((a) => a.artistSlug === effectiveArtistSlug);

  const songs = useMemo(() => {
    return Object.values(songIndex)
      .filter((s) => s.artistSlug === effectiveArtistSlug)
      .sort((a, b) => {
        const av = sortKey === 'timesSeen' ? a.timesSeen : a.currentGap.shows;
        const bv = sortKey === 'timesSeen' ? b.timesSeen : b.currentGap.shows;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [songIndex, effectiveArtistSlug, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleExpanded = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Navigate to the show detail page via query param
  const goToShow = (showId) => {
    router.push(showHref(showId));
  };

  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <>
      <PageHeader eyebrow="Stats" title="Songs" />

      <StatsSubNav active="songs" />

      {artists.length === 0 ? (
        <EmptyState icon={Music} title="No songs tracked yet" body="Log some shows with setlists to see your song stats." />
      ) : (
        <>
          <div className="mb-6 max-w-xs">
            <Select
              label="Artist"
              value={effectiveArtistSlug}
              onChange={(e) => setArtistSlug(e.target.value)}
              options={artists.map((a) => ({ value: a.artistSlug, label: `${a.artistName} (${a.songCount})` }))}
            />
          </div>

          <Card padding="lg">
            <SectionHeader title={`Songs — ${selectedArtist?.artistName || ''}`} />

            <div className="flex items-center gap-3 sm:gap-4 pb-2.5 mb-1 border-b border-subtle text-[11px] font-extrabold uppercase tracking-wide text-muted">
              <span className="w-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0">Song</span>
              <button
                type="button"
                onClick={() => toggleSort('timesSeen')}
                className="flex items-center gap-1 whitespace-nowrap hover:text-primary transition-colors w-16 sm:w-24 flex-shrink-0 justify-end text-right min-h-touch md:fine:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
              >
                Times Seen {sortKey === 'timesSeen' && <SortIcon className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => toggleSort('gap')}
                className="flex items-center gap-1 whitespace-nowrap hover:text-primary transition-colors w-16 sm:w-24 flex-shrink-0 justify-end min-h-touch md:fine:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
              >
                Gap {sortKey === 'gap' && <SortIcon className="w-3 h-3" />}
              </button>
            </div>

            <ul className="list-none p-0 m-0">
              {songs.map((song) => {
                const expanded = expandedKeys.has(song.key);
                const id = panelId(song.key);
                return (
                  <li key={song.key} className="border-b border-subtle last:border-0">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(song.key)}
                      aria-expanded={expanded}
                      aria-controls={id}
                      className="w-full flex items-center gap-3 sm:gap-4 py-3 min-h-[44px] -mx-2 px-2 rounded-lg text-left hover:bg-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <ChevronDown
                        className={`w-4 h-4 flex-shrink-0 text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="flex-1 min-w-0 text-[15px] font-medium text-primary truncate">{song.title}</span>
                      <span className="w-16 sm:w-24 flex-shrink-0 text-right font-mono font-bold text-primary">{song.timesSeen}</span>
                      <span className="w-16 sm:w-24 flex-shrink-0 text-right font-mono font-bold text-primary">{song.currentGap.shows}</span>
                    </button>

                    {expanded && (
                      <div id={id} className="pb-3 pl-8 pr-1">
                        {song.performances.length === 0 ? (
                          <p className="text-xs text-secondary py-2">
                            You haven&apos;t logged a show with this song yet.
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                                Every time you&apos;ve seen it
                              </span>
                              <Link
                                href={`/songs/?artist=${song.artistSlug}&song=${songSlugFromTitle(song.title)}`}
                                className="text-[11px] font-semibold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                              >
                                Song page →
                              </Link>
                            </div>
                            <ul className="list-none p-0 m-0 divide-y divide-subtle">
                              {song.performances.map((perf, i) => (
                                <li key={`${perf.showId}-${i}`}>
                                  <SongPerformanceRow perf={perf} onOpen={goToShow} compact />
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
