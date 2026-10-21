'use client';

// The app half of "Save these shows to MySetlists (free)" on the Songs I've
// heard tool (/heard/<slug>/, netlify/functions/lib/heardPages.js). The tool
// links to /shows/?signup=1&heard=<slug>.<code>; AppContext keeps that
// through sign-up as `pendingHeard`, and once someone is signed in this
// asks /api/artist-shows for the shows the code names and saves them.
//
// Saving goes through addShowsFromTour, the same bulk path as adding a
// tour's nights, so each show is built and enriched exactly like a
// hand-added one: Goose and Phish shows get their setlist from elgoose.net
// and Phish.net (lib/bandSetlist.js), merged over the archive setlist the
// tool sent, and everyone else keeps the archive setlist as it came. One
// write at a time, with progress, and the failures offered for a retry.
//
// Shows already in the account are left out first, with a looser artist
// match than addShowsFromTour's own last-line check ("Umphrey’s McGee"
// from setlist.fm is "Umphrey's McGee" here), so doing it twice adds
// nothing.

import { useEffect, useMemo, useState } from 'react';
import { Music, Check, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useDismissable } from '@/context/DismissStackContext';
import { apiUrl } from '@/lib/api';
import { buildExistingShowIndex, existingShowStatus } from '@/lib/tourBrowse';
import { artistNameKeyLoose } from '@/lib/setlistSources';

function songId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toCandidate(artist, show) {
  return {
    artist,
    venue: show.venue,
    city: show.city,
    date: show.date,
    tour: show.tour || null,
    setlist: show.setlist.map((s) => ({ id: songId(), name: s.name, set: s.set, cover: s.cover, tape: false })),
  };
}

export default function HeardSaveModal() {
  const {
    user, guestMode, isLoading, shows, pendingHeard, clearPendingHeard,
    addShowsFromTour, bulkAdd, isArtistFavorite, toggleFavoriteArtist,
  } = useApp();

  const [stage, setStage] = useState('idle'); // idle | loading | ready | saving | done | error
  const [band, setBand] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [result, setResult] = useState(null);
  const [followed, setFollowed] = useState(false);

  const active = !!pendingHeard && !!user && !guestMode;
  const close = () => { clearPendingHeard(); setStage('idle'); setResult(null); };
  useDismissable(active && stage !== 'idle' && stage !== 'saving', close, { id: 'heard-save' });

  useEffect(() => {
    if (!active || isLoading || stage !== 'idle') return;
    const [slug, code] = pendingHeard.split('.');
    setStage('loading');
    fetch(`${apiUrl('/api/artist-shows')}?slug=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        setBand(json.artist);
        setCandidates(json.shows.map((s) => toCandidate(json.artist.name, s)));
        setStage('ready');
      })
      .catch(() => setStage('error'));
  }, [active, isLoading, stage, pendingHeard]);

  // Which picked shows the account already has.
  const { fresh, already } = useMemo(() => {
    if (!band) return { fresh: [], already: [] };
    const key = artistNameKeyLoose(band.name);
    const mine = shows.map((s) => (artistNameKeyLoose(s.artist) === key ? { ...s, artist: band.name } : s));
    const index = buildExistingShowIndex(mine);
    const out = { fresh: [], already: [] };
    candidates.forEach((c) => (existingShowStatus(index, c) === 'added' ? out.already : out.fresh).push(c));
    return out;
  }, [band, candidates, shows]);

  if (!active || stage === 'idle') return null;

  const save = async (list) => {
    setStage('saving');
    const outcome = await addShowsFromTour(list);
    setResult((prev) => ({
      added: (prev?.added || 0) + outcome.added.length,
      skipped: (prev?.skipped || 0) + outcome.skipped.length,
      failed: outcome.failed.map((f) => f.candidate),
    }));
    setStage('done');
  };

  const follow = async () => {
    await toggleFavoriteArtist(band.name);
    setFollowed(true);
  };

  const name = band?.name || 'these';
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  let body;
  if (stage === 'loading') {
    body = <p className="text-secondary text-sm">Getting your shows…</p>;
  } else if (stage === 'error') {
    body = (
      <>
        <p className="text-secondary text-sm mb-5">We couldn&apos;t load the shows you picked. The link may be out of date, or the band&apos;s data is updating. Try again from the Songs I&apos;ve heard page in a little while.</p>
        <Button variant="secondary" onClick={close} full>Close</Button>
      </>
    );
  } else if (stage === 'ready') {
    body = (
      <>
        <p className="text-secondary text-sm mb-4 leading-relaxed">
          {fresh.length
            ? `Add ${plural(fresh.length, `${name} show`)} to your account, with their setlists?`
            : `All ${plural(already.length, `${name} show`)} you picked are already in your account.`}
          {fresh.length && already.length ? ` ${plural(already.length, 'show')} you picked ${already.length === 1 ? 'is' : 'are'} already there and won't be added again.` : ''}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={close} full>{fresh.length ? 'Not now' : 'Close'}</Button>
          {fresh.length > 0 && <Button onClick={() => save(fresh)} full>Add {plural(fresh.length, 'show')}</Button>}
        </div>
      </>
    );
  } else if (stage === 'saving') {
    const done = bulkAdd?.completed || 0;
    const total = bulkAdd?.total || fresh.length;
    body = (
      <>
        <p className="text-secondary text-sm mb-3">Adding show {Math.min(done + 1, total)} of {total}…</p>
        <div className="h-2 rounded-full bg-hover overflow-hidden">
          <div className="h-full bg-brand transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </div>
      </>
    );
  } else if (stage === 'done' && result) {
    const isFollowing = followed || isArtistFavorite(band.name);
    body = (
      <>
        <p className="text-secondary text-sm mb-2 flex items-start gap-2">
          <Check className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
          <span>Added {plural(result.added, 'show')}{result.skipped ? `; ${plural(result.skipped, 'was', 'were')} already in your account` : ''}.</span>
        </p>
        {result.failed.length > 0 && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 mb-3 text-sm text-secondary flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
            <span>{plural(result.failed.length, 'show')} couldn&apos;t be added. Check your connection and try again.</span>
          </div>
        )}
        {!isFollowing && (
          <p className="text-secondary text-sm mt-3 mb-4">Follow {name} and we&apos;ll email you when they announce a tour.</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          {result.failed.length > 0 && <Button onClick={() => save(result.failed)} full>Retry {plural(result.failed.length, 'show')}</Button>}
          {!isFollowing && <Button variant={result.failed.length ? 'secondary' : 'primary'} onClick={follow} full>Follow {name}</Button>}
          <Button variant="secondary" onClick={close} full>Done</Button>
        </div>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget && stage !== 'saving') close(); }}
    >
      <div className="bg-elevated border border-brand/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-brand/10 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="heard-save-title">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-brand-subtle rounded-xl flex items-center justify-center flex-shrink-0">
            <Music className="w-5 h-5 text-brand" />
          </div>
          <h2 id="heard-save-title" className="text-lg font-semibold text-primary">Save your {band?.name ? `${band.name} ` : ''}shows</h2>
        </div>
        {body}
      </div>
    </div>
  );
}

