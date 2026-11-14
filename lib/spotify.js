/**
 * Spotify PKCE OAuth helpers and session token management.
 * All tokens stored in sessionStorage (not localStorage) for security.
 */

import { authedFetch } from '@/lib/api';
import { isNativePlatform } from '@/lib/native-auth';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_SCOPES = 'playlist-modify-public playlist-modify-private';

/**
 * Get the appropriate Spotify redirect URI based on platform.
 * Native apps use the custom URL scheme; web uses origin-based URL.
 */
export function getSpotifyRedirectUri() {
  if (isNativePlatform()) {
    return 'mysetlists://spotify-callback';
  }
  return `${window.location.origin}/spotify-callback`;
}

// --- PKCE helpers ---

export function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- Auth URL ---

export function buildSpotifyAuthUrl(codeChallenge, state) {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error('NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    show_dialog: 'true', // Force consent screen to ensure scopes are granted
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

// --- Session token management ---

const KEYS = {
  CODE_VERIFIER: 'spotify_code_verifier',
  ACCESS_TOKEN: 'spotify_access_token',
  REFRESH_TOKEN: 'spotify_refresh_token',
  TOKEN_EXPIRY: 'spotify_token_expiry',
  TOKEN_SCOPES: 'spotify_token_scopes',
  PLAYLIST_CONTEXT: 'spotify_playlist_context',
};

export function storeCodeVerifier(verifier) {
  sessionStorage.setItem(KEYS.CODE_VERIFIER, verifier);
}

export function getCodeVerifier() {
  return sessionStorage.getItem(KEYS.CODE_VERIFIER);
}

export function storePlaylistContext(show) {
  sessionStorage.setItem(KEYS.PLAYLIST_CONTEXT, JSON.stringify({
    artist: show.artist,
    venue: show.venue,
    city: show.city,
    date: show.date,
    setlist: (show.setlist || []).map(s => ({ name: s.name, cover: s.cover })),
  }));
}

export function getPlaylistContext() {
  try {
    return JSON.parse(sessionStorage.getItem(KEYS.PLAYLIST_CONTEXT));
  } catch {
    return null;
  }
}

export function storeTokens({ access_token, refresh_token, expires_in, scope }) {
  sessionStorage.setItem(KEYS.ACCESS_TOKEN, access_token);
  if (refresh_token) {
    sessionStorage.setItem(KEYS.REFRESH_TOKEN, refresh_token);
  }
  if (scope) {
    sessionStorage.setItem(KEYS.TOKEN_SCOPES, scope);
  }
  const expiryMs = Date.now() + (expires_in * 1000) - 60000; // 1 min buffer
  sessionStorage.setItem(KEYS.TOKEN_EXPIRY, String(expiryMs));
}

export function getGrantedScopes() {
  return sessionStorage.getItem(KEYS.TOKEN_SCOPES) || '';
}

export function hasPlaylistScopes() {
  const scopes = getGrantedScopes();
  return scopes.includes('playlist-modify-public') || scopes.includes('playlist-modify-private');
}

export function getAccessToken() {
  const token = sessionStorage.getItem(KEYS.ACCESS_TOKEN);
  const expiry = Number(sessionStorage.getItem(KEYS.TOKEN_EXPIRY) || 0);
  if (!token || Date.now() > expiry) return null;
  return token;
}

export function getRefreshToken() {
  return sessionStorage.getItem(KEYS.REFRESH_TOKEN);
}

export function clearSpotifySession() {
  Object.values(KEYS).forEach(k => sessionStorage.removeItem(k));
}

// --- Token exchange and refresh via Netlify function ---

export async function exchangeCodeForTokens(code, codeVerifier) {
  const res = await authedFetch('/.netlify/functions/spotify-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'exchange',
      code,
      codeVerifier,
      redirectUri: getSpotifyRedirectUri(),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Token exchange failed');
  }
  const tokens = await res.json();
  storeTokens(tokens);
  return tokens;
}

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token available');
  const res = await authedFetch('/.netlify/functions/spotify-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh', refreshToken }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const tokens = await res.json();
  storeTokens(tokens);
  return tokens;
}

// --- Ensure we have a valid token (refresh if needed) ---

export async function ensureAccessToken() {
  let token = getAccessToken();
  if (token) return token;
  // Try refreshing
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    const tokens = await refreshAccessToken();
    return tokens.access_token;
  }
  throw new Error('Not authenticated with Spotify');
}

// --- Spotify API calls via proxy ---

async function spotifyApiCall(action, params = {}) {
  const accessToken = await ensureAccessToken();
  const res = await authedFetch('/.netlify/functions/spotify-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, accessToken, ...params }),
  });
  const data = await res.json();
  if (res.status === 429) {
    return { rateLimited: true, retryAfter: data.retryAfter || 5 };
  }
  if (!res.ok) {
    throw new Error(data.error || `Spotify API error (${res.status})`);
  }
  return data;
}

export async function getSpotifyUser() {
  return spotifyApiCall('getMe');
}

export async function searchSpotifyTrack(query) {
  return spotifyApiCall('search', { query });
}

export async function createSpotifyPlaylist(userId, name, description, isPublic = true) {
  // Route through Netlify proxy to avoid CORS/development-mode issues
  return spotifyApiCall('createPlaylist', { userId, name, description, isPublic });
}

export async function addTracksToPlaylist(playlistId, trackUris) {
  // Route through Netlify proxy (handles batching server-side)
  return spotifyApiCall('addTracks', { playlistId, trackUris });
}
