'use client';

// components/admin/FestivalSeedCard.jsx
//
// "Seed festival catalog" on the admin page: calls
// netlify/functions/admin-seed-festivals.js, which pre-populates the shared
// festival catalog from data/festival-seed.json.
//
// Dry run first, always: the write button stays disabled until a dry run
// has been loaded in this visit, and its confirm names the number of
// festivals that dry run said it would create. The function itself also
// refuses to write unless the body says { commit: true }. Running it again
// is safe — every seeded festival has a fixed id, so a second run creates
// nothing.

import React, { useState } from 'react';
import { Search, Database } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

async function callSeeder(commit) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(apiUrl('/.netlify/functions/admin-seed-festivals'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const COUNT_LABELS = [
  ['create', 'to create'],
  ['matched_existing', 'already in catalog'],
  ['conflict', 'conflicts'],
  ['skip', 'already seeded'],
  ['failed', 'failed'],
];

export default function FestivalSeedCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [dryRun, setDryRun] = useState(null); // the last dry run this visit
  const [error, setError] = useState('');

  const run = async (commit) => {
    if (commit) {
      const n = dryRun?.counts?.create ?? 0;
      if (!confirm(
        `This writes ${n} new festival${n === 1 ? '' : 's'} to the shared catalog in production. ` +
        'Existing festivals are never changed. Continue?'
      )) return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await callSeeder(commit);
      setResult(data);
      setDryRun(data.dryRun ? data : null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-primary mb-1">Seed Festival Catalog</h3>
      <p className="text-secondary text-sm mb-4">
        Adds the US festival editions in <code>data/festival-seed.json</code> to the shared catalog,
        so users can join them instead of creating them. A festival that already exists is never
        changed: matches and conflicts are listed for you to decide. Safe to run twice.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => run(false)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-subtle hover:bg-amber/30 text-amber border border-amber/30 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {loading ? 'Working…' : 'Dry Run (Preview)'}
        </button>
        <button
          onClick={() => run(true)}
          disabled={loading || !dryRun || (dryRun.counts?.create ?? 0) === 0}
          title={dryRun ? undefined : 'Run a dry run first'}
          className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
        >
          <Database className="w-4 h-4" />
          Write Festivals
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">Error: {error}</p>}

      {result && (
        <div className="mt-4 bg-surface border border-subtle rounded-xl p-4 text-sm">
          <p className="text-primary font-medium mb-2">
            {result.dryRun ? 'Dry run' : 'Written'} — {result.seedCount} seed records, catalog had{' '}
            {result.catalogCount} festivals
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-secondary mb-3">
            {COUNT_LABELS.map(([key, label]) => (
              <span key={key} className={key === 'conflict' && result.counts[key] ? 'text-danger' : undefined}>
                {result.counts[key]} {label}
              </span>
            ))}
          </div>
          {result.written && (
            <p className="text-secondary mb-3">
              Created {result.written.created}, skipped {result.written.skipped}
              {result.written.failed.length > 0 && (
                <span className="text-danger">, failed {result.written.failed.length}: {
                  result.written.failed.map(f => `${f.seedKey} (${f.reason})`).join('; ')
                }</span>
              )}
            </p>
          )}
          <pre className="text-[11px] leading-snug text-secondary whitespace-pre overflow-x-auto max-h-96 overflow-y-auto bg-hover rounded-lg p-3">
            {result.report}
          </pre>
        </div>
      )}
    </div>
  );
}
