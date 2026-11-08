// components/admin/OnsaleTab.jsx
//
// Admin → On-sale alerts. Monitoring only: a high-confidence alert needs nothing
// from here, and there is deliberately no way to enter a code. Review approves
// or discards what the parser read; the allowlists decide whose email is read
// at all. Data comes from netlify/functions/admin-onsale.js.

'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Play } from 'lucide-react';
import { Card, Button, Badge, Spinner, EmptyState } from '@/components/ui';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';

const STALE_MS = 45 * 24 * 60 * 60 * 1000;

function fmt(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}

async function api(method, body) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(apiUrl('/.netlify/functions/admin-onsale'), {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function Section({ title, count, children }) {
  return (
    <Card padding="md">
      <h3 className="text-base font-semibold text-primary mb-3 flex items-center gap-2">
        {title}
        {count != null && <Badge>{count}</Badge>}
      </h3>
      {children}
    </Card>
  );
}

function AllowlistEditor({ value, onSave, placeholder }) {
  const [text, setText] = useState(value.join('\n'));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(value.join('\n')); }, [value]);
  const save = async () => {
    setSaved(false);
    await onSave(text.split(/[\s,]+/).filter(Boolean));
    setSaved(true);
  };
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved(false); }}
        rows={3}
        placeholder={placeholder}
        className="w-full text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none font-mono"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={save}>Save</Button>
        {saved && <span className="text-xs text-secondary">Saved</span>}
      </div>
    </div>
  );
}

function ReviewRow({ item, onAct }) {
  return (
    <li className="py-3 border-b border-subtle last:border-0">
      <p className="text-sm text-primary font-medium">{item.artistName}: {item.presaleName || item.subject}</p>
      <p className="text-xs text-secondary mt-0.5">{item.sender} · confidence {item.confidence}</p>
      {item.startsAt && <p className="text-xs text-secondary">Opens {fmt(Date.parse(item.startsAt))}</p>}
      {item.code && <p className="text-xs text-primary font-mono mt-0.5">Code: {item.code}</p>}
      {item.shows.length > 0 && (
        <p className="text-xs text-secondary">{item.shows.map((s) => [s.date, s.venue, s.city].filter(Boolean).join(' · ')).join('; ')}</p>
      )}
      <p className="text-xs text-muted mt-0.5">
        {[
          ...item.reviewReasons,
          item.needsMatchReview ? 'a date matched by venue but not city' : null,
          item.unlocatedShows ? 'a show could not be located' : null,
        ].filter(Boolean).join('; ')}
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onAct('approve', item.id)}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={() => onAct('discard', item.id)}>Discard</Button>
      </div>
    </li>
  );
}

