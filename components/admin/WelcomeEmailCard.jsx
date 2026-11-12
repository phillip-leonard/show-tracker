'use client';

// components/admin/WelcomeEmailCard.jsx
//
// Admin → a user's detail: where their welcome email stands (5.55.0), plus
// a preview of the email and a test send to yourself with sample data.
// The status is userProfiles/{uid}.welcomeEmail, written only by
// netlify/functions/lib/welcomeEmail.js.
//
// Two variants (5.59.4): a Goose show, which gets the "Want more Goose?"
// band line, and a band with no band page, which doesn't. The preview
// renders the sample as is; the test send runs the server's real band
// page lookup for Goose, so it shows whether the live check finds it.

import { useMemo, useState } from 'react';
import { Mail, Eye, Send } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { welcomeEmail, WELCOME_SAMPLES } from '@/lib/emailTemplates';
import { Modal, Tabs } from '@/components/ui';

const VARIANTS = [
  { id: 'band_page', label: 'With band page (Goose)' },
  { id: 'no_band_page', label: 'No band page' },
];

const LABELS = {
  sent: ['Sent', 'text-brand'],
  sending: ['Sending (or stopped mid-send)', 'text-amber'],
  failed: ['Failed', 'text-danger'],
  skipped_opt_out: ['Not sent: emails turned off', 'text-secondary'],
  skipped_no_email: ['Not sent: no email address', 'text-secondary'],
  skipped_existing: ['Not sent: account predates the welcome email', 'text-secondary'],
};

function toDate(at) {
  if (!at) return null;
  if (typeof at.toDate === 'function') return at.toDate();
  const d = new Date(at.seconds ? at.seconds * 1000 : at);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function describeWelcomeEmail(we) {
  if (!we) return { label: 'Not sent yet (no first show since sign-up)', tone: 'text-muted', detail: '' };
  const [label, tone] = LABELS[we.status] || [we.status, 'text-secondary'];
  const parts = [];
  const when = toDate(we.at);
  if (when) parts.push(when.toLocaleString());
  if (we.attempts) parts.push(`attempt ${we.attempts} of 3`);
  if (we.resendId) parts.push(`Resend ${we.resendId}`);
  if (we.error) parts.push(we.error);
  return { label, tone, detail: parts.join(' · ') };
}

export default function WelcomeEmailCard({ profile }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [variant, setVariant] = useState('band_page');
  const [testState, setTestState] = useState(null); // null | 'sending' | { ok, message }
  const status = describeWelcomeEmail(profile?.welcomeEmail);
  const previewHtml = useMemo(
    () => (previewOpen ? welcomeEmail(WELCOME_SAMPLES[variant]).html : ''),
    [previewOpen, variant],
  );
  const variantLabel = VARIANTS.find((v) => v.id === variant).label;

  const sendTest = async () => {
    setTestState('sending');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(apiUrl('/.netlify/functions/send-welcome-email'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, variant }),
      });
      const data = await res.json().catch(() => ({}));
      let bandNote = '';
      if (res.ok && data.variant === 'band_page') {
        bandNote = data.bandPage
          ? ` Band line links to ${data.bandPage.name}'s band page.`
          : ' No band line: the server found no published page for Goose (or the lookup failed).';
      }
      setTestState(res.ok
        ? { ok: true, message: `Test sent to ${data.to}.${bandNote}` }
        : { ok: false, message: data.error || `Failed (${res.status})` });
    } catch (e) {
      setTestState({ ok: false, message: e.message || 'Failed' });
    }
  };

  // The preview Modal sits outside the card: backdrop-blur makes the card
  // the containing block for position: fixed, which clipped the modal to it.
  return (
    <>
      <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
              <Mail className="w-4 h-4" /> Welcome email
            </h3>
            <p className={`text-sm font-medium ${status.tone}`}>{status.label}</p>
            {status.detail && <p className="text-xs text-muted break-words">{status.detail}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => setPreviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-hover hover:bg-active border border-subtle rounded-xl text-sm font-medium text-secondary">
              <Eye className="w-4 h-4" /> Preview
            </button>
            <button type="button" onClick={sendTest} disabled={testState === 'sending'}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand-subtle hover:bg-brand/20 border border-brand/30 rounded-xl text-sm font-medium text-brand disabled:opacity-50">
              <Send className="w-4 h-4" /> {testState === 'sending' ? 'Sending…' : 'Send test to me'}
            </button>
          </div>
        </div>
        <Tabs className="mt-3" tabs={VARIANTS} value={variant} onChange={(id) => { setVariant(id); setTestState(null); }} />
        {testState && testState !== 'sending' && (
          <p className={`mt-2 text-xs ${testState.ok ? 'text-brand' : 'text-danger'}`}>{testState.message}</p>
        )}
      </div>
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Welcome email: ${variantLabel}`} size="lg">
        <iframe title="Welcome email preview" srcDoc={previewHtml} sandbox="" className="w-full h-[70vh] bg-white rounded-xl border border-subtle" />
      </Modal>
    </>
  );
}
