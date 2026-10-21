'use client';

// A user's Year in Review, at /year-in-review/?user=<uid>&year=<yyyy>
// (lib/showRouting.js's yearInReviewHref).
//
// This used to be /year-in-review/[userId]/[year]/, a dynamic route whose
// only pre-rendered page was the `_/_` placeholder, so a reload, a shared
// link or the year-end email landed on the root page instead (see
// CLAUDE.md's routing section). netlify.toml 301s the old shape here.
// Without `user`, it is your own review; without `year`, last year's.

import { useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import YearInReviewClient from './YearInReviewClient';

export default function YearInReviewPage() {
  const searchParams = useSearchParams();
  const { user } = useApp();
  const userId = searchParams.get('user') || user?.uid || '';
  const year = Number(searchParams.get('year')) || new Date().getFullYear() - 1;
  if (!userId) return null;
  return <YearInReviewClient userId={userId} year={year} />;
}
