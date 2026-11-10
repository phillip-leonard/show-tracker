'use client';

// components/admin/FestivalLineupSeedCard.jsx
//
// "Seed festival lineups" on the admin page: calls
// netlify/functions/admin-seed-festival-lineups.js, which writes the
// announced lineups in data/festival-lineups.json to the shared festival
// catalog (5.58.0).
//
// Dry run first, always: the write button stays disabled until a dry run in
// this visit found something to set or replace, and its confirm names how
// many. The function itself also refuses to write unless the body says
// { commit: true }. Running it again is safe: an entry already written
// comes back `unchanged` and is not written twice.

import React, { useState } from 'react';
import { Search, ListMusic } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

async function callSeeder(commit) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(apiUrl('/.netlify/functions/admin-seed-festival-lineups'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const COUNT_LABELS = [
  ['set', 'new'],
  ['replace', 'to replace'],
  ['unchanged', 'unchanged'],
  ['missing', 'no such festival'],
  ['failed', 'failed'],
];

export default function FestivalLineupSeedCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [error, setError] = useState('');

  const toWrite = dryRun ? (dryRun.counts?.set ?? 0) + (dryRun.counts?.replace ?? 0) : 0;

  const run = async (commit) => {
    if (commit && !confirm(
      `This writes ${toWrite} lineup${toWrite === 1 ? '' : 's'} to the shared festival catalog in production. ` +
      'Each replaces whatever lineup that festival had, and Ticketmaster won’t change it afterwards. Continue?'
    )) return;
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
      <h3 className="text-lg font-semibold text-primary mb-1">Seed Festival Lineups</h3>
      <p className="text-secondary text-sm mb-4">
        Writes the announced lineups in <code>data/festival-lineups.json</code> to their festivals.
        A lineup from the file replaces a Ticketmaster one and is never replaced by Ticketmaster.
        Edit the file and deploy first; taking an entry out of the file doesn’t remove its lineup.
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
          disabled={loading || toWrite === 0}
          title={dryRun ? undefined : 'Run a dry run first'}
          className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
        >
          <ListMusic className="w-4 h-4" />
          Write Lineups
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">Error: {error}</p>}

      {result && (
        <div className="mt-4 bg-surface border border-subtle rounded-xl p-4 text-sm">
          <p className="text-primary font-medium mb-2">
            {result.dryRun ? 'Dry run' : 'Written'}: {result.entryCount} entries in the file
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-secondary mb-3">
            {COUNT_LABELS.map(([key, label]) => (
              <span key={key} className={(key === 'failed' || key === 'missing') && result.counts[key] ? 'text-danger' : undefined}>
                {result.counts[key] ?? 0} {label}
              </span>
            ))}
          </div>
          {result.written && (
            <p className="text-secondary mb-3">
              Wrote {result.written.written}
              {result.written.failed.length > 0 && (
                <span className="text-danger">, failed {result.written.failed.length}: {
                  result.written.failed.map(f => `${f.label} (${f.reason})`).join('; ')
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
