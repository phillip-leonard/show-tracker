'use client';

// A user's Year in Review, at /year-in-review/?user=<uid>&year=<yyyy>
// (lib/showRouting.js's yearInReviewHref).
//
// This used to be /year-in-review/[userId]/[year]/, a dynamic route whose
// only pre-rendered page was the `_/_` placeholder, so a reload, a shared
// link or the year-end email landed on the root page instead (see
// CLAUDE.md's routing section). netlify.toml 301s the old shape here.
// Without `user`, it is your own review; without `year`, the default from
// lib/recapLaunch.js (2026 once its recap is live, else last year).
//
// Your own 2026 review is the recap (YearRecapView) from launch, or before
// it for an admin with ?recap=preview. Every other year, and anyone else's
// shared review, keeps the original page (YearInReviewClient).
//
// Signed out, AppProviderWrapper shows the landing page with sign-in open
// and leaves this URL alone, so signing in lands here: the App Store event
// link (https://mysetlists.net/year-in-review/?year=2026) works cold.

import { useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import YearInReviewClient from './YearInReviewClient';
import YearRecapView from '@/components/yearInReview/YearRecapView';
import { defaultReviewYear, usesRecapLayout, recapPreviewRequested } from '@/lib/recapLaunch';

export default function YearInReviewPage() {
  const searchParams = useSearchParams();
  const { user, isAdmin } = useApp();
  const requestedUser = searchParams.get('user');
  const userId = requestedUser || user?.uid || '';
  const year = Number(searchParams.get('year')) || defaultReviewYear();
  if (!userId) return null;

  const own = !!user && userId === user.uid;
  if (own && usesRecapLayout(year, { preview: recapPreviewRequested(searchParams), isAdmin: !!isAdmin })) {
    return <YearRecapView year={year} />;
  }
  return <YearInReviewClient userId={userId} year={year} />;
}
