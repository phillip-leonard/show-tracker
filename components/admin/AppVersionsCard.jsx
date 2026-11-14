'use client';

// Admin → Tools → App versions (5.59.10). Sets config/app, which every iOS
// build from 3.13.10 compares itself with (components/layout/VersionGate.jsx):
//   Latest version     builds below it see a dismissible "Update available"
//   Minimum supported  builds below it see a screen they can't dismiss
// Raising the minimum asks for a second, explicit confirmation, because
// it locks older builds out until they update. firestore.rules lets only
// the admin write this document, and only in this shape.

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { APP_CONFIG_DOC, raisesMinimum, validateVersionConfig } from '@/lib/appVersion';

export default function AppVersionsCard() {
  const [current, setCurrent] = useState(null);
  const [min, setMin] = useState('');
  const [latest, setLatest] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getDoc(doc(db, ...APP_CONFIG_DOC)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      setCurrent(data);
      setMin(data.minSupportedIosVersion || '');
      setLatest(data.latestIosVersion || '');
      setReason(data.reason || '');
    }).catch((e) => setMessage(`Couldn't load: ${e.message}`));
  }, []);

  const save = async () => {
    const error = validateVersionConfig({ min: min.trim(), latest: latest.trim() });
    if (error) { setMessage(error); return; }
    if (!confirming && raisesMinimum(current?.minSupportedIosVersion, min.trim())) {
      setConfirming(true);
      setMessage('');
      return;
    }
    setBusy(true);
    try {
      const next = {
        minSupportedIosVersion: min.trim(),
        latestIosVersion: latest.trim(),
        reason: reason.trim().slice(0, 280),
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || '',
      };
      await setDoc(doc(db, ...APP_CONFIG_DOC), next);
      setCurrent({ ...next });
      setConfirming(false);
      setMessage('Saved. Apps check again on their next launch or resume.');
    } catch (e) {
      setMessage(`Couldn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 bg-base border border-subtle rounded-xl text-primary';
  return (
    <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-primary mb-1">App versions (iOS)</h3>
      <p className="text-secondary text-sm mb-4">
        Builds below <strong>Latest</strong> see a dismissible update banner. Builds below
        <strong> Minimum supported</strong> see an update screen they can&apos;t dismiss (Profile and
        account deletion stay reachable). Only 3.13.10 and later check this.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-sm text-secondary">Minimum supported
          <input className={input} value={min} onChange={(e) => { setMin(e.target.value); setConfirming(false); }} placeholder="3.13.10" inputMode="decimal" />
        </label>
        <label className="text-sm text-secondary">Latest
          <input className={input} value={latest} onChange={(e) => setLatest(e.target.value)} placeholder="3.13.10" inputMode="decimal" />
        </label>
      </div>
      <label className="block text-sm text-secondary mb-4">Reason shown on the update screen (optional, 280 characters)
        <input className={input} value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} />
      </label>
      {confirming && (
        <p className="text-sm text-danger mb-3" role="alert">
          This raises the minimum from {current?.minSupportedIosVersion || 'none'} to {min.trim()}. Every iOS build
          below {min.trim()} will be blocked until it updates. Press the button again to confirm.
        </p>
      )}
      <button
        type="button"
        disabled={busy || current === null}
        onClick={save}
        className={`px-4 py-2.5 rounded-xl text-sm font-medium ${confirming ? 'bg-danger text-white' : 'bg-brand-subtle text-brand border border-brand/30'}`}
      >
        {confirming ? 'Yes, raise the minimum' : 'Save versions'}
      </button>
      {message && <p className="text-sm text-secondary mt-3">{message}</p>}
    </div>
  );
}
