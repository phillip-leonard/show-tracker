// The in-app band and song screens are signed-in views of the public band
// pages. The public /artist/ pages are the ones search engines index;
// these stay out (public/_headers sends noindex for every path not listed
// there too).
export const metadata = {
  title: 'Band stats',
  robots: { index: false, follow: false },
};

export default function BandsLayout({ children }) {
  return children;
}
