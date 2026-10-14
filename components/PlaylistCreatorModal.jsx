'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Check, AlertTriangle, ExternalLink, Music, ChevronDown, Loader2 } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import {
  generateCodeVerifier, generateCodeChallenge, buildSpotifyAuthUrl,
  storeCodeVerifier, getCodeVerifier, storePlaylistContext,
  exchangeCodeForTokens, getAccessToken, getGrantedScopes, hasPlaylistScopes,
  getSpotifyUser, searchSpotifyTrack, createSpotifyPlaylist, addTracksToPlaylist,
  clearSpotifySession,
} from '@/lib/spotify';
import {
  getPlayableSongs, buildSearchQuery, buildAppleMusicSearchQuery,
  findBestMatch, buildPlaylistName, buildPlaylistDescription, delay,
} from '@/lib/playlistCreator';
import { apiUrl } from '@/lib/api';
import { isNativePlatform } from '@/lib/native-auth';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';

// States: select | authenticating | searching | creating | results | error
const SPOTIFY_GREEN = '#1DB954';

function PlaylistCreatorModalInner({ show, onClose }) {
  const [step, setStep] = useState('select');
  const [platform, setPlatform] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, matches: [] });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const channelRef = useRef(null);

  const songs = getPlayableSongs(show.setlist);
  const playlistName = buildPlaylistName(show);

  // Clean up BroadcastChannel and message listener on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
    };
  }, []);

  // --- Spotify Flow ---

  const startSpotifyAuth = useCallback(async () => {
    setPlatform('spotify');
    setStep('authenticating');
    setError(null);

    try {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = crypto.randomUUID();

      storeCodeVerifier(codeVerifier);
      storePlaylistContext(show);

      const authUrl = buildSpotifyAuthUrl(codeChallenge, state);

      // Guard against double-delivery (BroadcastChannel + postMessage both fire)
      let callbackHandled = false;
      const handleCallback = async (data) => {
        if (callbackHandled) return;
        callbackHandled = true;

        if (data.error) {
          setError(data.error === 'access_denied'
            ? 'You cancelled the Spotify login.'
            : `Spotify error: ${data.error}`);
          setStep('error');
          return;
        }

        if (data.code) {
          try {
            const codeVerifier = getCodeVerifier();
            await exchangeCodeForTokens(data.code, codeVerifier);
            await createSpotifyPlaylistFlow();
          } catch (err) {
            setError(err.message || 'Failed to connect to Spotify.');
            setStep('error');
          }
        }
      };

      // --- Native: use in-app browser + custom URL scheme ---
      if (isNativePlatform()) {
        const { Browser } = await import('@capacitor/browser');
        const { App } = await import('@capacitor/app');

        // Listen for custom URL scheme callback (mysetlists://spotify-callback?code=...)
        const urlListener = await App.addListener('appUrlOpen', async (event) => {
          const url = new URL(event.url);
          if (url.pathname === '/spotify-callback' || url.host === 'spotify-callback') {
            urlListener.remove();
            await Browser.close();
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            handleCallback({ code, error });
          }
        });

        await Browser.open({ url: authUrl, presentationStyle: 'popover' });
        return;
      }

      // --- Web: popup + BroadcastChannel ---
      const popup = window.open(authUrl, 'spotify-auth', 'width=500,height=700,scrollbars=yes');

      if (!popup || popup.closed) {
        // Popup blocked — fall back to redirect
        window.location.href = authUrl;
        return;
      }

      const channel = new BroadcastChannel('spotify-auth');
      channelRef.current = channel;

      // Clean up both listeners when either fires first
      const cleanupListeners = () => {
        try { channel.close(); } catch {}
        channelRef.current = null;
        window.removeEventListener('message', handleMessage);
      };

      channel.onmessage = (event) => {
        if (event.data?.type === 'spotify-callback') {
          cleanupListeners();
          handleCallback(event.data);
        }
      };

      // Also listen for window.postMessage as a fallback
      const handleMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'spotify-callback') return;
        cleanupListeners();
        handleCallback(event.data);
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      setError(err.message || 'Failed to start Spotify authentication.');
      setStep('error');
    }
  }, [show]);

  const createSpotifyPlaylistFlow = useCallback(async () => {
    setStep('searching');
    const matches = [];
    const unmatched = [];
    setProgress({ current: 0, total: songs.length, matches: [] });

    try {
      // Verify scopes before proceeding
      if (!hasPlaylistScopes()) {
        const scopes = getGrantedScopes();
        throw new Error(
          `Spotify did not grant playlist permissions. Granted scopes: "${scopes || 'none'}". ` +
          'Try removing MySetlists from your Spotify account (spotify.com/account/apps) and connecting again.'
        );
      }

      // Get user ID
      const user = await getSpotifyUser();

      // Search for each song
      for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const query = buildSearchQuery(song, show.artist);

        let searchResult = null;
        let retries = 0;

        while (retries < 3) {
          try {
            searchResult = await searchSpotifyTrack(query);
            if (searchResult.rateLimited) {
              await delay((searchResult.retryAfter || 5) * 1000);
              retries++;
              continue;
            }
            break;
          } catch (err) {
            retries++;
            if (retries >= 3) break;
            await delay(1000);
          }
        }

        const tracks = searchResult?.tracks || [];
        const bestMatch = findBestMatch(song.name, tracks, song.cover || show.artist);

        const matchEntry = {
          songName: song.name,
          matched: !!bestMatch,
          trackUri: bestMatch?.uri || null,
          trackName: bestMatch?.name || null,
          trackArtist: bestMatch?.artist || null,
        };

        if (bestMatch) {
          matches.push(matchEntry);
        } else {
          unmatched.push(matchEntry);
        }

        setProgress({
          current: i + 1,
          total: songs.length,
          matches: [...matches, ...unmatched],
        });

        // Small delay between requests to respect rate limits
        if (i < songs.length - 1) await delay(200);
      }

      // Create the playlist
      setStep('creating');
      const trackUris = matches.map(m => m.trackUri).filter(Boolean);
      const description = buildPlaylistDescription(show);

      const playlist = await createSpotifyPlaylist(user.id, playlistName, description, false);

      if (!playlist?.id) {
        throw new Error('Failed to create playlist — no playlist ID returned from Spotify.');
      }

      if (trackUris.length > 0) {
        await addTracksToPlaylist(playlist.id, trackUris);
      }

      setResult({
        platform: 'spotify',
        playlistName,
        playlistUrl: playlist.externalUrl,
        matched: matches.length,
        total: songs.length,
        unmatched: unmatched.map(u => u.songName),
      });
      setStep('results');
    } catch (err) {
      setError(err.message || 'Failed to create Spotify playlist.');
      setStep('error');
    }
  }, [show, songs, playlistName]);

  // --- Apple Music Flow ---

  const startAppleMusicAuth = useCallback(async () => {
    setPlatform('apple');
    setStep('authenticating');
    setError(null);

    try {
      // Dynamically import Apple Music helpers
      const appleMusic = await import('@/lib/appleMusic');
      await appleMusic.loadMusicKit();

      // Get developer token from server
      const tokenRes = await fetch(apiUrl('/.netlify/functions/apple-music-token'));
      if (!tokenRes.ok) {
        const errBody = await tokenRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to get Apple Music developer token');
      }
      const { token: developerToken } = await tokenRes.json();

      // Initialize and authorize
      const music = await appleMusic.initMusicKit(developerToken);

      // Search and create playlist
      setStep('searching');
      const matches = [];
      const unmatched = [];
      setProgress({ current: 0, total: songs.length, matches: [] });

      for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const query = buildAppleMusicSearchQuery(song, show.artist);

        try {
          const tracks = await appleMusic.searchTrack(music, query);
          const bestMatch = findBestMatch(song.name, tracks, song.cover || show.artist);

          const matchEntry = {
            songName: song.name,
            matched: !!bestMatch,
            trackId: bestMatch?.id || null,
            trackName: bestMatch?.name || null,
            trackArtist: bestMatch?.artist || null,
          };

          if (bestMatch) {
            matches.push(matchEntry);
          } else {
            unmatched.push(matchEntry);
          }
        } catch {
          unmatched.push({ songName: song.name, matched: false });
        }

        setProgress({
          current: i + 1,
          total: songs.length,
          matches: [...matches, ...unmatched],
        });

        if (i < songs.length - 1) await delay(300);
      }

      // Create playlist
      setStep('creating');
      const trackIds = matches.map(m => m.trackId).filter(Boolean);
      const description = buildPlaylistDescription(show);

      const playlistResult = await appleMusic.createPlaylist(music, playlistName, description, trackIds);

      setResult({
        platform: 'apple',
        playlistName,
        playlistUrl: null, // Apple Music doesn't return a web URL easily
        matched: matches.length,
        total: songs.length,
        unmatched: unmatched.map(u => u.songName),
      });
      setStep('results');
    } catch (err) {
      const msg = err.message || 'Failed to connect to Apple Music.';
      setError(msg.includes('cancelled') || msg.includes('denied')
        ? 'You cancelled the Apple Music login.'
        : msg);
      setStep('error');
    }
  }, [show, songs, playlistName]);

  // --- Retry ---

  const handleRetry = () => {
    setError(null);
    setResult(null);
    setProgress({ current: 0, total: 0, matches: [] });
    setStep('select');
    clearSpotifySession();
  };

  // --- Render ---

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-sidebar/50 backdrop-blur-sm" onClick={onClose}>
      <Card
        variant="elevated"
        padding="none"
        className="w-full max-w-md overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle">
          <h2 className="text-lg font-bold text-primary">Create Playlist</h2>
          <Button variant="ghost" icon={X} onClick={onClose} />
        </div>

        <div className="p-5">
          {/* Platform Select */}
          {step === 'select' && (
            <>
              {/* Show info */}
              <Card variant="inset" padding="none" className="rounded-xl p-4 mb-5">
                <div className="text-sm font-semibold text-primary">{show.artist}</div>
                <div className="text-xs text-secondary mt-1">
                  {show.venue}{show.city ? `, ${show.city}` : ''} &middot; {songs.length} songs
                </div>
              </Card>

              {/* Platform buttons */}
              <div className="space-y-3">
                <button
                  onClick={startSpotifyAuth}
                  disabled={!process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-subtle bg-hover hover:bg-[#1DB954]/10 hover:border-[#1DB954]/30 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${SPOTIFY_GREEN}20` }}>
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill={SPOTIFY_GREEN}>
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                  </div>
                  <div className="text-left flex-1">
                    <div className="text-sm font-semibold text-primary group-hover:text-[#1DB954] transition-colors">Spotify</div>
                    <div className="text-xs text-muted">Create playlist on Spotify</div>
                  </div>
                </button>

                <button
                  onClick={startAppleMusicAuth}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-subtle bg-hover hover:bg-danger/10 hover:border-danger/30 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-danger/20 to-danger/20 flex items-center justify-center">
                    <Music className="w-5 h-5 text-danger" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="text-sm font-semibold text-primary group-hover:text-danger transition-colors">Apple Music</div>
                    <div className="text-xs text-muted">Add to your Apple Music library</div>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* Authenticating */}
          {step === 'authenticating' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ backgroundColor: platform === 'spotify' ? `${SPOTIFY_GREEN}20` : 'rgba(244,63,94,0.15)' }}>
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: platform === 'spotify' ? SPOTIFY_GREEN : '#fb7185' }} />
              </div>
              <h3 className="text-sm font-semibold text-primary mb-1">
                Connecting to {platform === 'spotify' ? 'Spotify' : 'Apple Music'}...
              </h3>
              <p className="text-xs text-muted">Complete the login in the popup window</p>
            </div>
          )}

          {/* Searching / Matching Songs */}
          {step === 'searching' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-primary">Matching songs...</h3>
                <span className="text-xs text-secondary">{progress.current} of {progress.total}</span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-hover rounded-full overflow-hidden mb-4">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                    backgroundColor: platform === 'spotify' ? SPOTIFY_GREEN : '#fb7185',
                  }}
                />
              </div>

              {/* Live match list */}
              <div className="max-h-60 overflow-y-auto space-y-1.5">
                {progress.matches.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {m.matched ? (
                      <Check className="w-3.5 h-3.5 text-brand flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-brand flex-shrink-0" />
                    )}
                    <span className={m.matched ? 'text-secondary' : 'text-muted'}>
                      {m.songName}
                    </span>
                    {m.matched && m.trackArtist && (
                      <span className="text-muted ml-auto truncate max-w-[120px]">
                        {m.trackArtist}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creating playlist */}
          {step === 'creating' && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" style={{ color: platform === 'spotify' ? SPOTIFY_GREEN : '#fb7185' }} />
              <h3 className="text-sm font-semibold text-primary">Creating playlist...</h3>
            </div>
          )}

          {/* Results */}
          {step === 'results' && result && (
            <div>
              {/* Success banner */}
              <div className="bg-brand-subtle border border-brand/20 rounded-xl p-4 mb-4 text-center">
                <Check className="w-8 h-8 text-brand mx-auto mb-2" />
                <h3 className="text-sm font-bold text-primary mb-1">
                  Added {result.matched} of {result.total} songs
                </h3>
                <p className="text-xs text-secondary">{result.playlistName}</p>
              </div>

              {/* Open in Spotify/Apple Music */}
              {result.playlistUrl && (
                <a
                  href={result.playlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm text-primary transition-colors mb-3"
                  style={{
                    backgroundColor: platform === 'spotify' ? SPOTIFY_GREEN : '#fb7185',
                  }}
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in {platform === 'spotify' ? 'Spotify' : 'Apple Music'}
                </a>
              )}

              {!result.playlistUrl && result.platform === 'apple' && (
                <div className="text-center text-xs text-muted mb-3">
                  Open Apple Music to find your new playlist in your library.
                </div>
              )}

              {/* Unmatched songs */}
              {result.unmatched.length > 0 && (
                <Card padding="none" className="overflow-hidden">
                  <button
                    onClick={() => setUnmatchedOpen(!unmatchedOpen)}
                    className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-brand"
                  >
                    <span>{result.unmatched.length} song{result.unmatched.length !== 1 ? 's' : ''} not found</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${unmatchedOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {unmatchedOpen && (
                    <div className="px-4 pb-3 space-y-1">
                      {result.unmatched.map((name, i) => (
                        <div key={i} className="text-xs text-muted flex items-center gap-2">
                          <AlertTriangle className="w-3 h-3 text-brand/50 flex-shrink-0" />
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Done button */}
              <Button variant="ghost" full onClick={onClose} className="mt-4">Done</Button>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="text-center py-6">
              <AlertTriangle className="w-10 h-10 text-brand mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-primary mb-2">Something went wrong</h3>
              <p className="text-xs text-secondary mb-5">{error}</p>
              <div className="flex gap-3">
                <Button variant="primary" full onClick={handleRetry}>Try Again</Button>
                <Button variant="ghost" full onClick={onClose}>Close</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Second lock on the disabled feature. Every call site is gated as well, but a
 * new one added later would otherwise reintroduce it silently.
 *
 * The check lives in a wrapper rather than inside the component: returning
 * early from a component that calls hooks changes how many hooks run between
 * renders, which React forbids.
 */
export default function PlaylistCreatorModal(props) {
  if (!PLAYLIST_CREATION_ENABLED) return null;
  return <PlaylistCreatorModalInner {...props} />;
}
