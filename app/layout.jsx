import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import AppProviderWrapper from './AppProviderWrapper';
import { HINT_SCRIPT } from '@/lib/signedInHint';

// Self-hosted via next/font: downloaded at build time and served from our
// own origin, so there's no render-blocking request to fonts.googleapis.com
// (previously a <link rel="stylesheet"> in <head> plus two preconnects).
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

// The social preview image. A PNG because Facebook, LinkedIn, iMessage,
// Slack and X ignore SVG for og:image. Source and render step:
// scripts/og-image.svg and scripts/render-og-image.js.
const OG_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'MySetlists — track your concert journey and share the memories',
};

const SITE_TITLE = 'MySetlists – Concert Tracker & Setlist Log for Jam Band Fans';
const SITE_DESCRIPTION = 'Track every show you\'ve seen, rate songs and jams, follow song gaps, and share shows with friends. Built for Phish, Goose, Dead & Co and Widespread Panic fans.';

export const metadata = {
  title: {
    default: SITE_TITLE,
    template: '%s — MySetlists',
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL('https://mysetlists.net'),
  // No `alternates.canonical` here: every route inherits the root layout's
  // metadata, so a canonical set here would declare /terms, /privacy and
  // the rest duplicates of the home page. The home page sets its own in
  // app/page.jsx.
  openGraph: {
    type: 'website',
    siteName: 'MySetlists',
    url: 'https://mysetlists.net/',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MySetlists',
  },
};

export const viewport = {
  themeColor: '#1f1f3a',
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the script below may add data-auth-hint to
    // <html> before React hydrates it, which is the point.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint: hide the landing page for a returning
            signed-in user. See lib/signedInHint.js. */}
        <script dangerouslySetInnerHTML={{ __html: HINT_SCRIPT }} />
      </head>
      <body className={plusJakartaSans.className}>
        {/* No <Suspense> around the providers, on purpose. One used to sit
            here with a "Loading..." fallback, and because AppProvider read
            useSearchParams(), that fallback was the whole of every exported
            page — all Google ever saw. Search params are now read in
            components/SearchParamsListener.jsx, inside a boundary of its
            own. Without a boundary here, a new useSearchParams() call in the
            providers fails `next build` instead of silently blanking every
            page again. */}
        <AppProviderWrapper>
          {children}
        </AppProviderWrapper>
      </body>
    </html>
  );
}
