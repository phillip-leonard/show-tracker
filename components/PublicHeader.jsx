// components/PublicHeader.jsx
//
// The header of the pages a signed-out visitor can read without the app
// shell: the comparison pages (components/compare/ComparePage.jsx) and
// How to Use when nobody is signed in (app/how-to-use/page.jsx). Wordmark
// home, and a sign-up button.
//
// No hooks, so it renders in a server component too.

import Link from 'next/link';
import { SIGNUP_HREF } from '@/lib/comparePages';

export default function PublicHeader() {
  return (
    <header className="bg-black/20 backdrop-blur-xl border-b border-subtle pt-safe-top">
      <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="text-2xl font-extrabold tracking-tight hover:opacity-80 transition-opacity">
          <span className="font-light text-muted">my</span><span className="text-amber">setlists</span>
        </Link>
        <Link
          href={SIGNUP_HREF}
          className="inline-flex items-center min-h-touch px-4 py-2 rounded-xl text-sm font-semibold bg-brand text-[#1f1f3a] hover:opacity-90 transition-opacity"
        >
          Start tracking
        </Link>
      </div>
    </header>
  );
}
