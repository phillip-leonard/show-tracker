'use client';

// What a guest sees in place of the ticket scanner and screenshot import
// (5.59.6). Both call Claude through analyze-tickets / analyze-screenshot,
// which need a signed-in account (netlify/functions/lib/aiScan.js); guests
// have no Firebase session, so the only way forward is an account. CSV /
// Excel import and manual entry stay open to guests.

import { Camera } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Button, EmptyState } from '@/components/ui';

export default function GuestScanPrompt({ compact = false, className = '' }) {
  const { openAuthModal } = useApp();
  return (
    <EmptyState
      icon={Camera}
      tone="brand"
      className={compact ? `!py-6 ${className}` : className}
      title="Create a free account to scan tickets"
      body="Ticket and screenshot scanning read your shows with AI, so they need an account. You can still import a CSV or Excel file, or add shows by hand."
      action={<Button onClick={() => openAuthModal('signup')}>Create free account</Button>}
    />
  );
}
