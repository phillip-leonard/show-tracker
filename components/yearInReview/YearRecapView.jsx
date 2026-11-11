'use client';

// components/yearInReview/YearRecapView.jsx
//
// The 2026 recap: /year-in-review/?year=2026 from 2026-12-02 (see
// lib/recapLaunch.js for the gate and the admin preview). Your own review
// only; a visitor on ?user=<someone else> keeps the old shared page.
//
// Sections, in order: headline numbers, top bands, top songs, rarest catch
// and bust-outs (archive bands only, hidden when empty), show buddy (hidden
// without one), highlights, the recap card and its share link, "updated
// through", and "Missing a show? Add it".
//
// Everything is computed from the shows already in AppContext
// (lib/yearRecap.js), so a show added on New Year's Eve moves every number
// the moment it's saved. Two things load after first paint and appear only
// if they have something to say: the band archives (lib/yearRecapRarity.js)
// and the accepted friend tags (lib/yearRecapData.js).

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Music, Users, Gem, Flame, CalendarDays, MapPin, Plus, ChevronDown,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Card, StatTile, Button } from '@/components/ui';
import { Section, RowList, Row } from '@/components/bands/BandParts';
import { PosterImages, PosterShareLink } from '@/components/heard/PosterShare';
import { SetlistfmCreditFor } from '@/components/shows/SetlistfmAttribution';
import YearSelector from '@/components/yearInReview/YearSelector';
import useRunIndex from '@/hooks/useRunIndex';
import { computeYearRecap, computeShowBuddy, showsInYear } from '@/lib/yearRecap';
import { loadYearRarity, archiveBandsFor } from '@/lib/yearRecapRarity';
import { loadAcceptedTagsSent } from '@/lib/yearRecapData';
import { recapHref } from '@/lib/recapLaunch';
import { showHref } from '@/lib/showRouting';
import { formatDate } from '@/lib/utils';

const plural = (n, one, many) => `${Number(n).toLocaleString()} ${n === 1 ? one : (many || `${one}s`)}`;

/** What the card and the share link are drawn from: no ids, notes or names. */
function recapPayload(recap, rarity) {
  return {
    year: recap.year,
    shows: recap.totalShows,
    bands: recap.totalBands,
    venues: recap.totalVenues,
    songsHeard: recap.songsHeard,
    newBands: recap.newBands,
    topBands: recap.topBands,
    topSongs: recap.topSongs,
    rarest: rarity?.rarest ? { name: rarity.rarest.name, band: rarity.rarest.band, timesPlayed: rarity.rarest.timesPlayed } : null,
    bustOuts: (rarity?.bustOuts || []).map((b) => ({ name: b.name, band: b.band, gap: b.gap })),
    busiestMonth: { month: recap.highlights.busiestMonth.month, shows: recap.highlights.busiestMonth.shows },
    longestRun: recap.highlights.longestRun
      ? { artist: recap.highlights.longestRun.artist, venue: recap.highlights.longestRun.venue, nights: recap.highlights.longestRun.nights }
      : null,
    updatedThrough: recap.updatedThrough,
  };
}

function ShowLine({ show }) {
  return (
    <Link href={showHref(show.id)} className="block group">
      <span className="text-primary font-semibold group-hover:text-brand transition-colors">{show.artist}</span>
      <span className="block text-xs text-muted">{[show.venue, show.city].filter(Boolean).join(', ')} · {formatDate(show.date)}</span>
    </Link>
  );
}

function NoSetlistLine({ shows }) {
  const [open, setOpen] = useState(false);
  if (!shows.length) return null;
  return (
    <div className="mb-8 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-secondary hover:text-primary min-h-[44px] md:fine:min-h-0"
      >
        <span>
          {plural(shows.length, 'show has', 'shows have')} no setlist — <span className="text-brand font-semibold">add {shows.length === 1 ? 'it' : 'them'} for full stats</span>
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <RowList>
          {shows.map((s) => (
            <Row key={s.id}>
              <span className="w-24 flex-shrink-0 text-secondary">{formatDate(s.date)}</span>
              <span className="flex-1 min-w-0 text-primary truncate">{s.artist}{s.venue ? ` · ${s.venue}` : ''}</span>
              <Link href={showHref(s.id)} className="text-sm text-brand font-semibold flex-shrink-0">Add setlist</Link>
            </Row>
          ))}
        </RowList>
      )}
    </div>
  );
}

