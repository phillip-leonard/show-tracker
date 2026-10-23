'use client';

// components/admin/ArchiveDryRunCard.jsx
//
// "Internet Archive dry run" on the admin page: starts
// admin-resync-setlists-background with dryRun: true for every Grateful
// Dead show, then shows its report when it lands. A background function
// answers 202 and nothing else, so the report is read back from
// adminResyncRuns/gd-dry-1 through admin-resync-setlists' `readRun`
// action, behind the same admin check, every 15 seconds until the report
// carrying this click's requestId appears.
//
// Dry run only: there is no write button here. A live run (proposals) waits
// on the Internet Archive's reply.

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle, Database } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

const RUN_ID = 'gd-dry-1';
const POLL_MS = 15000;
// The 378-show walk took about 25 minutes uncached at one Archive request a
// second; the background function is stopped at 15. Give up a little after.
const GIVE_UP_MS = 17 * 60 * 1000;

async function callResync(path, body) {
  const token = await auth.currentUser.getIdToken();
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readReport() {
  const res = await callResync('/.netlify/functions/admin-resync-setlists', { readRun: RUN_ID });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function Count({ label, value, tone = 'text-secondary' }) {
  return <span className={tone}>{value ?? 0} {label}</span>;
}

function Rows({ title, rows, render }) {
  if (!rows?.length) return null;
  return (
    <div className="p-2.5 bg-surface border border-subtle rounded-xl">
      <p className="text-[11px] text-muted mb-1">{title}</p>
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {rows.map((row, i) => <p key={i} className="text-[11px] text-secondary">{render(row)}</p>)}
      </div>
    </div>
  );
}

export default function ArchiveDryRunCard() {
  const [status, setStatus] = useState('idle'); // idle | starting | waiting | done | error
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showLast = async () => {
    setError('');
    try {
      const data = await readReport();
      if (!data.found) { setError(`No report saved at adminResyncRuns/${RUN_ID} yet.`); setStatus('error'); return; }
      setRun(data);
      setStatus('done');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  };

  const start = async () => {
    clearTimeout(timer.current);
    setRun(null);
    setError('');
    setStatus('starting');
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    try {
      const res = await callResync('/.netlify/functions/admin-resync-setlists-background', {
        dryRun: true, source: 'archive', limit: 1000, runId: RUN_ID, requestId,
      });
      // 202 is a background function's only answer; it says nothing about
      // whether the admin check passed. A refusal shows up as no report.
      if (res.status !== 202 && !res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e.message);
      setStatus('error');
      return;
    }
    setStatus('waiting');

    const poll = async () => {
      try {
        const data = await readReport();
        if (data.found && data.requestId === requestId) {
          setRun(data);
          setStatus('done');
          return;
        }
      } catch (e) {
        // One failed read is not the end of the run; keep waiting.
        console.warn('[ARCHIVE DRY RUN] read failed:', e.message);
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setError('No report after 17 minutes. Check the function log: netlify logs --function admin-resync-setlists-background --follow');
        setStatus('error');
        return;
      }
      timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  };

  const r = run?.report;
  const busy = status === 'starting' || status === 'waiting';

  return (
    <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-4">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-primary">Internet Archive dry run</h3>
          <p className="text-xs text-muted">
            Every Grateful Dead show: what the Archive would propose. Writes nothing to any show.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={showLast}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-2 border border-subtle text-secondary rounded-xl text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5" />
            Last report
          </button>
          <button
            onClick={start}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand to-amber text-on-dark rounded-xl text-sm font-medium transition-all shadow-sm disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Running...' : 'Start dry run'}
          </button>
        </div>
      </div>

      {busy && (
        <div className="flex items-center gap-2 mt-3">
          <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-secondary">
            {status === 'starting' ? 'Starting...' : 'Running in the background (a few minutes when cached, up to 15). Nothing is being written to any show.'}
          </span>
        </div>
      )}

      {status === 'error' && error && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-xs"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{error}</p>
        </div>
      )}

      {status === 'done' && run && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-muted">
            Report {RUN_ID}, finished {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : 'at an unknown time'}
            {run.error ? <span className="text-danger"> with an error: {run.error}</span> : null}
            {r?.truncated ? <span className="text-amber"> (partial: {r.outOfTime ? 'hit the time budget' : 'hit the limit'})</span> : null}
          </p>
          {r && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <Count label="considered" value={r.considered} tone="text-muted" />
                <Count label="would get a proposal" value={r.wouldChange} tone="text-brand font-medium" />
                <Count label="source only" value={r.sourceOnly} />
                <Count label="need review" value={r.needsReview} tone="text-amber" />
                <Count label="not proposed" value={r.notProposed?.length} />
                <Count label="nothing on the Archive" value={r.sourceReturnedNothing?.length} />
                <Count label="excluded" value={r.excluded?.shows?.length} tone="text-muted" />
                <Count label="errors" value={r.errors?.length} tone={r.errors?.length ? 'text-danger' : 'text-muted'} />
              </div>
              <Rows title="Not proposed (weak tape)" rows={r.notProposed} render={(x) => `${x.date} · ${x.venue} — ${String(x.note || '').replace(/^no proposal: /, '')}`} />
              <Rows title="Need review (tapes disagree)" rows={(r.shows || []).filter((x) => x.archive?.needsReview)} render={(x) => `${x.date} · ${x.venue} — ${x.archive.identifier} vs ${x.archive.disagreement?.with || '?'}`} />
              <Rows title="Nothing on the Archive" rows={r.sourceReturnedNothing} render={(x) => `${x.date} · ${x.venue}`} />
              <Rows title="Excluded" rows={r.excluded?.shows} render={(x) => `${x.date} — ${x.reason}`} />
              <Rows title="Errors" rows={r.errors} render={(x) => `${x.date} — ${x.message}`} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
