'use client';

// The "keep your shows" banner (5.59.10, guest rescue). A guest's shows
// live only on this device until they make an account; signing up moves
// them into it (lib/guestMerge.js). Non-blocking: it sits above the page,
// and dismissing it hides it for seven days (RESCUE_SNOOZE_MS).

import { useEffect, useState } from 'react';
import { X, UploadCloud } from 'lucide-react';
import { RESCUE_DISMISSED_KEY, shouldShowRescue } from '@/lib/guestMerge';

function readDismissedAt() {
  try { return window.localStorage.getItem(RESCUE_DISMISSED_KEY); } catch { return null; }
}

export default function GuestRescueBanner({ guestMode, showCount, onCreateAccount }) {
  const [dismissedAt, setDismissedAt] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setDismissedAt(readDismissedAt()); setReady(true); }, []);

  if (!ready || !shouldShowRescue({ guestMode, showCount, dismissedAt })) return null;

  const dismiss = () => {
    const now = String(Date.now());
    try { window.localStorage.setItem(RESCUE_DISMISSED_KEY, now); } catch { /* private mode */ }
    setDismissedAt(now);
  };

  return (
    <div role="status" className="mb-4 md:mb-6 flex items-start gap-3 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3">
      <UploadCloud className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 text-sm">
        <p className="text-primary">
          Create a free account to keep your shows. They&apos;re only saved on this device right now.
        </p>
        <button
          type="button"
          onClick={onCreateAccount}
          className="mt-2 inline-flex min-h-[44px] md:fine:min-h-0 items-center font-medium text-brand hover:underline"
        >
          Create free account
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for now"
        className="-m-2 p-2 min-h-[44px] min-w-[44px] md:fine:min-h-0 md:fine:min-w-0 flex items-center justify-center text-muted hover:text-primary"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
