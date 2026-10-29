'use client';

// components/heard/MyPosterView.jsx
//
// /my-poster/?artist=<name>: a signed-in user's "Songs I've heard" record
// and poster for any band they've logged, from their own shows and
// setlists (lib/myPoster.js). The archive-backed bands get a link to their
// full /heard/ tool instead, which has the band-history sections this page
// can't.
//
// The posters are drawn on the server (POST /api/my-poster, the renderer
// /heard/ uses) from the record built here, and stored nowhere. "Get share
// link" stores the record under a random code and gives a /p/<code>/ link
// (netlify/functions/lib/myPosters.js). Both need the user's ID token.
//
// Safari (and the iOS app's WebView) refuse the share sheet once an await
// has gone by since the tap, so both posters are fetched ahead and the
// link is made in one tap and shared in the next, as /heard/ does.

import React, { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { Download, Share2, Link2, Sparkles, Copy, ArrowLeft } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { isNativePlatform } from '@/lib/platform';
import { externalLinkClick } from '@/lib/publicProfile';
import { heardHref } from '@/lib/heardLinks';
import { buildMyPoster, ARCHIVE_NOTE, MIN_SHOWS_WITH_SETLIST } from '@/lib/myPoster';
import { showHref, bandHref } from '@/lib/showRouting';
import { configBandFor, isoDate } from '@/lib/bandScreens';
import { formatDate } from '@/lib/utils';
import { Button, Card, StatFigure } from '@/components/ui';
import { Section, RowList, Row } from '@/components/bands/BandParts';

const POSTERS = [['feed', 'Feed, 1080×1350'], ['story', 'Story, 1080×1920']];
const SORTS = [['count', 'Most heard'], ['name', 'A–Z'], ['first', 'First heard'], ['last', 'Last heard']];

async function postPoster(body) {
  const user = auth.currentUser;
  if (!user) throw new Error('signed out');
  const token = await user.getIdToken();
  const res = await fetch(apiUrl('/api/my-poster'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const fileSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'band';

function SignInPrompt({ artist }) {
  const { setAuthModal } = useApp();
  return (
    <Card padding="md">
      <h1 className="text-xl font-bold text-primary mb-1">Your {artist} poster</h1>
      <p className="text-sm text-secondary mb-4">Sign in to make a poster of every {artist} song you&apos;ve heard live, from the shows you&apos;ve logged.</p>
      <Button onClick={() => setAuthModal('login')}>Sign in</Button>
    </Card>
  );
}

function Posters({ record }) {
  const native = isNativePlatform();
  const [state, setState] = useState({ status: 'idle' }); // idle | drawing | ready | error
  const name = fileSlug(record.name);

  // A new record (a show added elsewhere) needs new posters.
  useEffect(() => {
    setState((s) => {
      if (s.status === 'ready') s.posters.forEach((p) => URL.revokeObjectURL(p.url));
      return { status: 'idle' };
    });
  }, [record]);

  const draw = async () => {
    setState({ status: 'drawing' });
    try {
      const blobs = await Promise.all(POSTERS.map(([kind]) => postPoster({ action: 'image', kind, record }).then((r) => r.blob())));
      const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && typeof File !== 'undefined';
      const posters = POSTERS.map(([kind, label], i) => {
        const file = typeof File !== 'undefined' ? new File([blobs[i]], `${name}-songs-heard-${kind}.png`, { type: 'image/png' }) : null;
        return { kind, label, blob: blobs[i], file, url: URL.createObjectURL(blobs[i]), shareable: !!file && canShareFiles && navigator.canShare({ files: [file] }) };
      });
      setState({ status: 'ready', posters });
    } catch {
      setState({ status: 'error' });
    }
  };

  const download = (p) => {
    const a = document.createElement('a');
    a.href = p.url;
    a.download = p.file?.name || `${name}-songs-heard-${p.kind}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = (p) => {
    navigator.share({ files: [p.file], title: `${record.name}: songs I've heard live` })
      .catch((e) => { if (!native && (!e || e.name !== 'AbortError')) download(p); });
  };

  return (
    <div>
      {state.status !== 'ready' && (
        <Button icon={Sparkles} onClick={draw} loading={state.status === 'drawing'}>
          {state.status === 'drawing' ? 'Drawing your poster…' : 'Make my poster'}
        </Button>
      )}
      {state.status === 'error' && <p className="text-sm text-danger mt-2">Couldn&apos;t draw the poster just now. Please try again.</p>}
      {state.status === 'ready' && (
        <div className="grid grid-cols-2 gap-3">
          {state.posters.map((p) => (
            <figure key={p.kind} className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`${record.name} poster, ${p.label}`} className="w-full rounded-xl border border-subtle bg-[#1f1f3a]" />
              <figcaption className="text-xs text-muted my-1.5">{p.label}</figcaption>
              <div className="flex flex-wrap gap-2">
                {/* The app's WebView can't save a download; its share sheet has Save Image. */}
                {!native && <Button size="sm" icon={Download} onClick={() => download(p)}>Download</Button>}
                {p.shareable && (
                  <Button size="sm" variant={native ? 'primary' : 'secondary'} icon={Share2} onClick={() => share(p)}>
                    {native ? 'Save or share' : 'Share'}
                  </Button>
                )}
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareLink({ record }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | saving | ready | error
  const [said, setSaid] = useState('');

  useEffect(() => { setState({ status: 'idle' }); setSaid(''); }, [record]);

  const make = async () => {
    setState({ status: 'saving' });
    try {
      const json = await (await postPoster({ action: 'share', record })).json();
      if (!json.url) throw new Error('no url');
      setState({ status: 'ready', url: json.url });
    } catch {
      setState({ status: 'error' });
    }
  };

  const title = `${record.name}: ${record.shows} shows, ${record.uniqueSongs} songs heard`;
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const shareIt = () => navigator.share({ title, url: state.url }).catch(() => {});
  const copy = () => {
    if (!navigator.clipboard) { setSaid('Copy the link above to share your record.'); return; }
    navigator.clipboard.writeText(state.url).then(() => setSaid('Link copied.'), () => setSaid('Copy the link above to share your record.'));
  };

  if (state.status !== 'ready') {
    return (
      <div>
        <Button variant="secondary" icon={Link2} onClick={make} loading={state.status === 'saving'}>Get a share link</Button>
        <p className="text-xs text-muted mt-2">A link to your record and poster, with no name or notes on it.</p>
        {state.status === 'error' && <p className="text-sm text-danger mt-2">Couldn&apos;t make a link just now. Please try again.</p>}
      </div>
    );
  }
  return (
    <div>
      <input
        type="text"
        readOnly
        value={state.url}
        aria-label="Share link"
        onFocus={(e) => e.target.select()}
        className="w-full px-3 py-2 rounded-xl border border-subtle bg-hover text-primary text-sm"
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {canShare && <Button size="sm" icon={Share2} onClick={shareIt}>Share link</Button>}
        <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>Copy link</Button>
      </div>
      {said && <p className="text-xs text-muted mt-2" aria-live="polite">{said}</p>}
    </div>
  );
}

function EverySong({ songs }) {
  const [sort, setSort] = useState('count');
  const sorted = useMemo(() => {
    const list = songs.slice();
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (sort === 'name') list.sort(byName);
    else if (sort === 'first') list.sort((a, b) => (a.firstHeard || '9999').localeCompare(b.firstHeard || '9999') || byName(a, b));
    else if (sort === 'last') list.sort((a, b) => (b.lastHeard || '').localeCompare(a.lastHeard || '') || byName(a, b));
    return list;
  }, [songs, sort]);

  return (
    <Section title={`Every song you've heard (${songs.length})`}>
      <div className="flex flex-wrap gap-1 mb-2 text-xs" role="group" aria-label="Sort songs">
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
            className={`px-3 py-1.5 min-h-[32px] rounded-full border transition-colors ${sort === key ? 'border-brand text-brand font-semibold' : 'border-subtle text-secondary hover:text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <RowList>
        {sorted.map((s) => (
          <Row key={s.name}>
            <div className="flex-1 min-w-0">
              <div className="text-primary truncate">{s.name}</div>
              <div className="text-[11px] text-muted mt-0.5">
                {s.firstHeard === s.lastHeard
                  ? formatDate(s.firstHeard)
                  : `First ${formatDate(s.firstHeard)} · last ${formatDate(s.lastHeard)}`}
              </div>
            </div>
            <span className="text-sm font-bold text-brand flex-shrink-0">{s.count}×</span>
          </Row>
        ))}
      </RowList>
    </Section>
  );
}

export default function MyPosterView({ artist }) {
  const { user, guestMode, shows } = useApp();
  const mine = useMemo(() => buildMyPoster(shows || [], artist), [shows, artist]);
  const band = configBandFor(artist);
  const back = band
    ? <Link href={bandHref(band.slug)} className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 transition-colors"><ArrowLeft className="w-4 h-4" />{band.name}</Link>
    : <Link href="/stats/top-artists/" className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 transition-colors"><ArrowLeft className="w-4 h-4" />Top artists</Link>;

  if (!artist) {
    return <div className="max-w-3xl mx-auto"><Card padding="md"><p className="text-sm text-secondary">Pick a band from <Link href="/stats/top-artists/" className="text-brand">Top Artists</Link> to make its poster.</p></Card></div>;
  }
  if (!user || guestMode) return <div className="max-w-3xl mx-auto"><SignInPrompt artist={mine.name} /></div>;

  const { record, archive, noSetlist } = mine;

  if (archive) {
    const href = heardHref(archive.slug, mine.shows
      .filter((s) => isoDate(s.date))
      .map((s) => ({ date: isoDate(s.date), venue: s.venue || '' })));
    return (
      <div className="max-w-3xl mx-auto">
        {back}
        <Card padding="md">
          <h1 className="text-xl font-bold text-primary mb-1">Your {archive.name} poster</h1>
          <p className="text-sm text-secondary mb-4">{archive.name} has a full setlist archive, so its poster has your rarest catches, the bust-outs you were there for and the songs you&apos;re still chasing.</p>
          <a href={href} onClick={(e) => externalLinkClick(e, href)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-[#2a2a4e] font-semibold text-sm">
            <Sparkles className="w-4 h-4" /> Open my {archive.name} poster
          </a>
        </Card>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="max-w-3xl mx-auto">
        {back}
        <Card padding="md">
          <h1 className="text-xl font-bold text-primary mb-1">Your {mine.name} poster</h1>
          <p className="text-sm text-secondary">You haven&apos;t logged a {mine.name} show yet. Add one and your songs appear here.</p>
        </Card>
      </div>
    );
  }

  const span = record.firstShow
    ? (record.firstShow.date.slice(0, 4) === record.lastShow.date.slice(0, 4) ? record.firstShow.date.slice(0, 4) : `${record.firstShow.date.slice(0, 4)}–${record.lastShow.date.slice(0, 4)}`)
    : '';
  const enough = record.showsWithSetlist >= MIN_SHOWS_WITH_SETLIST;

  return (
    <div className="max-w-3xl mx-auto">
      {back}
      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">
        <h1 className="text-2xl font-bold text-amber">{record.name}</h1>
        <p className="text-sm text-secondary mt-1">
          Songs you&apos;ve heard live, from your {record.shows === 1 ? 'show' : `${record.shows} shows`} in MySetlists{span ? ` · ${span}` : ''}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
          <Card padding="sm"><StatFigure compact value={record.shows.toLocaleString()} label={record.shows === 1 ? 'Show' : 'Shows'} /></Card>
          <Card padding="sm"><StatFigure compact value={record.years.toLocaleString()} label={record.years === 1 ? 'Year' : 'Years'} /></Card>
          <Card padding="sm"><StatFigure compact value={record.venues.toLocaleString()} label={record.venues === 1 ? 'Venue' : 'Venues'} /></Card>
          <Card padding="sm"><StatFigure compact value={record.uniqueSongs.toLocaleString()} label="Songs" /></Card>
          <Card padding="sm" className="col-span-2 sm:col-span-1"><StatFigure compact value={record.totalSongs.toLocaleString()} label="Performances" /></Card>
        </div>
        {record.firstShow && (
          <p className="text-xs text-muted mt-3">
            {record.firstShow.date === record.lastShow.date
              ? `${formatDate(record.firstShow.date)} at ${record.firstShow.venue}`
              : `First show ${formatDate(record.firstShow.date)} at ${record.firstShow.venue} · latest ${formatDate(record.lastShow.date)} at ${record.lastShow.venue}`}
          </p>
        )}
      </div>

      <Section title="Your poster" note={enough ? '' : `Add setlists to at least ${MIN_SHOWS_WITH_SETLIST} of your ${record.name} shows to make a poster.`}>
        {enough && (
          <div className="space-y-5">
            <Posters record={record} />
            <ShareLink record={record} />
          </div>
        )}
      </Section>

      <p className="text-xs text-muted -mt-4 mb-8">{ARCHIVE_NOTE}</p>

      {record.top.length > 0 && (
        <Section title="Your most heard">
          <RowList>
            {record.top.map((s, i) => (
              <Row key={s.name}>
                <span className="w-6 text-muted text-xs flex-shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0 text-primary truncate">{s.name}</span>
                <span className="text-sm font-bold text-brand flex-shrink-0">{s.count}×</span>
              </Row>
            ))}
          </RowList>
        </Section>
      )}

      {record.songs.length > 0 && <EverySong songs={record.songs} />}

      {noSetlist.length > 0 && (
        <Section
          title={`Shows with no setlist (${noSetlist.length})`}
          note="Counted in your shows and venues, but no songs yet. Add a setlist and its songs join your record."
        >
          <RowList>
            {noSetlist.map((s) => (
              <Row key={s.id}>
                <span className="w-24 flex-shrink-0 text-secondary">{formatDate(s.date)}</span>
                <span className="flex-1 min-w-0 text-primary truncate">{[s.venue, s.city].filter(Boolean).join(', ')}</span>
                <Link href={showHref(s.id)} className="text-sm text-brand font-semibold flex-shrink-0">Add setlist</Link>
              </Row>
            ))}
          </RowList>
        </Section>
      )}
    </div>
  );
}
