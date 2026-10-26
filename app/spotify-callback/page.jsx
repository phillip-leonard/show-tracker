'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Music } from 'lucide-react';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';

function SpotifyCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!searchParams) return;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      sendToOpener({ type: 'spotify-callback', error: errorParam });
      return;
    }

    if (code) {
      sendToOpener({ type: 'spotify-callback', code });
    } else {
      setStatus('error');
      setError('No authorization code received from Spotify.');
    }

    function sendToOpener(message) {
      let sent = false;

      // Method 1: BroadcastChannel (works cross-tab, no window.opener needed)
      try {
        const channel = new BroadcastChannel('spotify-auth');
        channel.postMessage(message);
        sent = true;
      } catch (e) {
        // BroadcastChannel not supported
      }

      // Method 2: window.opener.postMessage (works if opener reference exists)
      if (window.opener) {
        try {
          window.opener.postMessage(message, window.location.origin);
          sent = true;
        } catch (e) {
          // opener not available
        }
      }

      if (sent) {
        if (message.error) {
          setStatus('error');
          setError(message.error === 'access_denied'
            ? 'You cancelled the Spotify login.'
            : `Spotify error: ${message.error}`);
        } else {
          setStatus('success');
          setTimeout(() => window.close(), 800);
        }
      } else {
        // Fallback: store in sessionStorage and redirect
        if (message.code) {
          sessionStorage.setItem('spotify_auth_code', message.code);
        }
        window.location.href = '/shows';
      }
    }
  }, [searchParams]);

  return (
    <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base flex items-center justify-center p-4">
      <div className="bg-hover border border-subtle rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="w-12 h-12 rounded-full bg-brand-subtle flex items-center justify-center mx-auto mb-4">
          <Music className="w-6 h-6 text-brand" />
        </div>

        {status === 'processing' && (
          <>
            <h1 className="text-lg font-bold text-primary mb-2">Connecting to Spotify...</h1>
            <div className="h-1 bg-hover rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full animate-pulse w-2/3" />
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 className="text-lg font-bold text-primary mb-2">Connected!</h1>
            <p className="text-sm text-secondary">This window will close automatically...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className="text-lg font-bold text-primary mb-2">Connection Failed</h1>
            <p className="text-sm text-secondary mb-4">{error}</p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-hover hover:bg-hover text-primary rounded-xl text-sm font-medium transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SpotifyCallbackPage() {
  const router = useRouter();

  // Nothing can legitimately reach this route while playlist creation is off
  // (lib/constants.js) — the OAuth flow that redirects here never starts. It
  // stays reachable by deep link and by typing the URL, though, so send it
  // home rather than rendering "Connecting to Spotify...".
  useEffect(() => {
    if (!PLAYLIST_CREATION_ENABLED) router.replace('/');
  }, [router]);

  if (!PLAYLIST_CREATION_ENABLED) return null;

  return (
    <Suspense fallback={
      <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base flex items-center justify-center p-4">
        <div className="bg-hover border border-subtle rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-brand-subtle flex items-center justify-center mx-auto mb-4">
            <Music className="w-6 h-6 text-brand" />
          </div>
          <h1 className="text-lg font-bold text-primary mb-2">Connecting to Spotify...</h1>
        </div>
      </div>
    }>
      <SpotifyCallbackContent />
    </Suspense>
  );
}
