'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Upcoming Shows was removed in 5.40.0. This route stays as a pre-rendered
// file only so an old link or bookmark lands on My Shows rather than
// falling through to whatever serves a missing path — Netlify's catch-all
// on the web, the bundled local server on iOS (see CLAUDE.md's routing
// section). On the web, netlify.toml also 301s /upcoming before this page
// is ever served; this client-side redirect is what covers the native app.
//
// The per-artist "Upcoming Shows" panel (components/UpcomingShows.jsx, in
// My Shows' By-artist rows and in SetlistEditor) is a separate feature and
// is unaffected.
export default function UpcomingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/shows/');
  }, [router]);
  return null;
}
