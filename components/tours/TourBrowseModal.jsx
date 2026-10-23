// components/tours/TourBrowseModal.jsx
//
// "Add shows from a tour" — pick an artist, pick a tour, tick the nights
// you were at, add them all in one action. Entry points are the /tours
// page and a tour's own detail view (which jumps straight to step 3 for
// that tour).
//
// Three steps, artist -> tour -> shows, plus a free-text shortcut: typing
// `Goose Summer Tour 2025` in step 1 lands on step 3 when the parse is
// unambiguous, and on the picker with the fields pre-filled when it isn't.
// The parse rules live in lib/tourBrowse.js — read the comment there for
// why it refuses to guess.
//
// Data comes from netlify/functions/get-artist-tours.js (tour discovery)
// and get-tour-shows.js (one tour's nights); artist resolution reuses the
// app's existing /search-artists lookup, the same one SearchView uses.
// The write half is addShowsFromTour in context/AppContext.jsx.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, ArrowLeft, Check, AlertCircle, CalendarDays, MapPin, Music, RotateCcw,
  // Aliased: lucide exports an icon literally named `Map`, and importing it
  // unaliased shadows the global Map constructor for this whole module —
  // which crashed the month grouping below with "Map is not a constructor"
  // on any tour long enough to group. Never import this one bare.
  Map as MapIcon,
} from 'lucide-react';
import { Modal, Button, Input, Spinner, Badge, Card } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { apiUrl } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { tourHref, tourKeyFor } from '@/lib/runIndex';
import {
  splitCandidates,
  exactArtistMatches,
  resolveTourQuery,
  isBrowsableTour,
  tourOptionLabel,
  buildExistingShowIndex,
  existingShowStatus,
} from '@/lib/tourBrowse';
import { SetlistfmCredit } from '@/components/shows/SetlistfmAttribution';

// Selecting more nights than this at once is worth a word of warning
// before it turns into that many sequential writes and setlist fetches.
const BULK_WARN_THRESHOLD = 20;

// A long tour reads better broken up by month than as one 80-row list.
const GROUP_BY_MONTH_THRESHOLD = 12;

