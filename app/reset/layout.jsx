// /reset/?token=… — the password reset page (5.60.0). Never indexed, and
// the token in the URL is not passed on to anything it links to.
// netlify.toml sends X-Robots-Tag and Referrer-Policy for it as well.
export const metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetLayout({ children }) {
  return children;
}
