'use client';

// components/discover/FansAlsoSee.jsx
//
// "Fans of <band> also see…": one band's nightly affinity document
// (bandAffinity/{key}), with no personal ranking, minus bands the viewer has
// already seen. Shown on the band screens and at /discover/?band=<name> for
// every other band.
//
// Signed-in only, like the rest of Discover: the shared collection's rule
// requires a signed-in reader, and the public /artist/ pages don't carry it.

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Card, Spinner } from '@/components/ui';
import { bandKey, alsoSee } from '@/lib/recommendations';
import { loadAffinity } from '@/lib/discover';
import useMyBands from '@/hooks/useMyBands';
import BandSuggestionRow from './BandSuggestionRow';

export default function FansAlsoSee({ name, limit = 10, showEmpty = true, className = '' }) {
  const { uid, bands } = useMyBands();
  const key = bandKey(name);
  const [state, setState] = useState({ key: null, doc: null, error: false });

  useEffect(() => {
    if (!uid || !key) return undefined;
    let live = true;
    loadAffinity(key)
      .then((doc) => { if (live) setState({ key, doc, error: false }); })
      .catch(() => { if (live) setState({ key, doc: null, error: true }); });
    return () => { live = false; };
  }, [uid, key]);

  if (!uid || !key) return null;
  const loading = state.key !== key;
  const rows = loading ? [] : alsoSee(state.doc, bands, limit);
  if (!loading && !rows.length && !showEmpty) return null;

  return (
    <Card padding="md" className={className}>
      <h2 className="text-lg font-bold text-primary flex items-center gap-2">
        <Users className="w-5 h-5 text-brand" />
        Fans of {name} also see…
      </h2>
      {loading ? (
        <div className="py-6 flex justify-center"><Spinner /></div>
      ) : state.error ? (
        <p className="text-sm text-secondary mt-2">Couldn&apos;t load this right now. Please try again later.</p>
      ) : !state.doc ? (
        <p className="text-sm text-secondary mt-2">
          Not enough MySetlists fans of {name} have logged shows yet to say. This updates nightly as people add shows.
        </p>
      ) : !rows.length ? (
        <p className="text-sm text-secondary mt-2">
          You&apos;ve already seen every band {name} fans see often.
        </p>
      ) : (
        <>
          <p className="text-sm text-secondary mt-1">
            Bands that people who love {name} go to see again and again, more than most MySetlists fans do.
          </p>
          <ul className="mt-2">
            {rows.map((c) => (
              <BandSuggestionRow
                key={c.key}
                name={c.name}
                detail={`${c.co} ${name} fans see them often`}
                compact
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