function monthLabel(isoDate) {
  const [y, m] = (isoDate || '').split('-');
  if (!y || !m) return 'Unknown date';
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function dateRangeLabel(tour) {
  if (!tour?.startDate) return '';
  if (!tour.endDate || tour.endDate === tour.startDate) return formatDate(tour.startDate);
  return `${formatDate(tour.startDate)} – ${formatDate(tour.endDate)}`;
}

function placeLabel(show) {
  return [show.city, show.state, show.country].filter(Boolean).join(', ');
}

export default function TourBrowseModal({
  open,
  onClose,
  initialArtistName = '', // resolved to an MBID on open — skips step 1
  initialTourName = '',   // skips step 2 when it resolves to one tour
}) {
  const router = useRouter();
  const { shows, addShowsFromTour, bulkAdd } = useApp();

  const [step, setStep] = useState('artist'); // 'artist' | 'tour' | 'shows'
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [artistOptions, setArtistOptions] = useState([]);
  const [artist, setArtist] = useState(null); // { name, mbid }

  const [tours, setTours] = useState([]);
  const [toursTruncated, setToursTruncated] = useState(false);
  const [tourFilter, setTourFilter] = useState('');
  const [tour, setTour] = useState(null);

  const [tourShows, setTourShows] = useState([]);
  const [showsTruncated, setShowsTruncated] = useState(false);
  const [showFilter, setShowFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const [result, setResult] = useState(null); // { added, skipped, failed }
  const [saving, setSaving] = useState(false);

  // Guards a stale response from a superseded request overwriting a newer
  // one — every fetch below stamps this and checks it before setting state.
  const requestSeq = useRef(0);

  const existingIndex = useMemo(() => buildExistingShowIndex(shows), [shows]);

  const reset = useCallback(() => {
    requestSeq.current += 1;
    setStep('artist');
    setQuery('');
    setBusy(false);
    setError('');
    setNotice('');
    setArtistOptions([]);
    setArtist(null);
    setTours([]);
    setToursTruncated(false);
    setTourFilter('');
    setTour(null);
    setTourShows([]);
    setShowsTruncated(false);
    setShowFilter('');
    setSelected(new Set());
    setResult(null);
  }, []);

  // ── Network ─────────────────────────────────────────────────────────

  // Parses a successful response's body. A 200 carrying HTML rather than
  // JSON is what the SPA catch-all serves when a function isn't deployed —
  // letting the raw SyntaxError through surfaced
  // `Unexpected token '<', "<!DOCTYPE "...` to the user as if it were an
  // explanation of what went wrong.
  const readJson = async (res) => {
    try {
      return await res.json();
    } catch {
      throw new Error("Couldn't read the response from setlist.fm. Try again in a moment.");
    }
  };

  // Turns a non-OK response from either tour function into the honest
  // message it carries. Never collapses a failure into an empty list: a
  // tour that errored and a tour with no shows are different things and
  // the user gets told which.
  const messageFor = async (res) => {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    if (body?.message) return body.message;
    if (res.status === 429) return 'setlist.fm is rate limiting us right now. Try again in a minute.';
    if (res.status === 504) return 'setlist.fm took too long to answer. Try again.';
    return "Couldn't reach setlist.fm. Try again in a moment.";
  };

  const loadTours = useCallback(async (forArtist, { autoTourQuery = '' } = {}) => {
    const seq = ++requestSeq.current;
    setBusy(true);
    setError('');
    setTours([]);
    try {
      const res = await fetch(`${apiUrl('/.netlify/functions/get-artist-tours')}?mbid=${encodeURIComponent(forArtist.mbid)}`);
      if (!res.ok) throw new Error(await messageFor(res));
      const data = await readJson(res);
      if (seq !== requestSeq.current) return null;

      const browsable = (data.tours || []).filter(isBrowsableTour);
      setTours(browsable);
      setToursTruncated(!!data.truncated);
      setStep('tour');

      if (autoTourQuery) {
        const resolved = resolveTourQuery(autoTourQuery, browsable);
        if (resolved) return resolved;
        setTourFilter(autoTourQuery);
        setNotice(`Couldn't pin “${autoTourQuery}” to a single tour — pick the one you meant.`);
      }
      return null;
    } catch (e) {
      if (seq !== requestSeq.current) return null;
      setError(e.message || "Couldn't load this artist's tours.");
      setStep('tour');
      return null;
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  const loadTourShows = useCallback(async (forArtist, forTour) => {
    const seq = ++requestSeq.current;
    setBusy(true);
    setError('');
    setTourShows([]);
    setSelected(new Set());
    setResult(null);
    setStep('shows');
    try {
      const params = new URLSearchParams({ mbid: forArtist.mbid, tourName: forTour.name });
      const res = await fetch(`${apiUrl('/.netlify/functions/get-tour-shows')}?${params}`);
      if (!res.ok) throw new Error(await messageFor(res));
      const data = await readJson(res);
      if (seq !== requestSeq.current) return;
      setTourShows(data.shows || []);
      setShowsTruncated(!!data.truncated);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e.message || "Couldn't load this tour's shows.");
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  const pickTour = useCallback((nextTour) => {
    setTour(nextTour);
    setNotice('');
    if (artist) loadTourShows(artist, nextTour);
  }, [artist, loadTourShows]);

  // ── Step 1: artist, with the free-text shortcut ─────────────────────
  //
  // Resolution order:
  //   1. The whole string as an artist name. "Goose" on its own is the
  //      common case and must not be mangled by the split logic.
  //   2. Leading-token splits, longest artist first, each checked for an
  //      *exact* name match. The first split that resolves to exactly one
  //      artist wins; the remainder becomes the tour query.
  // Anything ambiguous falls through to the artist picker with the
  // options listed — never a guess.
  const searchArtists = async (name) => {
    const res = await fetch(`${apiUrl('/.netlify/functions/search-artists')}?artistName=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error('Artist search failed. Try again.');
    const data = await readJson(res);
    return data.artist || [];
  };

  const runArtistSearch = async () => {
    const raw = query.trim();
    if (!raw) return;

    const seq = ++requestSeq.current;
    setBusy(true);
    setError('');
    setNotice('');
    setArtistOptions([]);

    try {
      const whole = await searchArtists(raw);
      if (seq !== requestSeq.current) return;

      const wholeExact = exactArtistMatches(whole, raw);
      if (wholeExact.length === 1) {
        setArtist(wholeExact[0]);
        setBusy(false);
        await loadTours(wholeExact[0]);
        return;
      }

      // Only try to split a multi-word query. Serialized, and capped by
      // MAX_ARTIST_TOKENS inside splitCandidates, so this is at most a
      // few extra setlist.fm calls.
      for (const candidate of splitCandidates(raw)) {
        const found = await searchArtists(candidate.artistQuery);
        if (seq !== requestSeq.current) return;
        const exact = exactArtistMatches(found, candidate.artistQuery);
        if (exact.length !== 1) continue;

        setArtist(exact[0]);
        setBusy(false);
        const resolvedTour = await loadTours(exact[0], { autoTourQuery: candidate.tourQuery });
        if (resolvedTour) {
          setTour(resolvedTour);
          await loadTourShows(exact[0], resolvedTour);
        }
        return;
      }

      // Nothing resolved cleanly. Show whatever the whole-string search
      // returned so the user can pick, rather than guessing for them.
      if (whole.length > 0) {
        setArtistOptions(whole.slice(0, 10));
        if (splitCandidates(raw).length > 0) {
          setNotice("Couldn't tell where the artist name ends — pick the artist and then the tour.");
        }
      } else {
        setError('No artists found. Try just the artist name.');
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e.message || 'Artist search failed. Try again.');
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  };

  const chooseArtist = async (picked) => {
    setArtist(picked);
    setArtistOptions([]);
    setNotice('');
    await loadTours(picked);
  };

  // ── Deep entry: "add more shows from this tour" ─────────────────────
  // A show document stores an artist *name*, never an MBID, so a tour the
  // user already has can only name its artist. Resolve it through the same
  // /search-artists lookup step 1 uses (there is no second artist search
  // in this feature), then jump as far as the data allows: straight to the
  // show list when the tour name resolves, the tour picker when it
  // doesn't, the artist picker when even the name is ambiguous.
  useEffect(() => {
    if (!open || !initialArtistName) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setQuery(initialArtistName);
      try {
        const found = await searchArtists(initialArtistName);
        if (cancelled) return;
        const exact = exactArtistMatches(found, initialArtistName);
        if (exact.length !== 1) {
          setArtistOptions(found.slice(0, 10));
          setNotice(`Pick which ${initialArtistName} you mean.`);
          setBusy(false);
          return;
        }
        const picked = exact[0];
        setArtist(picked);
        setBusy(false);
        const resolved = await loadTours(picked, { autoTourQuery: initialTourName });
        if (cancelled || !resolved) return;
        setTour(resolved);
        await loadTourShows(picked, resolved);
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Artist search failed. Try again.');
        setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once per opening; the callbacks are stable and the initial
    // props don't change while the modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialArtistName, initialTourName]);

  // ── Selection ───────────────────────────────────────────────────────

  const decorated = useMemo(
    () => tourShows.map(s => ({ ...s, status: existingShowStatus(existingIndex, s) })),
    [tourShows, existingIndex]
  );

  const visible = useMemo(() => {
    const q = showFilter.trim().toLowerCase();
    if (!q) return decorated;
    return decorated.filter(s =>
      (s.venue || '').toLowerCase().includes(q) ||
      placeLabel(s).toLowerCase().includes(q)
    );
  }, [decorated, showFilter]);

  const selectable = useMemo(() => visible.filter(s => s.status !== 'added'), [visible]);
  const allSelected = selectable.length > 0 && selectable.every(s => selected.has(s.setlistfmId));
  const alreadyAddedCount = decorated.filter(s => s.status === 'added').length;

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectable.map(s => s.setlistfmId)));
  };

  const grouped = useMemo(() => {
    if (visible.length < GROUP_BY_MONTH_THRESHOLD) return [{ label: null, shows: visible }];
    const byMonth = new Map();
    visible.forEach(s => {
      const label = monthLabel(s.date);
      if (!byMonth.has(label)) byMonth.set(label, []);
      byMonth.get(label).push(s);
    });
    return Array.from(byMonth.entries()).map(([label, monthShows]) => ({ label, shows: monthShows }));
  }, [visible]);

  // ── Submit ──────────────────────────────────────────────────────────

  // Shaped exactly the way SearchView's setlist.fm import shapes a show,
  // so a bulk-added night is indistinguishable from one added by hand.
  const toCandidate = (s) => ({
    artist: s.artist,
    venue: s.venue,
    city: s.city,
    country: s.country,
    date: s.date,
    // get-tour-shows passes setlist.fm's `sets` through untouched, so this
    // is the same parse the normal search import runs. A night with no
    // setlist yet parses to [] and is still added, flagged as pending.
    setlist: extractSongsFromSetlist({ sets: s.sets }),
    setlistfmId: s.setlistfmId,
    setlistfmUrl: s.url || null,
    tour: s.tour || tour?.name || null,
  });

  const submit = async (idsOverride = null) => {
    const ids = idsOverride || Array.from(selected);
    if (ids.length === 0) return;

    const candidates = decorated
      .filter(s => ids.includes(s.setlistfmId))
      .map(toCandidate);

    setSaving(true);
    try {
      const outcome = await addShowsFromTour(candidates);
      setResult(outcome);
      setSelected(new Set());

      // Land on the tour view for this tour so the new shows are visible
      // right away — but only when nothing failed, so a partial failure's
      // retry affordance stays on screen.
      if (outcome.failed.length === 0 && outcome.added.length > 0) {
        const key = tourKeyFor(outcome.added[0].artist, outcome.added[0].tour);
        onClose();
        reset();
        if (key) router.push(tourHref(key));
      }
    } finally {
      setSaving(false);
    }
  };

  const retryFailed = () => {
    if (!result?.failed?.length) return;
    submit(result.failed.map(f => f.candidate.setlistfmId));
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  const goBack = () => {
    setError('');
    setNotice('');
    if (step === 'shows') {
      setStep('tour');
      setTour(null);
      setResult(null);
    } else if (step === 'tour') {
      setStep('artist');
      setArtist(null);
      setTours([]);
    }
  };

  const filteredTours = useMemo(() => {
    const q = tourFilter.trim().toLowerCase();
    if (!q) return tours;
    return tours.filter(t => (t.name || '').toLowerCase().includes(q));
  }, [tours, tourFilter]);

  const title = step === 'artist'
    ? 'Add shows from a tour'
    : step === 'tour'
      ? `${artist?.name || 'Artist'} — pick a tour`
      : tour?.name || 'Pick the nights you caught';

  const progress = bulkAdd?.running ? bulkAdd : null;

  return (
    <Modal open={open} onClose={handleClose} title={title} size="lg">
      <div className="flex flex-col gap-4">
        {step !== 'artist' && (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-primary transition-colors rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ArrowLeft className="w-4 h-4" />
            {step === 'shows' ? 'All tours' : 'Change artist'}
          </button>
        )}

        {notice && (
          <p className="text-sm text-secondary bg-hover border border-subtle rounded-xl px-3 py-2">{notice}</p>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm text-danger">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Step 1: artist ─────────────────────────────────────────── */}
        {step === 'artist' && (
          <>
            <div className="flex gap-2 items-end">
              <Input
                icon={Search}
                label="Artist, or artist and tour"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runArtistSearch(); }}
                placeholder="Goose — or Goose Summer Tour 2025"
                containerClassName="flex-1"
                autoFocus
              />
              <Button onClick={runArtistSearch} loading={busy} disabled={!query.trim()}>
                Search
              </Button>
            </div>

            {artistOptions.length > 0 && (
              <div className="border border-subtle rounded-xl divide-y divide-subtle overflow-hidden">
                {artistOptions.map(a => (
                  <button
                    key={a.mbid}
                    type="button"
                    onClick={() => chooseArtist(a)}
                    className="w-full text-left px-3 py-2.5 hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <div className="text-sm font-semibold text-primary">{a.name}</div>
                    {a.disambiguation && (
                      <div className="text-xs text-secondary mt-0.5">{a.disambiguation}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!busy && artistOptions.length === 0 && !error && (
              <p className="text-xs text-muted">
                Tours come from setlist.fm, which records a tour name on individual setlists — so
                the tours you see are the ones its contributors have tagged.
              </p>
            )}
          </>
        )}

        {/* ── Step 2: tour ───────────────────────────────────────────── */}
        {step === 'tour' && (
          <>
            {busy ? (
              <div className="py-10"><Spinner size="md" label="Looking up tours…" /></div>
            ) : tours.length === 0 && !error ? (
              <div className="text-center py-10 px-4">
                <MapIcon className="w-8 h-8 text-muted mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm font-semibold text-primary mb-1">
                  No tour names for {artist?.name || 'this artist'}
                </p>
                <p className="text-sm text-secondary">
                  setlist.fm stores a tour name on each individual setlist, and most artists&apos;
                  setlists don&apos;t have one filled in. There&apos;s nothing to browse here — add
                  these shows from the normal search instead.
                </p>
              </div>
            ) : tours.length > 0 ? (
              <>
                {tours.length > 8 && (
                  <Input
                    icon={Search}
                    value={tourFilter}
                    onChange={(e) => setTourFilter(e.target.value)}
                    placeholder="Filter tours…"
                  />
                )}
                {toursTruncated && (
                  <p className="text-xs text-muted">
                    Showing tours from {artist?.name || 'this artist'}&apos;s most recent setlists on
                    setlist.fm. Older tours may not be listed.
                  </p>
                )}
                <div className="max-h-[45vh] overflow-y-auto border border-subtle rounded-xl divide-y divide-subtle">
                  {filteredTours.map(t => (
                    <button
                      key={`${t.name}|${t.startDate}`}
                      type="button"
                      onClick={() => pickTour(t)}
                      className="w-full text-left px-3 py-3 hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <div className="text-sm font-semibold text-primary">{tourOptionLabel(t, tours)}</div>
                      <div className="text-xs text-secondary mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                        {dateRangeLabel(t)}
                        <span aria-hidden="true">·</span>
                        {t.showCount} show{t.showCount !== 1 ? 's' : ''} logged
                      </div>
                    </button>
                  ))}
                  {filteredTours.length === 0 && (
                    <p className="px-3 py-4 text-sm text-secondary">No tours match that filter.</p>
                  )}
                </div>
              </>
            ) : null}
          </>
        )}

        {/* ── Step 3: shows ──────────────────────────────────────────── */}
        {step === 'shows' && (
          <>
            {busy ? (
              <div className="py-10"><Spinner size="md" label="Loading this tour's shows…" /></div>
            ) : (
              <>
                {result && (
                  <Card padding="sm" className={result.failed.length ? 'border-danger/30' : ''}>
                    <p className="text-sm font-semibold text-primary mb-1">
                      Added {result.added.length} show{result.added.length !== 1 ? 's' : ''}
                      {result.skipped.length > 0 && ` · ${result.skipped.length} already in your account`}
                      {result.failed.length > 0 && ` · ${result.failed.length} failed`}
                    </p>
                    {result.failed.length > 0 && (
                      <>
                        <ul className="text-xs text-danger list-disc list-inside mb-2">
                          {result.failed.map(f => (
                            <li key={f.candidate.setlistfmId}>
                              {formatDate(f.candidate.date)} — {f.candidate.venue}: {f.reason}
                            </li>
                          ))}
                        </ul>
                        <Button size="sm" variant="secondary" icon={RotateCcw} onClick={retryFailed} loading={saving}>
                          Retry {result.failed.length} failed
                        </Button>
                      </>
                    )}
                  </Card>
                )}

                {!error && tourShows.length === 0 && (
                  <div className="text-center py-10 px-4">
                    <Music className="w-8 h-8 text-muted mx-auto mb-3" aria-hidden="true" />
                    <p className="text-sm font-semibold text-primary mb-1">No shows logged for this tour</p>
                    <p className="text-sm text-secondary">
                      setlist.fm has the tour name but no setlists filed under it yet. Nothing to add
                      from here.
                    </p>
                  </div>
                )}

                {tourShows.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm text-secondary">
                        {tourShows.length} show{tourShows.length !== 1 ? 's' : ''} on this tour
                        {alreadyAddedCount > 0 && ` · ${alreadyAddedCount} already yours`}
                      </p>
                      <Button size="sm" variant="ghost" icon={Check} onClick={toggleAll} disabled={selectable.length === 0}>
                        {allSelected ? 'Clear all' : 'Select all'}
                      </Button>
                    </div>

                    {tourShows.length > 8 && (
                      <Input
                        icon={Search}
                        value={showFilter}
                        onChange={(e) => setShowFilter(e.target.value)}
                        placeholder="Filter by city or venue…"
                      />
                    )}

                    {showsTruncated && (
                      <p className="text-xs text-muted">
                        This tour has more nights on setlist.fm than we load at once — the most
                        recent are shown.
                      </p>
                    )}

                    {selected.size > BULK_WARN_THRESHOLD && (
                      <p className="text-xs text-amber">
                        {selected.size} shows is a lot to add at once — it&apos;s written one at a
                        time and will take a moment. You can close this and it&apos;ll keep going.
                      </p>
                    )}

                    <div className="max-h-[45vh] overflow-y-auto border border-subtle rounded-xl">
                      {grouped.map(group => (
                        <div key={group.label || 'all'}>
                          {group.label && (
                            <p className="sticky top-0 z-10 bg-hover px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-secondary">
                              {group.label}
                            </p>
                          )}
                          <ul className="list-none p-0 m-0 divide-y divide-subtle">
                            {group.shows.map(s => {
                              const added = s.status === 'added';
                              return (
                                <li key={s.setlistfmId}>
                                  <label
                                    className={[
                                      'flex items-center gap-3 px-3 py-2.5',
                                      added ? 'opacity-60 cursor-not-allowed' : 'hover:bg-hover cursor-pointer',
                                    ].join(' ')}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected.has(s.setlistfmId)}
                                      onChange={() => toggle(s.setlistfmId)}
                                      disabled={added}
                                      aria-label={`${formatDate(s.date)} at ${s.venue}`}
                                      className="rounded"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-semibold text-primary truncate">
                                        {formatDate(s.date)} — {s.venue || 'Unknown venue'}
                                      </div>
                                      <div className="text-xs text-secondary truncate flex items-center gap-1">
                                        <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                                        {placeLabel(s) || 'Location unknown'}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {!s.hasSetlist && <Badge tone="amber" size="sm">Setlist pending</Badge>}
                                      {added && <Badge tone="green" size="sm">Already added</Badge>}
                                      {s.status === 'possible' && (
                                        <Badge tone="amber" size="sm">May already have</Badge>
                                      )}
                                    </div>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                      {visible.length === 0 && (
                        <p className="px-3 py-4 text-sm text-secondary">No shows match that filter.</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {(step === 'tour' || step === 'shows') && (
          <SetlistfmCredit label="Tour and show data from setlist.fm" className="text-[11px] text-muted" />
        )}
      </div>

      <div className="flex items-center justify-between gap-2.5 mt-5 flex-wrap">
        <span className="text-sm text-secondary" aria-live="polite">
          {progress ? `Adding ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}…` : ''}
        </span>
        <div className="flex gap-2.5">
          <Button variant="secondary" onClick={handleClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {step === 'shows' && tourShows.length > 0 && (
            <Button onClick={() => submit()} disabled={selected.size === 0} loading={saving}>
              Add {selected.size} show{selected.size !== 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
