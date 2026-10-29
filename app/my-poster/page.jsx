'use client';

// A signed-in user's "Songs I've heard" poster for any band they've
// logged, at /my-poster/?artist=<name> (lib/showRouting.js myPosterHref).
// A real pre-rendered route reading the query string, like /bands/?band=;
// see CLAUDE.md's routing section. The archive-backed bands link on to
// their full /heard/ tool from here (components/heard/MyPosterView.jsx).

import { useSearchParams } from 'next/navigation';
import MyPosterView from '@/components/heard/MyPosterView';

export default function MyPosterPage() {
  const searchParams = useSearchParams();
  const artist = (searchParams.get('artist') || '').trim();
  return <MyPosterView key={artist} artist={artist} />;
}
