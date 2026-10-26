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
// launch can deliver the same link both ways, so a link repeated within a
// couple of seconds is followed once.
//
// A link starts a fresh trail. On a cold launch the app has already shown
// its first screen, and pushing on top of it made back go there (My Shows)
// rather than to the linked screen's parent (a song's band). So the
// in-app history is reset and the link replaces the current entry; back
// then follows lib/navRoutes.js.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/platform';
import { deepLinkTarget } from '@/lib/deepLinks';
import { useDismissStack } from '@/context/DismissStackContext';

export default function DeepLinkListener() {
  const router = useRouter();
  const { resetNavHistory } = useDismissStack();

  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    let live = true;
    let handle = null;
    let last = { url: null, at: 0 };

    const follow = (url) => {
      if (!live || !url) return;
      const now = Date.now();
      if (url === last.url && now - last.at < 2000) return;
      last = { url, at: now };
      const target = deepLinkTarget(url);
      if (!target) return;
      resetNavHistory();
      router.replace(target);
    };

    (async () => {
      const { App } = await import('@capacitor/app');
      if (!live) return;
      handle = await App.addListener('appUrlOpen', (event) => follow(event?.url));
      if (!live) { handle.remove(); return; }
      const launch = await App.getLaunchUrl();
      follow(launch?.url);
    })().catch(() => {
      // No App plugin: the app opens where it would have anyway.
    });

    return () => {
      live = false;
      handle?.remove();
    };
  }, [router, resetNavHistory]);

  return null;
}
