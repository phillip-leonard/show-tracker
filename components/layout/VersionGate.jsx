'use client';

// The iOS minimum-version banner and screen (5.59.10). Native only; renders
// nothing on the web.
//
// On launch and every resume it reads config/app and compares this
// build's version (App.getInfo().version, the CFBundleShortVersionString)
// with it (lib/appVersion.js):
//   below latestIosVersion        → a dismissible "Update available" banner
//                                   (dismissed per latest version)
//   below minSupportedIosVersion  → a screen that can't be dismissed, with
//                                   the App Store link and a short reason
// Profile, where account deletion lives, is never covered (the screen
// links to it). A config that is missing, unreadable or malformed changes
// nothing.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isNativePlatform } from '@/lib/platform';
import { APP_STORE_URL } from '@/lib/comparePages';
import { openExternalUrl } from '@/lib/publicProfile';
import { APP_CONFIG_DOC, alwaysReachable, versionStatus } from '@/lib/appVersion';

const DISMISSED_KEY = 'mysetlists_update_banner_dismissed';

function readDismissed() {
  try { return window.localStorage.getItem(DISMISSED_KEY) || ''; } catch { return ''; }
}

export default function VersionGate() {
  const pathname = usePathname();
  const [state, setState] = useState({ status: 'ok', latest: '', reason: '' });
  const [dismissed, setDismissed] = useState('');

  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    let live = true;
    let handle;
    setDismissed(readDismissed());

    const check = async () => {
      try {
        const { App } = await import('@capacitor/app');
        const [info, snap] = await Promise.all([App.getInfo(), getDoc(doc(db, ...APP_CONFIG_DOC))]);
        if (!live) return;
        const cfg = snap.exists() ? snap.data() : {};
        setState({
          status: versionStatus({ current: info?.version, min: cfg.minSupportedIosVersion, latest: cfg.latestIosVersion }),
          latest: String(cfg.latestIosVersion || ''),
          reason: typeof cfg.reason === 'string' ? cfg.reason.slice(0, 280) : '',
        });
      } catch {
        // Offline, no plugin, rules: carry on as before.
      }
    };

    check();
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        if (!live) return;
        handle = await App.addListener('resume', check);
        if (!live) handle.remove();
      } catch { /* no App plugin */ }
    })();

    return () => { live = false; handle?.remove?.(); };
  }, []);

  const openStore = () => openExternalUrl(APP_STORE_URL);

  if (state.status === 'blocked' && !alwaysReachable(pathname)) {
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="version-gate-title"
        className="fixed inset-0 z-[100] bg-base flex items-center justify-center p-safe-gutter [--gutter:1.5rem]">
        <div className="max-w-sm w-full text-center">
          <h2 id="version-gate-title" className="text-xl font-bold text-primary mb-3">Please update MySetlists</h2>
          <p className="text-secondary mb-2">
            This version of the app is no longer supported. Update to keep using MySetlists. Your shows are safe in your account.
          </p>
          {state.reason && <p className="text-secondary text-sm mb-2">{state.reason}</p>}
          <button type="button" onClick={openStore}
            className="mt-4 w-full min-h-[44px] px-4 py-3 bg-gradient-to-r from-brand to-amber text-primary rounded-xl font-medium">
            Update on the App Store
          </button>
          <Link href="/profile/" className="mt-4 inline-flex min-h-[44px] items-center text-sm text-muted hover:text-primary underline">
            Account settings and deletion
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'blocked' || (state.status === 'update' && dismissed !== state.latest)) {
    const blocking = state.status === 'blocked';
    return (
      <div role="status"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        className="fixed left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[70] flex items-center gap-3 rounded-2xl border border-brand/30 bg-elevated shadow-2xl px-4 py-2 text-sm">
        <p className="flex-1 text-primary">
          {blocking ? 'This version is no longer supported.' : 'A new version of MySetlists is available.'}
        </p>
        <button type="button" onClick={openStore} className="min-h-[44px] font-medium text-brand hover:underline">Update</button>
        {!blocking && (
          <button type="button" aria-label="Dismiss" className="min-h-[44px] min-w-[44px] text-muted hover:text-primary"
            onClick={() => {
              try { window.localStorage.setItem(DISMISSED_KEY, state.latest); } catch { /* private mode */ }
              setDismissed(state.latest);
            }}>
            ✕
          </button>
        )}
      </div>
    );
  }

  return null;
}
