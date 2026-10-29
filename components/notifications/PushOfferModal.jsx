'use client';

// components/notifications/PushOfferModal.jsx
//
// The explainer before iOS's own permission prompt, shown the first time
// someone follows a band in the app (context/AppContext.jsx's
// toggleFavoriteArtist, once per device: lib/pushAlerts.js). "Not now"
// never shows the system prompt, so iOS can still ask later from
// "Turn on push alerts" in Notifications settings.

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { requestPushPermission } from '@/lib/pushAlerts';

const STILL_EMAIL = 'No problem. Email alerts still work.';

export default function PushOfferModal({ artist, uid, onDone }) {
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    const state = await requestPushPermission(uid);
    onDone(state === 'granted'
      ? `Push alerts are on. We'll let you know when ${artist} announces a tour.`
      : STILL_EMAIL);
  };

  const notNow = () => onDone(`${STILL_EMAIL} You can turn on push in Notifications settings.`);

  return (
    <Modal
      open
      onClose={notNow}
      title={`Get a push when ${artist} announces a tour?`}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={notNow} disabled={busy}>Not now</Button>
          <Button icon={BellRing} onClick={turnOn} loading={busy}>Turn on push</Button>
        </>
      )}
    >
      <p className="text-secondary text-sm">
        We&rsquo;ll send a push when a band you follow announces a tour or plays a venue on your
        bucket list, and on the anniversary of a show you saw. Nothing else. You can switch push and email separately in Notifications settings.
      </p>
    </Modal>
  );
}
