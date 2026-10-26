'use client';

import Link from 'next/link';

// The support address is in the footer, not only in the Terms and the
// Profile page, because App Store Guideline 1.2 requires published contact
// information a user can reach WITHOUT an account — and the footer is on
// every page including the signed-out landing page, the legal pages and
// the public profile pages.
export default function Footer() {
  return (
    // The bottom padding clears the home indicator; 2rem on the web.
    <div className="mt-auto pt-8 pb-[calc(2rem+var(--safe-bottom))] border-t border-subtle">
      <div className="max-w-6xl mx-auto px-4 text-center">
        <div className="flex items-center justify-center gap-4 text-sm text-muted flex-wrap">
          <Link href="/release-notes" className="hover:text-primary transition-colors">Release Notes</Link>
          <span>&middot;</span>
          <Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          <span>&middot;</span>
          <Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
          <span>&middot;</span>
          <Link href="/cookies" className="hover:text-primary transition-colors">Cookie Policy</Link>
          <span>&middot;</span>
          <a href="mailto:support@mysetlists.net" className="hover:text-primary transition-colors">
            support@mysetlists.net
          </a>
        </div>
        <p className="text-muted text-xs mt-3">
          Report objectionable content or an abusive user from the flag icon in the app, or
          email us — see our{' '}
          <Link href="/terms#community-guidelines" className="underline hover:text-primary transition-colors">
            Community Guidelines
          </Link>.
        </p>
        <p className="text-muted text-xs mt-3">&copy; {new Date().getFullYear()} MySetlists</p>
      </div>
    </div>
  );
}
