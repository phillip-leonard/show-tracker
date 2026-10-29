// A signed-in user's own poster: never indexed (public/_headers sends
// noindex for this path too). Shared posters live at /p/<code>/, served by
// a function.
export const metadata = {
  title: 'My poster',
  robots: { index: false, follow: false },
};

export default function MyPosterLayout({ children }) {
  return children;
}