export default function YearRecapView({ year }) {
  const router = useRouter();
  const { shows, user, friends } = useApp();
  const addShow = () => router.push(`/search/?returnTo=${encodeURIComponent(recapHref(year))}`);
  const runIndex = useRunIndex();
  const recap = useMemo(() => computeYearRecap(shows || [], year), [shows, year]);
  const yearShows = useMemo(() => showsInYear(shows || [], year), [shows, year]);

  // Rarity: only refetched when the year's archive-band nights change.
  const archiveKey = useMemo(() => JSON.stringify(archiveBandsFor(yearShows).map((b) => [b.slug, b.shows])), [yearShows]);
  const [rarity, setRarity] = useState(null); // null while loading
  useEffect(() => {
    let live = true;
    setRarity(null);
    loadYearRarity(yearShows).then((r) => { if (live) setRarity(r); }).catch(() => { if (live) setRarity({ rarest: null, bustOuts: [] }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveKey]);

  const [acceptedTags, setAcceptedTags] = useState(null);
  useEffect(() => {
    let live = true;
    loadAcceptedTagsSent(user?.uid).then((t) => { if (live) setAcceptedTags(t); });
    return () => { live = false; };
  }, [user?.uid]);
  const buddy = useMemo(
    () => (acceptedTags ? computeShowBuddy(yearShows, acceptedTags, friends || []) : null),
    [acceptedTags, yearShows, friends],
  );

  if (!recap) {
    return (
      <div className="max-w-3xl mx-auto">
        <YearSelector year={year} className="mb-6" />
        <Card padding="lg" className="text-center">
          <h1 className="text-2xl font-extrabold text-primary mb-2">Your {year} in live music</h1>
          <p className="text-secondary mb-5">No shows logged for {year} yet. Add the ones you went to and your recap builds itself.</p>
          <Button icon={Plus} onClick={addShow}>Add a show</Button>
        </Card>
      </div>
    );
  }

  const payload = recapPayload(recap, rarity);
  const cardRequest = { recap: payload, ...(buddy ? { buddyUid: buddy.uid, buddyShows: buddy.shows } : {}) };
  const cardKey = JSON.stringify(cardRequest);
  const run = recap.highlights.longestRun;
  const hasRarity = rarity && (rarity.rarest || rarity.bustOuts.length > 0);

  return (
    <div className="max-w-3xl mx-auto">
      <YearSelector year={year} className="mb-4" />

      <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-[#1c1c36] to-[#2a2a4e] text-white p-8 md:p-12 text-center mb-6 border border-subtle">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#34D399] mb-3">Year in Review</p>
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">
          Your <span className="text-[#FB923C]">{year}</span>
        </h1>
        <h2 className="text-2xl md:text-3xl font-bold mt-1">in live music</h2>
        <p className="text-sm text-white/75 mt-4">Updated through {formatDate(recap.updatedThrough)}</p>
      </div>

      {/* 1. Headline */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4 mb-3">
        <StatTile value={recap.totalShows} label={recap.totalShows === 1 ? 'Show' : 'Shows'} tone="brand" />
        <StatTile value={recap.totalBands} label={recap.totalBands === 1 ? 'Band' : 'Bands'} tone="amber" />
        <StatTile value={recap.totalVenues} label={recap.totalVenues === 1 ? 'Venue' : 'Venues'} />
        <StatTile value={recap.songsHeard} label={recap.songsHeard === 1 ? 'Song heard' : 'Songs heard'} />
        <StatTile value={recap.newBands} label={recap.newBands === 1 ? 'New band' : 'New bands'} />
        <StatTile value={recap.newVenues} label={recap.newVenues === 1 ? 'New venue' : 'New venues'} />
      </div>
      {recap.totalCities > 1
        ? <p className="text-sm text-secondary text-center mb-4">Across {plural(recap.totalCities, 'city', 'cities')}</p>
        : <div className="mb-4" />}
      <NoSetlistLine shows={recap.noSetlist} />

      {/* 2. Top bands */}
      <Section title="Top bands">
        <RowList>
          {recap.topBands.map((b, i) => (
            <Row key={b.name}>
              <span className="w-6 text-muted text-xs flex-shrink-0">{i + 1}</span>
              <Link
                href={`/shows/?artist=${encodeURIComponent(b.name)}&year=${year}`}
                className="flex-1 min-w-0 text-primary font-semibold truncate hover:text-brand"
              >
                {b.name}
              </Link>
              <span className="text-sm text-secondary flex-shrink-0">{plural(b.shows, 'show')}</span>
            </Row>
          ))}
        </RowList>
      </Section>

      {/* 3. Top songs */}
      {recap.topSongs.length > 0 && (
        <Section title="Top songs" note="Heard at the most shows. A song played twice in one show counts once.">
          <RowList>
            {recap.topSongs.map((s, i) => (
              <Row key={s.name}>
                <span className="w-6 text-muted text-xs flex-shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-primary truncate">{s.name}</span>
                  {s.artist && <span className="block text-[11px] text-muted truncate">{s.artist}</span>}
                </span>
                <span className="text-sm font-bold text-brand flex-shrink-0">{s.count}×</span>
              </Row>
            ))}
          </RowList>
        </Section>
      )}

      {/* 4. Rarest catch and bust-outs: archive bands only, nothing when empty */}
      {hasRarity && (
        <Section title="Rare ones" note="From the full setlist archives for Goose, Phish, Umphrey's McGee and King Gizzard.">
          {rarity.rarest && (
            <Card padding="md" className="mb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-brand flex items-center gap-1.5 mb-1"><Gem className="w-3.5 h-3.5" aria-hidden="true" /> Rarest catch</p>
              <p className="text-xl font-extrabold text-primary">{rarity.rarest.name}</p>
              <p className="text-sm text-secondary">
                {rarity.rarest.band} · played {plural(rarity.rarest.timesPlayed, 'time')} ever{rarity.rarest.date ? ` · you heard it ${formatDate(rarity.rarest.date)}` : ''}
              </p>
            </Card>
          )}
          {rarity.bustOuts.length > 0 && (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-brand flex items-center gap-1.5 mt-4 mb-1"><Flame className="w-3.5 h-3.5" aria-hidden="true" /> Bust-outs witnessed</p>
              <RowList>
                {rarity.bustOuts.map((b) => (
                  <Row key={`${b.slug}-${b.name}-${b.date}`}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-primary truncate">{b.name}</span>
                      <span className="block text-[11px] text-muted truncate">{b.band} · {formatDate(b.date)}{b.venue ? ` · ${b.venue}` : ''}</span>
                    </span>
                    <span className="text-sm text-secondary flex-shrink-0">after {plural(b.gap, 'show')}</span>
                  </Row>
                ))}
              </RowList>
            </>
          )}
        </Section>
      )}

      {/* 5. Show buddy: accepted tags only, hidden without one */}
      {buddy && (
        <Section title="Show buddy">
          <Card padding="md" className="flex items-center gap-4">
            <Users className="w-8 h-8 text-brand flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-xl font-extrabold text-primary truncate">{buddy.name}</p>
              <p className="text-sm text-secondary">{plural(buddy.shows, 'show')} together in {year}</p>
            </div>
            <Link href={`/friends/?together=${encodeURIComponent(buddy.uid)}`} className="text-sm font-semibold text-brand flex-shrink-0">
              Shows together
            </Link>
          </Card>
        </Section>
      )}

      {/* 6. Highlights */}
      <Section title="Highlights">
        <div className="grid sm:grid-cols-2 gap-3">
          <Card padding="md">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2 flex items-center gap-1.5"><Music className="w-3.5 h-3.5" aria-hidden="true" /> First show of the year</p>
            <ShowLine show={recap.highlights.firstShow} />
          </Card>
          <Card padding="md">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2 flex items-center gap-1.5"><Music className="w-3.5 h-3.5" aria-hidden="true" /> Most recent show</p>
            <ShowLine show={recap.highlights.latestShow} />
          </Card>
          <Card padding="md">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> Busiest month</p>
            <p className="text-primary font-semibold">{recap.highlights.busiestMonth.name}</p>
            <p className="text-xs text-muted">{plural(recap.highlights.busiestMonth.shows, 'show')}</p>
          </Card>
          {run && (
            <Card padding="md">
              <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Longest run</p>
              {runIndex[run.key]
                ? <Link href={`/runs/?run=${encodeURIComponent(run.key)}`} className="text-primary font-semibold hover:text-brand">{run.nights} nights of {run.artist}</Link>
                : <p className="text-primary font-semibold">{run.nights} nights of {run.artist}</p>}
              <p className="text-xs text-muted">{run.venue} · {formatDate(run.start)} – {formatDate(run.end)}</p>
            </Card>
          )}
        </div>
      </Section>

      {/* The recap card */}
      <Section title="Your recap card" note="Sized for stories and the feed. Your show buddy's first name is on it only if their profile is public.">
        {rarity === null ? (
          <p className="text-sm text-muted">Getting your rare ones first…</p>
        ) : (
          <div className="space-y-5">
            <PosterImages
              request={cardRequest}
              requestKey={cardKey}
              fileBase={`my-${year}-in-live-music`}
              shareTitle={`My ${year} in live music`}
              alt={`My ${year} in live music`}
              drawLabel="Make my recap card"
              drawingLabel="Drawing your card…"
            />
            <PosterShareLink
              request={cardRequest}
              requestKey={cardKey}
              title={`My ${year} in live music: ${plural(recap.totalShows, 'show')}, ${plural(recap.totalBands, 'band')}`}
              note="A page with your recap and card. No email, notes or show list, and it isn't listed in search engines."
            />
          </div>
        )}
      </Section>

      {/* 7–8. Updated through, and the way to add what's missing */}
      <Card padding="md" className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <p className="font-semibold text-primary">Missing a show?</p>
          <p className="text-sm text-secondary">Updated through {formatDate(recap.updatedThrough)}. Add it and every number here updates.</p>
        </div>
        <Button icon={Plus} variant="secondary" onClick={addShow}>Add it</Button>
      </Card>

      <SetlistfmCreditFor shows={yearShows} className="mt-6 text-[11px] text-muted text-center" />
    </div>
  );
}
