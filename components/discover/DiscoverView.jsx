'use client';

// components/discover/DiscoverView.jsx
//
// "Bands you might like": bands the user has never seen live, ranked by
// what fans of their bands go to see (lib/recommendations.js). Reads the
// affinity docs for the user's heaviest MAX_SEED_READS seed bands and
// scores them on the device; the user's own shows and follows never leave
// it.
//
// Empty states, in order: signed out → no shows or follows yet (nudge to
// add or import) → nothing qualifies (said plainly, never padded with
// popular bands).

import { useEffect, useMemo, useState } from 'react';
import { Compass, Plus, Upload, Sparkles, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { recommend, becauseText, MAX_SEED_READS } from '@/lib/recommendations';
import { loadAffinityDocs } from '@/lib/discover';
import useMyBands from '@/hooks/useMyBands';
import BandSuggestionRow from './BandSuggestionRow';

export default function DiscoverView() {
  const router = useRouter();
  const { setShowForm } = useApp();
  const { uid, ready, bands, seeds, dismissed, dismiss, undismiss } = useMyBands();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const seedKeys = useMemo(() => seeds.slice(0, MAX_SEED_READS).map((s) => s.key), [seeds]);
  const seedSig = seedKeys.join('|');

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    setError(false);
    loadAffinityDocs(seedKeys)
      .then((d) => { if (live) setDocs(d); })
      .catch(() => { if (live) { setDocs({}); setError(true); } });
    return () => { live = false; };
  }, [ready, seedSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const recs = useMemo(
    () => (docs ? recommend({ seeds, affinityDocs: docs, bands, dismissed }) : []),
    [docs, seeds, bands, dismissed]
  );
  const hiddenNames = useMemo(() => {
    if (!docs) return [];
    const names = new Map();
    for (const d of Object.values(docs)) for (const c of d.candidates || []) names.set(c.key, c.name);
    return dismissed.map((k) => ({ key: k, name: names.get(k) || k }));
  }, [docs, dismissed]);

  const header = (
    <PageHeader
      eyebrow="Discover"
      title="Bands you might like"
      subtitle="Bands you haven't seen live that fans of your bands go to see again and again."
    />
  );

  if (!ready || (seeds.length && !docs)) {
    return (
      <>
        {header}
        <div className="py-16 flex justify-center"><Spinner /></div>
      </>
    );
  }

  if (!seeds.length) {
    return (
      <>
        {header}
        <EmptyState
          icon={Compass}
          tone="brand"
          title="Add a few shows to get suggestions"
          body="Suggestions start from the bands you've seen and the bands you follow. Add or import your shows and they'll show up here."
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <Button icon={Plus} onClick={() => { setShowForm(true); router.push('/shows/'); }}>Add a show</Button>
              <Button variant="secondary" icon={Upload} onClick={() => router.push('/scan-import/')}>Import shows</Button>
            </div>
          }
        />
      </>
    );
  }

  return (
    <div className="max-w-3xl">
      {header}
      {error && (
        <p className="text-sm text-danger mb-4">Some suggestions couldn&apos;t load. Please try again later.</p>
      )}
      {recs.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No suggestions yet"
          body="Suggestions come from bands that several fans of your bands see often. Not enough people have logged shows for that yet. This updates nightly, so check back as more shows are added."
        />
      ) : (
        <Card padding="none" className="px-4 md:px-6">
          <ul>
            {recs.map((r) => (
              <BandSuggestionRow
                key={r.key}
                name={r.name}
                reason={becauseText(r.because)}
                detail={`${r.topCo} ${r.topSeed} fans see them often`}
                onDismiss={() => dismiss(r.key)}
              />
            ))}
          </ul>
        </Card>
      )}

      {hiddenNames.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="text-sm text-muted hover:text-primary min-h-touch md:fine:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
          >
            {showHidden ? 'Hide' : 'Show'} bands you&apos;re not interested in ({hiddenNames.length})
          </button>
          {showHidden && (
            <ul className="mt-2 space-y-1">
              {hiddenNames.map((h) => (
                <li key={h.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-secondary">{h.name}</span>
                  <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => undismiss(h.key)}>Bring back</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-muted mt-6">
        Built from anonymous counts across MySetlists, updated nightly. The counts never include names.
      </p>
    </div>
  );
}