export default function OnsaleTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [newBand, setNewBand] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setData(await api('GET'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (action, id) => {
    try {
      await api('POST', { action, id });
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const runScan = async () => {
    setNotice(null);
    try {
      await api('POST', { action: 'runScan' });
      setNotice('Scan started. Totals appear here when it finishes.');
    } catch (e) {
      setError(e.message);
    }
  };

  const saveArtist = async (artistName, senders) => {
    await api('POST', { action: 'setArtistAllowlist', artistName, senders });
    await load();
  };

  if (!data) {
    return error
      ? <Card padding="md"><p className="text-danger text-sm">{error}</p></Card>
      : <div className="py-12"><Spinner size="md" label="Loading on-sale alerts…" /></div>;
  }

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={Play} onClick={runScan}>Run scan now</Button>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>
        <span className="text-xs text-secondary">
          Last scan: {data.lastScan ? `${fmt(data.lastScan.atMs)}, ${data.lastScan.bands} bands, ${data.lastScan.created} new alerts, ${data.lastScan.skippedForTime} left for next run` : 'none yet'}
        </span>
      </div>
      {notice && <p className="text-sm text-secondary">{notice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <Section title="Review" count={data.review.length}>
        {data.review.length === 0
          ? <EmptyState tone="brand" title="Nothing to review" body="Low-confidence parses wait here. They are never sent unless approved." />
          : <ul>{data.review.map((item) => <ReviewRow key={item.id} item={item} onAct={act} />)}</ul>}
      </Section>

      <Section title="Inbox health" count={data.health.length}>
        {data.health.length === 0 ? <p className="text-sm text-secondary">No band email in the last 90 days.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-secondary">
                <tr><th className="py-1 pr-4">Band</th><th className="pr-4">Received</th><th className="pr-4">Parsed</th><th className="pr-4">Failed</th><th>Last email</th></tr>
              </thead>
              <tbody className="text-primary">
                {data.health.map((r) => (
                  <tr key={r.artistId} className="border-t border-subtle">
                    <td className="py-1 pr-4">{r.artistName}</td>
                    <td className="pr-4">{r.received}</td>
                    <td className="pr-4">{r.received ? Math.round((r.parsed / r.received) * 100) : 0}%</td>
                    <td className="pr-4">{r.failed}</td>
                    <td>
                      {fmt(r.lastEmailAtMs)}
                      {now - r.lastEmailAtMs > STALE_MS && <span className="ml-2"><Badge>Stopped?</Badge></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Waiting on you" count={data.held.length}>
        {data.held.length === 0 ? <p className="text-sm text-secondary">No held, unmatched or failed emails.</p> : (
          <ul>
            {data.held.map((e) => (
              <li key={e.id} className="py-2 border-b border-subtle last:border-0">
                <p className="text-sm text-primary">{e.subject}</p>
                <p className="text-xs text-secondary">{e.sender} · {e.status}{e.reason ? ` (${e.reason})` : ''} · {fmt(e.receivedAtMs)}</p>
                {e.artistName && e.status !== 'unmapped' && (
                  <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => act('releaseEmail', e.id)}>Parse this email</Button></div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Rejected senders" count={data.rejected.length}>
        {data.rejected.length === 0 ? <p className="text-sm text-secondary">None.</p> : (
          <ul>
            {data.rejected.map((e) => (
              <li key={e.id} className="py-1 text-xs text-secondary border-b border-subtle last:border-0">
                <span className="text-primary">{e.sender}</span> · {e.reason} · {e.subject} · {fmt(e.receivedAtMs)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sender allowlists">
        <p className="text-xs text-secondary mb-2">An exact address, or a domain that covers its subdomains. One per line.</p>
        <p className="text-sm text-primary font-medium mb-1">Global (Seated)</p>
        <p className="text-xs text-secondary mb-2">Emails from these senders supply sign-up links and dates, never codes.</p>
        <AllowlistEditor
          value={data.global}
          placeholder="seated-sending-domain.example"
          onSave={async (senders) => { await api('POST', { action: 'setGlobalAllowlist', senders }); await load(); }}
        />
        <div className="mt-4 space-y-4">
          {data.artists.map((a) => (
            <div key={a.id}>
              <p className="text-sm text-primary font-medium mb-1">
                {a.name}
                {a.ticketingModel === 'bandPortal' && <span className="ml-2"><Badge>Own portal</Badge></span>}
              </p>
              <AllowlistEditor value={a.senderAllowlist} placeholder="news@band.com" onSave={(senders) => saveArtist(a.name, senders)} />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-subtle">
          <label htmlFor="onsale-new-band" className="text-sm text-primary font-medium block mb-1">Add a band</label>
          <input
            id="onsale-new-band"
            value={newBand}
            onChange={(e) => setNewBand(e.target.value)}
            placeholder="Band name"
            className="w-full text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none mb-2"
          />
          {newBand.trim() && (
            <AllowlistEditor
              value={[]}
              placeholder="news@band.com"
              onSave={async (senders) => { await saveArtist(newBand.trim(), senders); setNewBand(''); }}
            />
          )}
        </div>
      </Section>

      <Section title="Low-confidence Ticketmaster matches" count={data.lowConfidenceAttractions.length}>
        {data.lowConfidenceAttractions.length === 0 ? <p className="text-sm text-secondary">None.</p> : (
          <ul className="text-sm text-primary">
            {data.lowConfidenceAttractions.map((a) => <li key={a.id}>{a.name} <span className="text-xs text-secondary font-mono">{a.attractionId}</span></li>)}
          </ul>
        )}
      </Section>

      <Section title="Recent alerts" count={data.recentAlerts.length}>
        {data.recentAlerts.length === 0 ? <p className="text-sm text-secondary">None yet.</p> : (
          <ul>
            {data.recentAlerts.map((a) => (
              <li key={a.id} className="py-1 text-xs text-secondary border-b border-subtle last:border-0">
                <span className="text-primary">{a.artistName}</span> · {[a.eventDate, a.venue, a.city].filter(Boolean).join(' · ')} · sent {fmt(a.notifiedAtMs)} · {a.channels.join(', ')}{a.hasCode ? ' · code' : ''}{a.reminderSentAtMs ? ' · reminded' : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
