// How to Use is a public page (the App Store Support URL, listed in
// sitemap-pages.xml, allowed by public/_headers). It needs its own title,
// description and canonical: without them it inherits the home page's
// title and has no canonical, which reads to Google as a copy of `/`.
//
// The page itself is a client component, so its metadata lives here.

const TITLE = 'How to Use MySetlists: Help & FAQ';
const DESCRIPTION = 'How to add shows, import ticket stubs and spreadsheets, rate songs, read your stats, tag friends and share your profile on MySetlists, plus answers to common questions.';
const PATH = '/how-to-use/';

export const metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // Set in full: a page's openGraph replaces the root layout's.
  openGraph: {
    type: 'article',
    siteName: 'MySetlists',
    url: PATH,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.png'] },
};

export default function HowToUseLayout({ children }) {
  return children;
}
