// components/admin/AnnouncementsTab.jsx
//
// Admin → Announcements: write an email, see exactly who it will reach,
// send yourself a test, then send it to everyone — through
// netlify/functions/admin-send-announcement.js, which owns every rule
// (opt-outs, suppressions, signed unsubscribe links, List-Unsubscribe
// headers, the CAN-SPAM mailing address, never-twice resumable sending).
// This screen only drives it.
//
// The send is a loop: each call works for a few seconds (Netlify's
// function timeout) and returns { remaining }; this keeps calling until
// it's 0. Closing the tab mid-send is safe — the history list offers
// Resume, and nobody already sent to is sent to again.

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Eye, Mail, RefreshCw, AlertTriangle, Check, Users } from 'lucide-react';
import { Card, Button, Input, Textarea, Badge, Modal, Spinner, EmptyState } from '@/components/ui';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { wrapEmail, injectUnsubscribeFooter } from '@/netlify/functions/lib/emailLayout';
import { recapEmail, RECAP_AUDIENCE, RECAP_YEAR } from '@/netlify/functions/lib/yearRecapEmail';

async function callAnnouncements(body) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(apiUrl('/.netlify/functions/admin-send-announcement'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, ok: res.ok, data };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function extraLines(text) {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function CountGrid({ counts }) {
  const items = [
    { label: 'Will receive', value: counts.total, tone: 'text-brand' },
    { label: 'Users', value: counts.users },
    { label: 'Extra emails', value: counts.extras },
    { label: 'Opted out / suppressed', value: counts.excluded },
    { label: 'Invalid addresses', value: counts.invalid },
    { label: 'Duplicates merged', value: counts.duplicates ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {items.map((it) => (
        <div key={it.label} className="bg-base border border-subtle rounded-xl p-3">
          <div className={`text-2xl font-extrabold ${it.tone || 'text-primary'}`}>{it.value}</div>
          <div className="text-xs text-muted mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    completed: ['green', 'Sent'],
    completed_with_errors: ['amber', 'Sent with errors'],
    sending: ['navy', 'In progress'],
    preparing: ['neutral', 'Preparing'],
  };
  const [tone, label] = map[status] || ['neutral', status || 'Unknown'];
  return <Badge tone={tone} size="sm">{label}</Badge>;
}

// The two Year in Review emails (netlify/functions/lib/yearRecapEmail.js):
// fixed templates, sent only to accounts with a show in the recap year.
// The server refuses a real send until YEAR_RECAP_EMAILS_ENABLED=true is
// set in Netlify; preview and "send test to me" always work.
const RECAP_TEMPLATES = [['ready', `"Ready" (send Dec 2)`], ['final', `"Final, NYE included" (send Jan 2)`]];

function RecapEmailCard({ busy, setBusy, runSend }) {
  const [template, setTemplate] = useState('ready');
  const [preview, setPreview] = useState(null); // { counts, recapEnabled, missingConfig, template }
  const [message, setMessage] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const email = recapEmail(template, RECAP_YEAR);
  const html = useMemo(() => injectUnsubscribeFooter(wrapEmail(email.html), {
    url: '#', scope: 'announcements', mailingAddress: 'Your mailing address (from MAILING_ADDRESS)',
  }), [email.html]);
  const body = { audience: RECAP_AUDIENCE, template };
  const current = preview && preview.template === template;

  const handlePreview = async () => {
    setBusy('recap-preview'); setMessage(null);
    try {
      const r = await callAnnouncements({ mode: 'preview', ...body });
      if (!r.ok) throw new Error(r.data.error || `Preview failed (${r.status})`);
      setPreview({ ...r.data, template });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('recap-test'); setMessage(null);
    try {
      const r = await callAnnouncements({ mode: 'test', ...body });
      if (!r.ok) throw new Error(r.data.error || `Test send failed (${r.status})`);
      setMessage({ tone: 'ok', text: `Test sent to ${r.data.sentTo}.` });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const count = current ? preview.counts.total : null;
  const enabled = current && preview.recapEnabled;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Mail className="w-5 h-5 text-brand" />
        <h2 className="text-lg font-bold text-primary">Year in Review {RECAP_YEAR} emails</h2>
      </div>
      <p className="text-sm text-secondary mb-4">
        Only to accounts with at least one {RECAP_YEAR} show and email on. Nothing sends until you press Send here,
        and the server refuses a real send until <code>YEAR_RECAP_EMAILS_ENABLED=true</code> is set in Netlify.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Which email">
            {RECAP_TEMPLATES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-primary">
                <input type="radio" name="recap-template" value={key} checked={template === key} onChange={() => setTemplate(key)} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-sm"><span className="text-muted">Subject:</span> <span className="text-primary font-semibold">{email.subject}</span></p>
          {current && (
            <div className="space-y-2">
              <CountGrid counts={preview.counts} />
              {!preview.recapEnabled && (
                <p className="text-xs text-amber flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Sending is switched off (YEAR_RECAP_EMAILS_ENABLED isn&apos;t true). Test sends still work.
                </p>
              )}
            </div>
          )}
          {message && (
            <div className={`flex items-start gap-2 text-sm ${message.tone === 'error' ? 'text-danger' : 'text-brand'}`}>
              {message.tone === 'error' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <Check className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" icon={Eye} loading={busy === 'recap-preview'} disabled={!!busy} onClick={handlePreview}>Preview recipients</Button>
            <Button variant="secondary" icon={Mail} loading={busy === 'recap-test'} disabled={!!busy} onClick={handleTest}>Send test to me</Button>
            <Button icon={Send} disabled={!!busy || !enabled || !count} onClick={() => setConfirmOpen(true)}>
              {count != null ? `Send to ${count} ${count === 1 ? 'person' : 'people'}` : 'Send (preview first)'}
            </Button>
          </div>
        </div>
        <iframe title="Year in Review email preview" sandbox="" srcDoc={html} className="w-full min-h-[480px] rounded-xl border border-subtle bg-white" />
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Send this Year in Review email?"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button icon={Send} onClick={() => { setConfirmOpen(false); runSend(body); }}>Send to {count}</Button>
          </>
        )}
      >
        <p className="text-sm text-secondary">
          “{email.subject}” will be emailed to <strong className="text-primary">{count} {count === 1 ? 'person' : 'people'}</strong> with a {RECAP_YEAR} show. This can’t be undone.
        </p>
      </Modal>
    </Card>
  );
}

export default function AnnouncementsTab({ onViewUnsubscribes }) {
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [extras, setExtras] = useState('');

  const [preview, setPreview] = useState(null); // { counts, invalidSamples, missingConfig }
  const [previewKey, setPreviewKey] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'test' | 'send'
  const [message, setMessage] = useState(null); // { tone: 'ok'|'error', text }
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [progress, setProgress] = useState(null); // { announcementId, counts, remaining, status }
  const [history, setHistory] = useState(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const loadHistory = useCallback(async () => {
    const r = await callAnnouncements({ mode: 'history' });
    if (r.ok) setHistory(r.data.announcements || []);
    else setHistory([]);
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // The count shown on the Send button is only trustworthy for the extra
  // emails it was computed with.
  const extrasKey = extras.trim();
  const previewCurrent = preview && previewKey === extrasKey;

  const previewHtml = useMemo(() => {
    const body = html.trim() || '<p style="color:#9ca3af">Your announcement will appear here.</p>';
    const doc = /<html[\s>]/i.test(body) ? body : wrapEmail(body);
    return injectUnsubscribeFooter(doc, {
      url: '#',
      scope: 'announcements',
      mailingAddress: 'Your mailing address (from MAILING_ADDRESS)',
    });
  }, [html]);

  const handlePreview = async () => {
    setBusy('preview'); setMessage(null);
    try {
      const r = await callAnnouncements({ mode: 'preview', extraEmails: extraLines(extras) });
      if (!r.ok) throw new Error(r.data.error || `Preview failed (${r.status})`);
      setPreview(r.data);
      setPreviewKey(extrasKey);
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test'); setMessage(null);
    try {
      const r = await callAnnouncements({ mode: 'test', subject, html });
      if (!r.ok) throw new Error(r.data.error || `Test send failed (${r.status})`);
      setMessage({ tone: 'ok', text: `Test sent to ${r.data.sentTo}. Check that Gmail shows its Unsubscribe button.` });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const runSend = async (firstBody) => {
    setBusy('send'); setMessage(null);
    let body = firstBody;
    try {
      for (;;) {
        if (cancelled.current) return;
        const r = await callAnnouncements({ mode: 'send', ...body });
        if (r.status === 409 && r.data.busy) {
          // Another window holds the lease; wait for it to hand over.
          setProgress((p) => ({ ...(p || {}), announcementId: r.data.announcementId, counts: r.data.counts, remaining: r.data.remaining, status: 'sending' }));
          await wait(4000);
          body = { announcementId: r.data.announcementId };
          continue;
        }
        if (!r.ok) throw new Error(r.data.error || `Send failed (${r.status})`);
        setProgress(r.data);
        if (!r.data.remaining) break;
        body = { announcementId: r.data.announcementId };
      }
      setMessage({ tone: 'ok', text: 'Announcement sent.' });
    } catch (e) {
      setMessage({ tone: 'error', text: `${e.message} — nothing already sent will be sent again; use Resume to carry on.` });
    } finally {
      setBusy(null);
      loadHistory();
    }
  };

  const confirmSend = () => {
    setConfirmOpen(false);
    setProgress(null);
    runSend({ subject, html, extraEmails: extraLines(extras) });
  };

  const canCompose = subject.trim() && html.trim();
  const missing = preview?.missingConfig || [];
  const sendCount = previewCurrent ? preview.counts.total : null;

  return (
    <div className="space-y-6">
      <RecapEmailCard busy={busy} setBusy={setBusy} runSend={(body) => { setProgress(null); runSend(body); }} />

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-brand" />
          <h2 className="text-lg font-bold text-primary">New announcement</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="MySetlists is on the App Store" maxLength={200} />
            <Textarea
              label="HTML body"
              rows={14}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="<h2>…</h2><p>…</p>"
              className="font-mono text-[13px]"
              hint="Paste the body. It's placed inside the standard MySetlists email wrapper; the unsubscribe link and mailing address are added for each recipient."
            />
            <Textarea
              label="Extra emails (people without accounts)"
              rows={5}
              value={extras}
              onChange={(e) => setExtras(e.target.value)}
              placeholder={'friend@example.com\nanother@example.com'}
              hint="One per line or comma-separated. Anyone who already has an account is matched to it, and anyone who has unsubscribed is left out."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-secondary">Preview</span>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={previewHtml}
              className="w-full min-h-[480px] flex-1 rounded-xl border border-subtle bg-white"
            />
          </div>
        </div>

        {preview && (
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-secondary flex items-center gap-2"><Users className="w-4 h-4" /> Recipients</h3>
            <CountGrid counts={preview.counts} />
            {preview.invalidSamples?.length > 0 && (
              <p className="text-xs text-muted">Invalid: {preview.invalidSamples.join(', ')}</p>
            )}
            {!previewCurrent && <p className="text-xs text-amber">Extra emails changed since this preview — preview again before sending.</p>}
          </div>
        )}

        {missing.length > 0 && (
          <div className="mt-4 flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Sending is disabled until these are set in Netlify: {missing.join(', ')}.</span>
          </div>
        )}

        {message && (
          <div className={`mt-4 flex items-start gap-2 text-sm ${message.tone === 'error' ? 'text-danger' : 'text-brand'}`}>
            {message.tone === 'error' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <Check className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" icon={Eye} loading={busy === 'preview'} disabled={!!busy} onClick={handlePreview}>
            Preview recipients
          </Button>
          <Button variant="secondary" icon={Mail} loading={busy === 'test'} disabled={!!busy || !canCompose} onClick={handleTest}>
            Send test to me
          </Button>
          <Button
            icon={Send}
            loading={busy === 'send'}
            disabled={!!busy || !canCompose || !previewCurrent || !sendCount || missing.length > 0}
            onClick={() => setConfirmOpen(true)}
          >
            {sendCount != null ? `Send to ${sendCount} ${sendCount === 1 ? 'person' : 'people'}` : 'Send (preview first)'}
          </Button>
        </div>
      </Card>

      {progress && (
        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base font-bold text-primary">Sending progress</h3>
            <StatusBadge status={progress.status} />
          </div>
          {progress.counts && (
            <>
              <div className="h-2 rounded-full bg-hover overflow-hidden mb-3">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${progress.counts.total ? Math.round(((progress.counts.total - progress.counts.pending) / progress.counts.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-sm text-secondary">
                {progress.counts.sent} sent · {progress.counts.failed} failed · {progress.counts.skipped} skipped · {progress.counts.pending} remaining of {progress.counts.total}
              </p>
            </>
          )}
          {busy !== 'send' && progress.counts?.failed > 0 && (
            <Button className="mt-4" variant="secondary" icon={RefreshCw} onClick={() => runSend({ announcementId: progress.announcementId, retryFailed: true })}>
              Retry {progress.counts.failed} failed
            </Button>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-primary">Past announcements</h3>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadHistory}>Refresh</Button>
        </div>
        {history === null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : history.length === 0 ? (
          <EmptyState icon={Mail} title="No announcements yet" body="Sent announcements and their results appear here." />
        ) : (
          <div className="divide-y divide-subtle">
            {history.map((a) => (
              <div key={a.id} className="py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-primary truncate">{a.subject}</div>
                  <div className="text-xs text-muted">
                    {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                    {a.counts && ` · ${a.counts.sent} sent · ${a.counts.failed} failed · ${a.counts.skipped} skipped`}
                    {a.counts?.pending > 0 && ` · ${a.counts.pending} remaining`}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={a.status} />
                  <button
                    type="button"
                    onClick={() => onViewUnsubscribes?.(a.id)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {a.unsubscribes} unsubscribed
                  </button>
                  {busy !== 'send' && (a.counts?.pending > 0) && (
                    <Button size="sm" variant="secondary" onClick={() => runSend({ announcementId: a.id })}>Resume</Button>
                  )}
                  {busy !== 'send' && !(a.counts?.pending > 0) && a.counts?.failed > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => runSend({ announcementId: a.id, retryFailed: true })}>Retry failed</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Send this announcement?"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button icon={Send} onClick={confirmSend}>Send to {sendCount}</Button>
          </>
        )}
      >
        <p className="text-sm text-secondary">
          “{subject.trim()}” will be emailed to <strong className="text-primary">{sendCount} {sendCount === 1 ? 'person' : 'people'}</strong>
          {preview && ` (${preview.counts.users} users, ${preview.counts.extras} extra emails)`}. This can’t be undone.
        </p>
      </Modal>
    </div>
  );
}
