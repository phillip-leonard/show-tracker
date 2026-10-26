'use client';

// components/layout/DeepLinkListener.jsx
//
// Opens the screen a link names when the iOS app is opened by one: a
// universal link (https://mysetlists.net/shows/?show=…) or the custom
// scheme (mysetlists://shows/?show=…). lib/deepLinks.js decides the route;
// this only listens. Renders nothing, and does nothing off native.
//
// Two ways a link arrives: `appUrlOpen` while the app is running (warm),
// and App.getLaunchUrl() for the link that launched it (cold). A cold
// launch can deliver the same link both ways, so a link is followed once.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/platform';
import { deepLinkTarget } from '@/lib/deepLinks';

export default function DeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    let live = true;
    let handle = null;
    let lastUrl = null;

    const follow = (url) => {
      if (!live || !url || url === lastUrl) return;
      lastUrl = url;
      const target = deepLinkTarget(url);
      if (target) router.push(target);
    };

    (async () => {
      const { App } = await import('@capacitor/app');
      if (!live) return;
      handle = await App.addListener('appUrlOpen', (event) => follow(event?.url));
      const launch = await App.getLaunchUrl();
      follow(launch?.url);
    })().catch(() => {
      // No App plugin: the app opens where it would have anyway.
    });

    return () => {
      live = false;
      handle?.remove();
    };
  }, [router]);

  return null;
}
