// Discover is a signed-in view built from the user's own shows; nothing in
// it is for search engines.
export const metadata = {
  title: 'Discover',
  robots: { index: false, follow: false },
};

export default function DiscoverLayout({ children }) {
  return children;
}
