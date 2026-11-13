'use client';

import React, { useEffect, useState } from 'react';
import { callFriends } from '@/lib/friendsApi';
import { Check, Send } from 'lucide-react';
import { Card, Button, Input } from '@/components/ui';

function InviteView({ currentUserUid, currentUser, onSendInvite }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // null | 'success' | 'error' | string (error message)
  const [copyLabel, setCopyLabel] = useState('Copy');

  // The referral link is signed by the server (5.59.7): only links you
  // hand out make the person who signs up your friend automatically.
  const [inviteUrl, setInviteUrl] = useState('https://mysetlists.net');
  useEffect(() => {
    if (!currentUserUid) return undefined;
    let cancelled = false;
    callFriends('referralLink')
      .then((r) => { if (!cancelled && r.url) setInviteUrl(r.url); })
      .catch((err) => console.warn('[invite] Could not load your invite link:', err.message));
    return () => { cancelled = true; };
  }, [currentUserUid]);

  const handleInvite = async () => {
    if (!email.trim() || !currentUserUid || !onSendInvite) return;
    setSending(true);
    setSendStatus(null);
    const result = await onSendInvite(email.trim());
    setSending(false);
    if (result?.success) {
      setSendStatus('success');
      setEmail('');
    } else {
      setSendStatus(result?.error || 'error');
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <Card padding="md">
        <Input
          label="Friend's Email Address"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSendStatus(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
          placeholder="friend@example.com"
          containerClassName="mb-4"
        />
        <Button
          variant="primary"
          full
          icon={sending ? undefined : Send}
          loading={sending}
          onClick={handleInvite}
          disabled={!email.trim() || sending}
        >
          {sending ? 'Sending...' : 'Send Invitation'}
        </Button>

        {sendStatus === 'success' && (
          <div className="mt-3 flex items-center gap-2 text-brand text-sm font-medium">
            <Check className="w-4 h-4" />
            Invite sent! They'll get an email from mysetlists.net.
          </div>
        )}
        {sendStatus && sendStatus !== 'success' && (
          <div className="mt-3 text-danger text-sm">
            {sendStatus === 'error'
              ? 'Something went wrong. Try copying the link below instead.'
              : sendStatus}
          </div>
        )}
      </Card>

      <Card padding="sm" className="mt-8">
        <h3 className="text-sm font-medium text-secondary mb-2">Or share this link:</h3>
        <div className="flex gap-2">
          <Input
            type="text"
            readOnly
            value={inviteUrl}
            containerClassName="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(inviteUrl);
              setCopyLabel('Copied!');
              setTimeout(() => setCopyLabel('Copy'), 2000);
            }}
          >
            {copyLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default InviteView;
