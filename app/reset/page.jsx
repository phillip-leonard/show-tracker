// app/reset/page.jsx — the password reset page (5.60.0).
//
// A real pre-rendered route (out/reset/index.html). The email links to
// /reset/<token>, which netlify.toml 301s to /reset/?token=<token>: under
// the static export there is no /reset/[token] (CLAUDE.md, "Routing").
//
// useSearchParams() needs a Suspense boundary in a static export; the
// fallback is what the exported HTML holds until the page hydrates.

import { Suspense } from 'react';
import ResetPasswordView from '@/components/auth/ResetPasswordView';

function Loading() {
  return (
    <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base flex items-center justify-center">
      <div className="text-muted text-lg">Loading...</div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetPasswordView />
    </Suspense>
  );
}
