// components/admin/UnsubscribesTab.jsx
//
// Admin → Unsubscribes. Read-only by design: nothing here re-subscribes
// anyone or puts them back on a send. The only way back in is the person
// themselves, from Profile.
//
// Data comes from netlify/functions/admin-list-unsubscribes.js (the
// client never reads userProfiles opt-out fields, emailSuppressions or
// unsubscribeEvents directly — those collections are server-only).
//   Current state    everyone opted out right now, account or not
//   Recent activity  the append-only log, re-subscribes included

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, AlertTriangle, MailX } from 'lucide-react';
import { Card, Button, Input, Select, Tabs, Badge, Spinner, EmptyState, StatTile, SearchField } from '@/components/ui';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { today as localToday } from '@/lib/showDate';

const METHOD_LABELS = { link: 'Link', 'one-click': 'Gmail one-click', profile: 'Profile', legacy: 'Legacy' };
const LEVEL_LABELS = { all: 'All emails', announcements: 'Announcements only' };
const DAY_MS = 86_400_000;

function sourceLabel(source, announcements) {
  if (!source) return '—';
  if (source === 'profile') return 'Profile settings';
  const [kind, id] = source.split(/:(.*)/s);
  if (kind === 'announcement') {
    if (id === 'test') return 'Announcement test';
    return `Announcement: ${announcements[id] || id}`;
  }
  if (kind === 'notification') return `Notification: ${String(id || '').replace(/_/g, ' ')}`;
  return source;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function UnsubscribesTab({ initialSource = '' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('current');

  const [level, setLevel] = useState('');
  const [method, setMethod] = useState('');
  const [source, setSource] = useState(initialSource);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { setSource(initialSource); }, [initialSource]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(apiUrl('/.netlify/functions/admin-list-unsubscribes'), {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const announcements = data?.announcements || {};

  const summary = useMemo(() => {
    if (!data) return null;
    const cutoff = Date.now() - 30 * DAY_MS;
    const recent = new Set(
      data.events
        .filter((e) => e.action === 'unsubscribe' && e.createdAt && Date.parse(e.createdAt) >= cutoff)
        .map((e) => e.email || e.uid),
    );
    return {
      total: data.current.length,
      all: data.current.filter((r) => r.level === 'all').length,
      announcements: data.current.filter((r) => r.level === 'announcements').length,
      last30: recent.size,
    };
  }, [data]);

  const sourceOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set();
    for (const r of data.current) if (r.source) set.add(r.source);
    for (const e of data.events) if (e.source) set.add(e.source);
    for (const id of Object.keys(announcements)) set.add(`announcement:${id}`);
    if (initialSource) set.add(initialSource);
    return [...set].sort().map((s) => ({ value: s, label: sourceLabel(s, announcements) }));
  }, [data, announcements, initialSource]);

  const matches = (row, dateField, levelField) => {
    if (level && row[levelField] !== level) return false;
    if (method && row.method !== method) return false;
    if (source && row.source !== source) return false;
    const q = search.trim().toLowerCase();
    if (q && !(`${row.email || ''} ${row.displayName || ''} ${row.handle || ''}`.toLowerCase().includes(q))) return false;
    const t = row[dateField] ? Date.parse(row[dateField]) : null;
    if (from && (t == null || t < Date.parse(from))) return false;
    if (to && (t == null || t >= Date.parse(to) + DAY_MS)) return false;
    return true;
  };

  const currentRows = useMemo(() => (data ? data.current.filter((r) => matches(r, 'date', 'level')) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, level, method, source, from, to, search]);
  const eventRows = useMemo(() => (data ? data.events.filter((e) => matches(e, 'createdAt', 'scope')) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, level, method, source, from, to, search]);

  const exportCsv = () => {
    const stamp = localToday();
    if (view === 'current') {
      downloadCsv(`unsubscribes-current-${stamp}.csv`,
        ['email', 'name', 'handle', 'level', 'date', 'method', 'source'],
        currentRows.map((r) => [r.email, r.displayName, r.handle, LEVEL_LABELS[r.level], r.date || '', METHOD_LABELS[r.method] || r.method, sourceLabel(r.source, announcements)]));
    } else {
      downloadCsv(`unsubscribes-activity-${stamp}.csv`,
        ['date', 'email', 'action', 'level', 'method', 'source'],
        eventRows.map((e) => [e.createdAt || '', e.email, e.action, LEVEL_LABELS[e.scope], METHOD_LABELS[e.method] || e.method, sourceLabel(e.source, announcements)]));
    }
  };

  if (!data) {
    return (
      <Card>
        {error ? (
          <div className="flex items-center gap-2 text-danger text-sm"><AlertTriangle className="w-4 h-4" /> {error}</div>
        ) : (
          <div className="flex justify-center py-8"><Spinner /></div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile value={summary.total} label="Opted out now" />
        <StatTile value={summary.announcements} label="Announcements only" />
        <StatTile value={summary.all} label="All emails" />
        <StatTile value={summary.last30} label="Unsubscribed, last 30 days" tone="brand" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Tabs
            value={view}
            onChange={setView}
            tabs={[
              { id: 'current', label: 'Current state', count: data.current.length },
              { id: 'activity', label: 'Recent activity', count: data.events.length },
            ]}
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon={RefreshCw} loading={loading} onClick={load}>Refresh</Button>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv}>Export CSV</Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6 mb-4">
          <SearchField value={search} onChange={setSearch} placeholder="Search email or name" className="lg:col-span-2" />
          <Select value={level} onChange={(e) => setLevel(e.target.value)} options={[
            { value: '', label: 'Any level' },
            { value: 'announcements', label: 'Announcements only' },
            { value: 'all', label: 'All emails' },
          ]} />
          <Select value={method} onChange={(e) => setMethod(e.target.value)} options={[
            { value: '', label: 'Any method' },
            { value: 'link', label: 'Link' },
            { value: 'one-click', label: 'Gmail one-click' },
            { value: 'profile', label: 'Profile' },
            { value: 'legacy', label: 'Legacy' },
          ]} />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <Select containerClassName="md:col-span-3 lg:col-span-6" value={source} onChange={(e) => setSource(e.target.value)} options={[
            { value: '', label: 'Any source' },
            ...sourceOptions,
          ]} />
        </div>

        {view === 'current' ? (
          currentRows.length === 0 ? (
            <EmptyState icon={MailX} title="Nobody matches" body="No one currently opted out matches these filters." />
          ) : (
            <div className="overflow-x-auto -mx-4 md:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-subtle">
                    <th className="py-2 px-4 md:px-2 font-semibold">Email</th>
                    <th className="py-2 px-2 font-semibold">Account</th>
                    <th className="py-2 px-2 font-semibold">Level</th>
                    <th className="py-2 px-2 font-semibold">Date</th>
                    <th className="py-2 px-2 font-semibold">How</th>
                    <th className="py-2 px-2 font-semibold">From</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {currentRows.map((r) => (
                    <tr key={r.email || r.uid} className="align-top">
                      <td className="py-2 px-4 md:px-2 text-primary break-all">{r.email || '—'}</td>
                      <td className="py-2 px-2 text-secondary">{r.uid ? (r.displayName || (r.handle ? `@${r.handle}` : 'Account')) : <span className="text-muted">No account</span>}</td>
                      <td className="py-2 px-2"><Badge size="sm" tone={r.level === 'all' ? 'red' : 'amber'}>{LEVEL_LABELS[r.level]}</Badge></td>
                      <td className="py-2 px-2 text-secondary whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="py-2 px-2 text-secondary whitespace-nowrap">{METHOD_LABELS[r.method] || r.method}</td>
                      <td className="py-2 px-2 text-secondary">{sourceLabel(r.source, announcements)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : eventRows.length === 0 ? (
          <EmptyState icon={MailX} title="No activity" body="No unsubscribe or re-subscribe events match these filters." />
        ) : (
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-subtle">
                  <th className="py-2 px-4 md:px-2 font-semibold">Date</th>
                  <th className="py-2 px-2 font-semibold">Email</th>
                  <th className="py-2 px-2 font-semibold">Action</th>
                  <th className="py-2 px-2 font-semibold">Level</th>
                  <th className="py-2 px-2 font-semibold">How</th>
                  <th className="py-2 px-2 font-semibold">From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {eventRows.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2 px-4 md:px-2 text-secondary whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                    <td className="py-2 px-2 text-primary break-all">{e.email || '—'}</td>
                    <td className="py-2 px-2">
                      <Badge size="sm" tone={e.action === 'resubscribe' ? 'green' : 'neutral'}>{e.action === 'resubscribe' ? 'Re-subscribed' : 'Unsubscribed'}</Badge>
                    </td>
                    <td className="py-2 px-2 text-secondary">{LEVEL_LABELS[e.scope]}</td>
                    <td className="py-2 px-2 text-secondary whitespace-nowrap">{METHOD_LABELS[e.method] || e.method}</td>
                    <td className="py-2 px-2 text-secondary">{sourceLabel(e.source, announcements)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
