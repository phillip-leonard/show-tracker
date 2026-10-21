import ShowsPage from './shows/page';

// Home page only (see the note in app/layout.jsx on why this is not set
// there). Resolved against metadataBase to https://mysetlists.net/.
export const metadata = {
  alternates: { canonical: '/' },
};

// Renders the same content as /shows directly, rather than client-redirecting
// to it. A JS-mediated redirect (router.replace, fired from a mount effect)
// forces a full hard navigation in this static-export app — the entire JS
// bundle, Firebase init, and auth/data waterfall would run twice before any
// real content painted. Rendering ShowsPage here avoids that entirely.
export default function Home() {
  return <ShowsPage />;
}
