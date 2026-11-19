"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import SearchParamsListener from '@/components/SearchParamsListener';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { nativeOAuthSignIn, isNativePlatform, nativeSignOut } from '@/lib/native-auth';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  serverTimestamp, onSnapshot, query, where, addDoc, writeBatch, runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, browserPopupRedirectResolver } from '@/lib/firebase';
import { parseDate } from '@/lib/utils';
import { isAdminUser } from '@/lib/adminAccess';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { setSignedInHint, clearSignedInHint } from '@/lib/signedInHint';
import { apiUrl, apiErrorMessage, authedFetch } from '@/lib/api';
import { loadAlertSettings } from '@/lib/alertSettings';
import { showHref, upcomingShowHref } from '@/lib/showRouting';
import {
  UPCOMING_COLLECTION, normalizeUpcomingInput, validateUpcomingInput, sortUpcoming,
  findSetlistForDate,
  newUpcomingRecord, upcomingUpdate, findDuplicateUpcoming,
} from '@/lib/upcomingShows';
import { isReturningUser as checkIsReturningUser } from '@/lib/popupManager';
import { fetchBandSetlistResponse } from '@/lib/bandSetlist';
import { SETLIST_SOURCES } from '@/lib/setlistSources';
import { applySetlistEdit } from '@/lib/setlistEdits';
import { joinedFestival } from '@/lib/festivalCatalog';
import { callFestivals, mintAttendanceId } from '@/lib/festivalsApi';
import { logRating } from '@/lib/activityFeed';
import { rememberHeardShows } from '@/lib/heardLinks';
import { syncPushToken, forgetPushToken, shouldOfferPush, markPushOffered, pushPermission } from '@/lib/pushAlerts';
import {
  subscribeBlocks, blockUser as blockUserDoc, unblockUser as unblockUserDoc,
  withoutBlocked,
} from '@/lib/moderation';
import {
  TERMS_VERSION, fetchTermsAcceptance, getPendingAcceptance,
  recordTermsAcceptance,
} from '@/lib/terms';
import { saveDisplayName } from '@/lib/handles';
import { buildSongStats } from '@/lib/songCounts';
import { applyShowFilters, availableYearsFor } from '@/lib/showFilters';
import { sendNotification } from '@/lib/email';
import { callFriends } from '@/lib/friendsApi';
import { isFirstShowTransition, requestWelcomeEmail } from '@/lib/welcomeEmailTrigger';
import { sweepExpiredSetlistfmCaches } from '@/lib/setlistfmLocalCache';
import { signInLeavesRoute } from '@/lib/deepLinks';
import { toIsoDate, showYear } from '@/lib/showDate';
import { performSignOut } from '@/lib/signOutFlow';
import { pushOfferEnabled } from '@/lib/appConfig';
import { clearSpotifySession } from '@/lib/spotify';
import { mintShowId } from '@/lib/showDoc';
import { normalizeShowInput } from '@/lib/normalizeShow';
import { showDataFromSetlistfmRow } from '@/lib/showInputs';
import {
  commitShowInputs, OfflineError, readOutbox, addToOutbox, removeFromOutbox, deviceShowWrite, possibleDuplicateQuestion,
} from '@/lib/showAdd';
import { venueCountKey } from '@/lib/venueCount';
import { mergeShowsSnapshot, startShowsListener } from '@/lib/liveShows';
import { computeUserStats, STATS_VERSION } from '@/lib/stats';
import { bandKey, songKey } from '@/lib/stats/keys';
import { mergeGuestShows, mergeMessage, readLocalShows } from '@/lib/guestMerge';
import { classifyDuplicate, showMatchKey } from '@/lib/showIdentity';

// ── Helper: mint a show document id ─────────────────────────────────────
// Where a sign-in from the Songs I've heard tool may return to: a band's
// poster, nothing else (see pendingNext below).
const HEARD_NEXT = /^\/heard\/[a-z0-9-]+\/\?mine=1$/;

// mintShowId and buildShowDoc, the one place a show document's shape is
// defined, live in lib/showDoc.js (5.59.10) so the festival import and the
// guest merge build shows exactly as addShow does, and tests can reach them.

// The Firestore half of the same path. `createdAt` is replaced with a
// server timestamp on the way in (the local ISO string above is what the
// in-memory copy carries until the next load).
async function writeShowDoc(uid, show) {
  const { id, ...showData } = show;
  if (showData.date) showData.date = toIsoDate(showData.date) || showData.date;
  await setDoc(doc(db, 'users', uid, 'shows', id), { ...showData, createdAt: serverTimestamp() });
}

// ── Helpers: pending tags a tagger takes back ───────────────────────────
// On the server since 5.60.29 (friends.js revokeTag): status 'revoked'
// rather than a delete, so the recipient's list drops it and the record
// stays for the account-deletion purge. Best-effort: a failure here never
// blocks the action that triggered it.
async function revokeUpcomingTags(upcomingId, toUid = null) {
  try {
    await callFriends('revokeTag', toUid ? { upcomingId, toUid } : { upcomingId });
  } catch (e) {
    console.error('Failed to revoke pending tags:', e);
  }
}

// ── Helper: update the user's profile doc with current stats ────────────
async function updateUserProfile(user, shows = []) {
  if (!user) return;

  const profileRef = doc(db, 'userProfiles', user.uid);

  // displayName and firstName are deliberately NOT written here any more.
  //
  // This function runs on every load and after every add/delete, and it
  // mirrored whatever Firebase Auth held into the profile — which made it
  // the last unfiltered path to the most widely published string in the
  // app. Auth's displayName is set by updateProfile() on the client and
  // no Firestore rule can reach it, so the only way to make the filter a
  // gate is for the profile to stop trusting it. The name is established
  // once, server-side and filtered, by syncProfileName() in the auth
  // listener, and changed only through saveDisplayName(); firestore.rules
  // now rejects a client write that changes either field.
  const profileData = {
    // The owner's uid under its correct name, and under the misspelled
    // name older builds wrote (B-03). Nothing reads either from the
    // profile (the doc id is the uid); both are written until the old
    // name is dropped everywhere.
    userId: user.uid,
    odubleserId: user.uid,
    // No `email` (5.59.7, S-01): every signed-in user can read profiles.
    // The address lives in Firebase Auth; the server reads it from there.
    photoURL: user.photoURL || '',
    lastLogin: serverTimestamp(),
    // No counts since 5.59.15 (B-05): showCount, songCount, ratedSongCount
    // and venueCount are computed on the server into userStats and
    // publicUserStats. iOS 3.13.14 and earlier still write them here; the
    // rules allow it and nothing reads them.
  };

  const existingProfile = await getDoc(profileRef);
  if (!existingProfile.exists()) {
    profileData.createdAt = serverTimestamp();
  }

  await setDoc(profileRef, profileData, { merge: true });
}

// ── Helper: stamp createdAt on a brand-new profile (v5.44.0) ────────────
// updateUserProfile() only writes createdAt when the profile does not
// exist yet, but since 5.36.2 sign-in writes to the profile first (terms
// acceptance, then the server-side name sync), so by the time it runs the
// document already exists and createdAt was never written. This runs at
// the very top of the signed-in branch of the auth listener, before any
// of those writes, so a new account's profile is created carrying its
// real signup date: Auth's creationTime, not the moment of this write.
//
// Forward-only by design: an existing profile is left alone, even one
// missing createdAt. The admin Users tab reads signup dates from Auth
// (netlify/functions/admin-list-auth-users.js) and does not depend on it.
async function ensureProfileCreatedAt(user) {
  if (!user) return;
  const profileRef = doc(db, 'userProfiles', user.uid);
  const existing = await getDoc(profileRef);
  if (existing.exists()) return;
  const authCreated = new Date(user.metadata?.creationTime || '');
  await setDoc(profileRef, {
    createdAt: Number.isNaN(authCreated.getTime()) ? serverTimestamp() : Timestamp.fromDate(authCreated),
  }, { merge: true });
}

// The community leaderboard (communityStats/global) is rebuilt on a schedule
// by netlify/functions/community-stats.js (5.52.1). Clients only read it;
// firestore.rules denies every client write.

// ── Context ─────────────────────────────────────────────────────────────
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  // Filled in by <SearchParamsListener> below rather than read with
  // useSearchParams() here: this provider wraps every route, and reading
  // them here kept every page out of the static HTML (see that file).
  // Null until the first commit; both effects that read it already wait
  // for it.
  const [searchParams, setSearchParams] = useState(null);

  // ── Core state ──────────────────────────────────────────────────────
  const [shows, setShows] = useState([]);
  // The shows as of the last add, for addShow called in a loop (the file
  // import, a ticket scan): each call's `shows` is the render it was
  // created in, so building on it made every add in the loop replace the
  // one before. A guest's import kept only its last show.
  const latestShows = useRef(shows);
  latestShows.current = shows;
  // Progress of an in-flight bulk tour add (see addShowsFromTour). Lives
  // here rather than in the modal so the run survives the modal closing.
  // null when nothing is running.
  const [bulkAdd, setBulkAdd] = useState(null);
  // The user's festivals, each one a per-user *attendance* record joined to
  // the shared canonical festival it points at — see the Festival CRUD
  // section for both shapes. Replaces the fully per-user festivals of
  // 5.28.0 (CHANGELOG 5.30.0) and, before those, the auto-detected
  // isFestival/festivalName tagging on Show.
  const [festivals, setFestivals] = useState([]);
  // True until the first Firestore read of the festivals subcollection
  // resolves, so a direct link to /festivals/?festival=<id> shows a loading
  // state instead of flashing "Festival not found" before the list arrives.
  const [festivalsLoading, setFestivalsLoading] = useState(true);
  const [activeView, setActiveView] = useState('shows');
  const [statsTab, setStatsTab] = useState('years');
  const [friendsInitialTab, setFriendsInitialTab] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // Set by BucketListView's "Mark Attended" before navigating to /shows —
  // read once by app/shows/page.jsx to prefill + open ShowForm, then cleared.
  const [bucketListPrefill, setBucketListPrefill] = useState(null);
  const [selectedShow, setSelectedShow] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [shareSuccess, setShareSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // The uid whose shows are in `shows`. isLoading is already false while
  // signed out, so it alone can't say a fresh sign-in's shows have arrived.
  const [showsLoadedFor, setShowsLoadedFor] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [selectedArtist, setSelectedArtist] = useState(null);

  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authModal, setAuthModal] = useState(null); // null | 'login' | 'signup' | 'forgot-password'
  const [guestMode, setGuestMode] = useState(() => !!storage.get(STORAGE_KEYS.GUEST_SESSION));
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Account age tracking (millis since epoch, from Firestore userProfile.createdAt)
  const [userCreatedAt, setUserCreatedAt] = useState(null);

  // Account-age eligibility — true if account ≥ 7 days old (must be before tooltip useEffect)
  const isReturningUser = useMemo(() => checkIsReturningUser(userCreatedAt), [userCreatedAt]);

  // ── Navigation ──────────────────────────────────────────────────────
  // In Next.js the active view is determined by the pathname.
  // navigateTo pushes a new route instead of setting ?view= query params.
  const navigateTo = (view) => {
    setActiveView(view);
    router.push('/' + view + '/');
  };

  // Capture invite referral from URL param (?ref=uid) and persist in storage
  useEffect(() => {
    if (!searchParams) return;
    const refUid = searchParams.get('ref');
    if (refUid) {
      storage.set(STORAGE_KEYS.INVITE_REFERRER, refUid);
      // Clean ?ref from URL while keeping other params
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('ref');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
  }, [searchParams]);

  // "Follow on MySetlists" from a public band page (/artist/<slug>/) links
  // to /shows/?follow=<band name>. Kept in storage rather than acted on
  // here, so it survives the sign-up a signed-out visitor goes through
  // first; applied by the effect next to followBand below.
  useEffect(() => {
    if (!searchParams) return;
    const band = (searchParams.get('follow') || '').trim();
    if (band) {
      storage.set(STORAGE_KEYS.PENDING_FOLLOW, band.slice(0, 200));
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('follow');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
  }, [searchParams]);

  // "Save these shows to MySetlists (free)" on /heard/<slug>/ (the Songs
  // I've heard tool) links to /shows/?signup=1&heard=<slug>.<code>. Kept
  // in storage like ?follow= so it survives the sign-up, and in state too,
  // because with site data blocked storage keeps nothing and the sign-up
  // happens without a page load. components/heard/HeardSaveModal.jsx picks
  // it up once someone is signed in.
  const [pendingHeard, setPendingHeard] = useState(null);
  useEffect(() => {
    if (!searchParams) return;
    const value = (searchParams.get('heard') || '').trim();
    if (/^[a-z0-9-]+\.[ab][A-Za-z0-9_-]+$/.test(value) && value.length <= 2100) {
      storage.set(STORAGE_KEYS.PENDING_HEARD, value);
      setPendingHeard(value);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('heard');
      window.history.replaceState({}, '', cleanUrl.toString());
    } else {
      const saved = storage.get(STORAGE_KEYS.PENDING_HEARD);
      if (saved) setPendingHeard(saved);
    }
  }, [searchParams]);
  const clearPendingHeard = () => {
    storage.remove(STORAGE_KEYS.PENDING_HEARD);
    setPendingHeard(null);
  };

  // On the web the tool shares this origin, so it can pre-tick the shows
  // the user already has (lib/heardLinks.js). Native has no use for it.
  useEffect(() => {
    if (isNativePlatform() || !user || guestMode) return;
    rememberHeardShows(shows);
  }, [shows, user, guestMode]);

  // "Start tracking your shows" on the comparison pages links to
  // /?signup=1: open the sign-up form once auth knows nobody is signed in.
  // A signed-in visitor just lands on their shows.
  useEffect(() => {
    if (!searchParams || authLoading || searchParams.get('signup') === null) return;
    if (!user) setAuthModal('signup');
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('signup');
    window.history.replaceState({}, '', cleanUrl.toString());
  }, [searchParams, authLoading, user]);

  // "Sign in" on the Songs I've heard tool (/heard/<slug>/?mine=1, signed
  // out) links to /?login=1&next=/heard/<slug>/?mine=1. Open the sign-in
  // form, and once the user's shows have loaded, write them where the tool
  // reads them (lib/heardLinks.js) and go back to the poster. `next` is
  // kept like ?follow= is, through the sign-in, for 30 minutes (so a
  // sign-in abandoned today doesn't redirect next week's), and is only ever
  // a /heard/ poster: never an open redirect. Web only; the tool isn't in
  // the app.
  const [pendingNext, setPendingNext] = useState(null);
  useEffect(() => {
    if (!searchParams || authLoading) return;
    const login = searchParams.get('login') !== null;
    const next = searchParams.get('next') || '';
    if (!login && !next) {
      const [at, saved] = (storage.get(STORAGE_KEYS.PENDING_NEXT) || '').split('|');
      if (saved && HEARD_NEXT.test(saved) && Date.now() - Number(at) < 30 * 60 * 1000) setPendingNext(saved);
      else storage.remove(STORAGE_KEYS.PENDING_NEXT);
      return;
    }
    if (login && !user) setAuthModal('login');
    if (HEARD_NEXT.test(next)) {
      storage.set(STORAGE_KEYS.PENDING_NEXT, `${Date.now()}|${next}`);
      setPendingNext(next);
    }
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('login');
    cleanUrl.searchParams.delete('next');
    window.history.replaceState({}, '', cleanUrl.toString());
  }, [searchParams, authLoading, user]);

  useEffect(() => {
    if (!pendingNext || !user || guestMode || isNativePlatform() || showsLoadedFor !== user.uid || isLoading) return;
    storage.remove(STORAGE_KEYS.PENDING_NEXT);
    setPendingNext(null);
    rememberHeardShows(shows);
    window.location.assign(pendingNext);
  }, [pendingNext, user, guestMode, showsLoadedFor, isLoading, shows]);

  // Deep link: handle ?tab= parameter for navigating to specific tab after login
  // e.g. /friends?tab=requests from email notification links
  const [pendingDeepLink, setPendingDeepLink] = useState(null);

  useEffect(() => {
    if (!searchParams) return;
    const tab = searchParams.get('tab');
    if (tab) {
      if (user) {
        // Already logged in — navigate immediately
        setFriendsInitialTab(tab);
      } else {
        // Store for after login
        setPendingDeepLink({ tab, path: pathname });
      }
      // Clean ?tab from URL
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('tab');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // After login, apply pending deep link
  useEffect(() => {
    if (user && pendingDeepLink) {
      setFriendsInitialTab(pendingDeepLink.tab);
      if (pendingDeepLink.path) {
        router.push(pendingDeepLink.path);
      }
      setPendingDeepLink(null);
    }
  }, [user, pendingDeepLink]); // eslint-disable-line react-hooks/exhaustive-deps

  // Community stats
  const [communityStats, setCommunityStats] = useState(null);
  const [userRank, setUserRank] = useState(null);

  // Setlist scanning
  const [setlistScanning, setSetlistScanning] = useState(false);
  const [setlistScanProgress, setSetlistScanProgress] = useState({ current: 0, total: 0, found: 0 });

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Friends feature state
  const [friends, setFriends] = useState([]);
  const [pendingFriendRequests, setPendingFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [incomingShowTags, setPendingShowTags] = useState([]);
  // Upcoming shows (5.43.0) — users/{uid}/upcomingShows, kept out of
  // `shows` so nothing that counts shows can count them. See
  // lib/upcomingShows.js.
  const [upcomingShows, setUpcomingShows] = useState([]);
  // False until the first snapshot lands, so a deep link to an upcoming
  // show waits instead of flashing "not found".
  const [upcomingLoaded, setUpcomingLoaded] = useState(false);
  const [tagFriendsShow, setTagFriendsShow] = useState(null);

  // Show Suggestions
  const [showSuggestions, setShowSuggestions] = useState([]);

  // Pending Invites
  const [pendingInvites, setPendingInvites] = useState([]);
  const [inviteStats, setInviteStats] = useState(null);
  // Pending email tags sent by this user (to non-members)
  const [sentPendingEmailTags, setSentPendingEmailTags] = useState([]);

  // Blocked accounts (Guideline 1.2). Held here rather than read at each
  // render site so that filtering blocked users out is something the
  // selectors below do once, not something every new surface has to
  // remember to do — see withoutBlocked() in lib/moderation.js.
  const [blockedUserIds, setBlockedUserIds] = useState([]);

  // Terms agreement (Guideline 1.2). Three states, and the third matters:
  // `null` means "not resolved yet". The gate renders only on an explicit
  // `false`, so it cannot flash over the app for the moment between
  // sign-in and the profile read coming back.
  const [termsAccepted, setTermsAccepted] = useState(null);

  // Ejected accounts (Guideline 1.2). Same tri-state as termsAccepted and
  // for the same reason: `null` means unresolved, and the suspended
  // screen must not flash over a normal user while the profile read is
  // still in flight.
  const [isSuspended, setIsSuspended] = useState(null);

  // Followed bands. Stored as userProfiles.favoriteArtists, the field's name
  // from before 5.46.0, when following was "favoriting" and did nothing.
  const [favoriteArtists, setFavoriteArtists] = useState([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  // In-app notifications
  const [unreadNotifications, setUnreadNotifications] = useState([]);

  // Admin
  // UI gating only; the server and the rules enforce (lib/adminAccess.js).
  const isAdmin = isAdminUser(user);

  // Derived friends data. Blocked users are stripped here, at the one
  // place friendUids is derived, so every consumer of it — the activity
  // feed query, the tag picker, Shows Together — inherits the block
  // without knowing blocks exist.
  const friendUids = useMemo(
    () => friends.map(f => f.friendUid).filter(uid => !blockedUserIds.includes(uid)),
    [friends, blockedUserIds],
  );

  const isBlocked = useCallback(
    (uid) => !!uid && blockedUserIds.includes(uid),
    [blockedUserIds],
  );

  // Friend cards, tag suggestions and the friends grid all read this
  // rather than `friends` directly, so a blocked account disappears from
  // the UI without a separate filter at each site.
  const visibleFriends = useMemo(
    () => friends.filter(f => !blockedUserIds.includes(f.friendUid)),
    [friends, blockedUserIds],
  );

  // A pending tag from someone you've since blocked is their content in
  // front of you, so it goes the same way as their comments and photos.
  // Blocking also drops the friendship both ways, so they can't send new ones.
  const pendingShowTags = useMemo(
    () => withoutBlocked(incomingShowTags, blockedUserIds, 'fromUid'),
    [incomingShowTags, blockedUserIds],
  );

  // Derived suggestion state
  const myPendingSuggestions = showSuggestions.filter(s => s.responses?.[user?.uid] === 'pending' && s.overallStatus !== 'declined');
  const myConfirmedSuggestions = showSuggestions.filter(s => s.overallStatus === 'confirmed');

  const pendingNotificationCount = pendingInvites.length + pendingFriendRequests.length;

  // Post-signup welcome + pending tags
  const [welcomeState, setWelcomeState] = useState(null);
  const [pendingTagsForReview, setPendingTagsForReview] = useState([]);

  // Global toast notification
  const [toast, setToast] = useState(null);

  // The band whose follow is offering push alerts (iOS, first follow only;
  // components/notifications/PushOfferModal.jsx), or null.
  const [pushOffer, setPushOffer] = useState(null);

  // This iPhone's push token, refreshed on launch and on sign-in. Never asks
  // for permission (lib/pushAlerts.js).
  useEffect(() => {
    if (user?.uid) syncPushToken(user.uid);
  }, [user?.uid]);

  // Venue rating modal
  const [venueRatingShow, setVenueRatingShow] = useState(null);

  useEffect(() => {
    if (!toast) return;
    // A toast with an action stays up long enough to reach for it.
    const t = setTimeout(() => setToast(null), toast?.href ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear friendsInitialTab when navigating away from friends
  useEffect(() => {
    if (activeView !== 'friends') {
      setFriendsInitialTab(null);
    }
  }, [activeView]);

  // setlist.fm responses cached on this device expire after 24 hours; drop
  // the expired ones nobody has read since (lib/setlistfmLocalCache.js).
  useEffect(() => {
    sweepExpiredSetlistfmCaches();
  }, []);

  // Listen for community stats (for login page)
  useEffect(() => {
    const statsRef = doc(db, 'communityStats', 'global');
    const unsubscribe = onSnapshot(statsRef, (snapshot) => {
      if (snapshot.exists()) {
        setCommunityStats(snapshot.data());
      }
    }, (error) => {
      console.log('Community stats not available yet:', error.message);
    });

    return () => unsubscribe();
  }, []);

  // ── Load friends list ───────────────────────────────────────────────
  const loadFriends = useCallback(async () => {
    if (!user) return;
    try {
      const friendsRef = collection(db, 'users', user.uid, 'friends');
      const snapshot = await getDocs(friendsRef);
      const friendDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Each friend's show count, from the server's publicUserStats
      // (5.59.15), never the count their own app wrote to their profile.
      // null until the server has computed it.
      const statSnaps = await Promise.all(
        friendDocs.map(f => getDoc(doc(db, 'publicUserStats', f.friendUid)).catch(() => null))
      );
      const enriched = friendDocs.map((f, i) => ({
        ...f,
        showCount: statSnaps[i] && statSnaps[i].exists() ? (statSnaps[i].data().showCount ?? null) : null,
      }));

      setFriends(enriched);
    } catch (error) {
      console.error('Failed to load friends:', error);
    }
  }, [user]);

  // ── Blocked accounts ────────────────────────────────────────────────
  // A listener rather than a one-time read, so a block taken on a phone
  // hides that user's content in an open desktop tab without a reload.
  useEffect(() => {
    if (!user || guestMode) {
      setBlockedUserIds([]);
      return;
    }
    return subscribeBlocks(user.uid, setBlockedUserIds);
  }, [user, guestMode]);

  const blockUser = useCallback(async (targetUid) => {
    if (!user || !targetUid || targetUid === user.uid) return;
    try {
      await blockUserDoc(user.uid, targetUid);
      // The listener above will catch up on its own; setting it here too
      // means the content disappears on the same tick the button is
      // pressed rather than after a Firestore round trip.
      setBlockedUserIds(prev => (prev.includes(targetUid) ? prev : [...prev, targetUid]));
      setFriends(prev => prev.filter(f => f.friendUid !== targetUid));
      // The server has already removed the friendship on both sides, friend
      // requests and show tags either way, and them from our upcoming shows'
      // "who's going" lists (friends.js `block`, 5.60.27).
      setToast('Blocked. You won\u2019t see their posts, and they\u2019ve been removed from your friends.');
    } catch (error) {
      console.error('Failed to block user:', error);
      setToast({ message: error?.message && error.status && error.status < 500 ? error.message : 'Failed to block that account. Please try again.', type: 'error' });
      throw error;
    }
  }, [user]);

  const unblockUser = useCallback(async (targetUid) => {
    if (!user || !targetUid) return;
    try {
      await unblockUserDoc(user.uid, targetUid);
      setBlockedUserIds(prev => prev.filter(uid => uid !== targetUid));
      setToast('Unblocked. You can send a friend request if you want to reconnect.');
    } catch (error) {
      console.error('Failed to unblock user:', error);
      setToast({ message: error?.message && error.status && error.status < 500 ? error.message : 'Failed to unblock that account. Please try again.', type: 'error' });
      throw error;
    }
  }, [user]);

  // Real-time listeners for friend requests and show tags
  useEffect(() => {
    if (!user || guestMode) return;

    loadFriends();

    // Incoming friend requests
    const qIncoming = query(collection(db, 'friendRequests'), where('to', '==', user.uid));
    const unsubIncoming = onSnapshot(qIncoming, (snapshot) => {
      setPendingFriendRequests(
        snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.status === 'pending')
      );
    }, (error) => {
      console.log('Friend requests listener error:', error.message);
    });

    // Sent friend requests
    const qSent = query(collection(db, 'friendRequests'), where('from', '==', user.uid));
    const unsubSent = onSnapshot(qSent, (snapshot) => {
      setSentFriendRequests(
        snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.status === 'pending')
      );
    }, (error) => {
      console.log('Sent requests listener error:', error.message);
    });

    // Incoming show tags
    const qTags = query(collection(db, 'showTags'), where('toUid', '==', user.uid));
    const unsubTags = onSnapshot(qTags, (snapshot) => {
      setPendingShowTags(
        snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.status === 'pending')
      );
    }, (error) => {
      console.log('Show tags listener error:', error.message);
    });

    // Show suggestions
    const qSuggestions = query(collection(db, 'showSuggestions'), where('participants', 'array-contains', user.uid));
    const unsubSuggestions = onSnapshot(qSuggestions, (snapshot) => {
      setShowSuggestions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.log('Show suggestions listener error:', error.message);
    });

    // Pending invites this user has sent
    const qInvites = query(
      collection(db, 'invites'),
      where('inviterUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubInvites = onSnapshot(qInvites, (snapshot) => {
      setPendingInvites(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.log('Pending invites listener error:', error.message);
    });

    // Pending email tags this user has sent (to non-members)
    const qSentEmailTags = query(
      collection(db, 'pendingEmailTags'),
      where('fromUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubSentEmailTags = onSnapshot(qSentEmailTags, (snapshot) => {
      setSentPendingEmailTags(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.log('Sent pending email tags listener error:', error.message);
    });

    // In-app notifications
    const qNotifications = query(
      collection(db, 'notifications'),
      where('uid', '==', user.uid),
      where('read', '==', false)
    );
    const unsubNotifications = onSnapshot(qNotifications, (snapshot) => {
      setUnreadNotifications(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.log('Notifications listener error:', error.message);
    });

    // Followed bands + account createdAt. Not "loaded" until this user's
    // own snapshot arrives, so a pending ?follow= is never checked against
    // the previous account's list.
    setFavoritesLoaded(false);
    const favRef = doc(db, 'userProfiles', user.uid);
    const unsubFavorites = onSnapshot(favRef, (docSnap) => {
      setFavoritesLoaded(true);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFavoriteArtists(data.favoriteArtists || []);
        // Extract createdAt for account-age tooltip eligibility
        const createdMs = data.createdAt?.toMillis?.() || null;
        setUserCreatedAt(createdMs);
      }
    }, (error) => {
      console.log('Favorites listener error:', error.message);
    });

    return () => {
      unsubIncoming();
      unsubSent();
      unsubTags();
      unsubSuggestions();
      unsubInvites();
      unsubSentEmailTags();
      unsubNotifications();
      unsubFavorites();
    };
  }, [user, guestMode, loadFriends]);

  // Upcoming shows — live, so a show accepted from a friend's tag on one
  // device appears on another without a reload.
  useEffect(() => {
    if (!user || guestMode) {
      setUpcomingShows([]);
      // Nothing to wait for: guests have no upcoming shows.
      setUpcomingLoaded(true);
      return;
    }
    setUpcomingLoaded(false);
    const unsub = onSnapshot(
      collection(db, 'users', user.uid, UPCOMING_COLLECTION),
      (snapshot) => {
        setUpcomingShows(sortUpcoming(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))));
        setUpcomingLoaded(true);
      },
      (error) => {
        console.log('Upcoming shows listener error:', error.message);
        setUpcomingLoaded(true);
      },
    );
    return unsub;
  }, [user, guestMode]);


  // ── Server stats and rank (5.59.15, B-05) ───────────────────────────
  // Rank and the headline numbers are computed on the server from the
  // shows (netlify/functions/lib/userStats.js, lib/stats) into
  // userStats/{uid}; this reads that one document. Until 5.59.15 rank read
  // every userProfiles document on every load and every add.
  //
  // After a change to the shows, requestStatsRecompute asks the server to
  // recompute this user's numbers (recompute-my-stats), debounced so a bulk
  // add is one request. The scheduled rebuild every 6 hours catches
  // anything this misses.
  const [serverStats, setServerStats] = useState(null); // userStats/{uid} data, or null
  const recomputeTimer = useRef(null);
  const requestStatsRecompute = useCallback(() => {
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => {
      recomputeTimer.current = null;
      authedFetch('/.netlify/functions/recompute-my-stats', { method: 'POST' })
        .catch((err) => console.warn('[stats] recompute request failed; the scheduled run will catch up', err?.message));
    }, 3000);
  }, []);

  useEffect(() => {
    setServerStats(null);
    setUserRank(null);
    if (!user?.uid || guestMode) return undefined;
    let askedOnce = false;
    const unsub = onSnapshot(doc(db, 'userStats', user.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setServerStats(data);
      setUserRank(data && data.ranked ? { rank: data.rank, total: data.rankedOf } : null);
      // No stats yet (a new account, or before the backfill): ask once.
      if (!data && !askedOnce) { askedOnce = true; requestStatsRecompute(); }
    }, (error) => {
      console.warn('[stats] userStats listener failed:', error.message);
    });
    return () => unsub();
  }, [user?.uid, guestMode, requestStatsRecompute]);

  // ── Load shows from Firestore ───────────────────────────────────────
  // ── The user's shows, live (5.60.10, R-06 part 2) ───────────────────
  // A listener on users/{uid}/shows (lib/liveShows.js), so an edit made on
  // another device appears here without a reload. It fails loudly and
  // never hangs: no first snapshot within its deadline, or a listener
  // error, and the shows are read once instead, with a deadline of its
  // own; either way loading ends and the failure is reported. A snapshot
  // never undoes what this device just did: a show still being saved
  // (offline, the outbox) and a setlist whose edit is in flight keep this
  // device's copy until the server has them.
  const showsListener = useRef({ stop: null, uid: null });
  const setlistInFlight = useRef(new Map()); // showId -> edits not yet back

  const stopShowsListener = () => {
    const { stop } = showsListener.current;
    showsListener.current = { stop: null, uid: null };
    if (stop) stop();
  };

  // Ids of shows this device is still saving: written while normalize-show
  // was out of reach and not yet on the server, or waiting in the outbox.
  const pendingShowIds = (uid) => {
    const ids = new Set(readOutbox(uid).map((e) => e.showId));
    pendingDeviceWrites.current.forEach((state, id) => { if (!state.settled) ids.add(id); });
    return ids;
  };

  const applyServerShows = (uid, serverShows) => {
    if (showsListener.current.uid !== uid) return; // a listener for someone who has signed out
    const inFlight = new Set([...setlistInFlight.current].filter(([, n]) => n > 0).map(([id]) => id));
    const merged = mergeShowsSnapshot(serverShows, latestShows.current, { pendingIds: pendingShowIds(uid), setlistInFlight: inFlight });
    latestShows.current = merged;
    setShows(merged);
    setSelectedShow(prev => (prev ? merged.find(s => s.id === prev.id) || prev : prev));
  };

  const loadShows = useCallback(async (userId) => {
    stopShowsListener();
    setIsLoading(true);
    const showsRef = collection(db, 'users', userId, 'shows');
    showsListener.current = { stop: null, uid: userId };
    const stop = startShowsListener({
      subscribe: (next, fail) => onSnapshot(showsRef, next, fail),
      readOnce: async () => (await getDocs(showsRef)).docs,
      onShows: (serverShows) => applyServerShows(userId, serverShows),
      onError: (error, stage) => {
        console.error(`[shows] ${stage === 'read-once' ? 'loading your shows failed' : `live updates unavailable (${stage}); loading once instead`}:`, error?.message || error);
      },
      onLoaded: async ({ error, live }) => {
        setIsLoading(false);
        setShowsLoadedFor(userId);
        if (error && !live && latestShows.current.length === 0) {
          setToast({ message: 'Your shows couldn\u2019t be loaded. Check your connection and reload.', type: 'error' });
        }
        if (auth.currentUser && auth.currentUser.uid === userId) {
          try { await updateUserProfile(auth.currentUser, latestShows.current); } catch (err) { console.warn('[shows] profile update failed:', err?.message); }
          runRetroactiveSuggestionScan().catch(() => {});
        }
      },
    });
    showsListener.current = { stop, uid: userId };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No listener outlives the app.
  useEffect(() => () => stopShowsListener(), []);

  // ── Load festivals from Firestore ────────────────────────────────────
  // Two reads per festival: the user's own attendance record
  // (users/{uid}/festivals/{attendanceId}, owner-only) and the shared
  // canonical festival it points at (festivals/{festivalId}, readable by
  // any signed-in user). They are joined here, at read time, rather than
  // by copying canonical fields onto the attendance record — which is what
  // keeps a creator's later date correction visible to everyone who joined
  // instead of leaving them holding a stale copy.
  //
  // A canonical document that can't be read (deleted by an admin, or a
  // rules rejection) leaves the attendance record in the list marked
  // `unavailable` rather than dropping it, so a user never silently loses
  // a festival — and never loses the shows attached to it, which are
  // linked by attendance id and are unaffected either way.
  const loadFestivals = useCallback(async (userId) => {
    setFestivalsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users', userId, 'festivals'));
      const attendances = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // lib/festivalCatalog.js joinedFestival: the same object
      // netlify/functions/festivals.js answers with, and the native app
      // builds (fixtures/festivals/joined.json).
      const loaded = await Promise.all(attendances.map(async ({ id, ...attendance }) => {
        if (!attendance.festivalId) return joinedFestival(id, attendance, undefined, userId);
        try {
          const canonicalSnap = await getDoc(doc(db, 'festivals', attendance.festivalId));
          return joinedFestival(id, attendance, canonicalSnap.exists() ? canonicalSnap.data() : null, userId);
        } catch (e) {
          console.warn('Failed to read canonical festival:', attendance.festivalId, e.message);
          return joinedFestival(id, attendance, null, userId);
        }
      }));

      setFestivals(loaded);
    } catch (error) {
      // Don't fail silently — an empty Festivals page and a Festivals page
      // whose read was rejected look identical to the user otherwise.
      console.error('Failed to load festivals:', error);
      setToast({ message: "Couldn't load your festivals. Please refresh.", type: 'error' });
    } finally {
      setFestivalsLoading(false);
    }
  }, []);

  // ── Guest shows (localStorage) ─────────────────────────────────────
  const loadGuestShows = useCallback(() => {
    try {
      const stored = storage.get(STORAGE_KEYS.GUEST_SHOWS);
      if (stored) {
        const guestShows = JSON.parse(stored);
        if (guestShows && guestShows.length > 0) {
          setShows(guestShows);
        }
      }
    } catch (error) {
      console.log('Failed to load guest shows:', error);
    }
    setIsLoading(false);
  }, []);

  const saveGuestShows = useCallback((showsToSave) => {
    try {
      storage.set(STORAGE_KEYS.GUEST_SHOWS, JSON.stringify(showsToSave));
    } catch (error) {
      console.log('Failed to save guest shows:', error);
    }
  }, []);

  // ── Auth state listener ─────────────────────────────────────────────
  // The last account signed in on this page: undefined until there is one.
  // A saved session being restored sets it without counting as a switch.
  const lastSignedInUidRef = useRef(undefined);

  useEffect(() => {
    // Safety timeout: if onAuthStateChanged never fires (e.g. IndexedDB hang
    // in WKWebView), stop showing the loading screen after 5 seconds
    const authTimeout = setTimeout(() => {
      setAuthLoading((prev) => {
        if (prev) console.warn('Auth state listener timed out — proceeding without auth');
        return false;
      });
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      clearTimeout(authTimeout);
      const leaveRoute = signInLeavesRoute(
        lastSignedInUidRef.current,
        currentUser?.uid,
        !!storage.get(STORAGE_KEYS.GUEST_SESSION),
      );
      if (currentUser) lastSignedInUidRef.current = currentUser.uid;
      setUser(currentUser);
      setAuthLoading(false);
      // Next launch, paint the app skeleton rather than the landing page
      // while auth resolves (lib/signedInHint.js). Cleared on a null user
      // too, which covers sign-out and an expired session alike.
      if (currentUser) setSignedInHint();
      else clearSignedInHint();

      if (currentUser) {
        // Close auth modal when user signs in (belt-and-suspenders)
        setAuthModal(null);

        // Navigate to shows list to clear any lingering detail view query
        // params from a previous user. This prevents signing in as a
        // different account from landing on the previous user's show.
        // Only on an account switch: restoring a saved session on page load
        // used to do this too (fixed 5.46.0), and so did signing in from
        // signed out (fixed 5.49.3), each throwing away the deep link the
        // person opened (an email's /venues/?venue=…, /year-in-review/?…,
        // /how-to-use) in favor of My Shows. See signInLeavesRoute.
        if (leaveRoute) router.push('/shows/');

        // Before anything else writes to the profile — see
        // ensureProfileCreatedAt above.
        try {
          await ensureProfileCreatedAt(currentUser);
        } catch (err) {
          console.error('Could not stamp profile createdAt:', err);
        }

        // ── Terms agreement (Guideline 1.2) ───────────────────────────
        // First thing after sign-in, because everything below it is
        // loading data for an app the user may not be allowed into yet.
        //
        // A parked tick means they agreed on the gate a moment ago, when
        // there was no uid to write to — flush it now. Otherwise read
        // what their profile says; a missing field means every account
        // created before build 32, which is exactly who the launch gate
        // in AppProviderWrapper is for.
        try {
          if (getPendingAcceptance() >= TERMS_VERSION) {
            setTermsAccepted(true);
            recordTermsAcceptance(currentUser.uid).catch((err) => {
              console.error('Failed to record terms acceptance:', err);
            });
          } else {
            setTermsAccepted(await fetchTermsAcceptance(currentUser.uid));
          }
        } catch (err) {
          console.error('Terms acceptance check failed:', err);
          // Fail closed: show the gate. Agreeing again is cheap; letting
          // someone past it on an error is the rejection all over again.
          setTermsAccepted(false);
        }

        // ── Establish the profile display name, once, server-side ─────
        // updateUserProfile() used to mirror Firebase Auth's displayName
        // into the profile on every load, which no Firestore rule can
        // filter. It is written here instead, through the function that
        // runs the wordlist, and only when the profile does not already
        // carry one — a name already set is either filtered or was
        // changed through saveDisplayName(), and re-sending it on every
        // launch would undo a rename the moment Auth disagreed.
        //
        // Best-effort: a new account with no name yet renders as
        // "Anonymous" (resolveAuthorName's fallback) rather than failing
        // to sign in, and the next launch tries again.
        try {
          const profileSnap = await getDoc(doc(db, 'userProfiles', currentUser.uid));
          const profileData = profileSnap.exists() ? profileSnap.data() : {};

          // Disabling an Auth account does not sign anyone out on the
          // spot — the ID token in hand stays valid until it expires, and
          // until then the app runs signed in with every write refused.
          // Reading the flag here is what turns that hour of silent
          // breakage into an explanation.
          setIsSuspended(profileData.banned === true);

          if (!profileData.displayName && currentUser.displayName) {
            await saveDisplayName(currentUser.displayName);
          }
        } catch (err) {
          console.error('Could not read profile on sign-in:', err);
          // Not suspended on a read failure: locking a user out of the
          // app over a Firestore blip is the worse error, and every write
          // they attempt is still refused by the rules regardless.
          setIsSuspended(false);
        }
        // Mark guest session as converted if the user was in guest mode
        try {
          const guestSessionId = storage.get(STORAGE_KEYS.GUEST_SESSION);
          if (guestSessionId) {
            // Counted from the shows saved on this device: guest sessions
            // are admin-read-only since 5.59.7 (S-05).
            let guestShowsAdded = 0;
            try {
              const stored = JSON.parse(storage.get(STORAGE_KEYS.GUEST_SHOWS) || '[]');
              guestShowsAdded = Array.isArray(stored) ? stored.length : 0;
            } catch (_) {}

            await updateDoc(doc(db, 'guestSessions', guestSessionId), {
              converted: true,
              convertedAt: serverTimestamp(),
              convertedUserId: currentUser.uid,
            });

            await setDoc(doc(db, 'userProfiles', currentUser.uid), {
              convertedFromGuest: true,
              guestSessionId: guestSessionId,
              guestConvertedAt: serverTimestamp(),
              guestShowsAdded: guestShowsAdded,
            }, { merge: true });

            storage.remove(STORAGE_KEYS.GUEST_SESSION);
          }
        } catch (error) {
          console.log('Failed to update guest session conversion:', error);
        }

        setGuestMode(false);
        // Shows saved on this device as a guest move into the account in
        // rescueLocalShows below, once this user is in state.
        loadShows(currentUser.uid);
        loadFestivals(currentUser.uid);
        loadInviteStats(currentUser.uid);

        // Auto-friend the user who invited them via referral link. The
        // server writes both sides of the friendship (5.59.7, S-04): a
        // signed link from Invite or an invite email makes them friends,
        // an old ?ref=<uid> link sends the referrer a friend request.
        const referrerRef = storage.get(STORAGE_KEYS.INVITE_REFERRER);
        if (referrerRef) {
          storage.remove(STORAGE_KEYS.INVITE_REFERRER);
          callFriends('referral', { ref: referrerRef })
            .catch((err) => console.warn('Auto-friend from invite failed:', err.message));
        }

        // ── Email-based invite lookup ─────────────────────────────────
        // An invite sent to this account's address: the server befriends
        // the inviter, marks the invite accepted and records invitedByUid.
        try {
          const claim = await callFriends('claimInvites');
          if (claim.claimed) {
            setWelcomeState({ inviterName: claim.inviterName || 'your friend', inviterUid: claim.inviterUid });
            // The server finds the inviter from the invitedByUid it wrote.
            if (claim.newFriend) sendNotification({ type: 'friend_joined' }).catch(() => {});
          }
        } catch (err) {
          console.warn('Email invite lookup failed:', err.message);
        }

        // ── Pending email tags lookup ─────────────────────────────────
        try {
          const tagQuery = query(
            collection(db, 'pendingEmailTags'),
            where('toEmail', '==', (currentUser.email || '').toLowerCase()),
            where('status', '==', 'pending')
          );
          const tagSnap = await getDocs(tagQuery);
          if (!tagSnap.empty) {
            setPendingTagsForReview(
              tagSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            );
          }
        } catch (err) {
          console.warn('Pending email tags lookup failed:', err);
        }

      } else if (guestMode) {
        setTermsAccepted(null);
        setIsSuspended(null);
        loadGuestShows();
        setFestivalsLoading(false);
      } else {
        setTermsAccepted(null);
        setIsSuspended(null);
        // However the session ended (logout, expiry, deletion elsewhere),
        // nothing from it stays in memory (5.59.14).
        resetUserState();
        setIsLoading(false);
      }
    });

    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, [loadShows, guestMode, loadGuestShows]);

  // ── Guest rescue (5.59.10) ──────────────────────────────────────────
  // Shows a guest saved on this device ('guest-shows', or the very old
  // 'concert-shows') move into the account on sign-up or sign-in, through
  // buildShowDoc, skipping any the account already has (lib/guestMerge.js).
  // A device copy is removed only after its Firestore write is confirmed;
  // whatever fails stays on the device and is tried again on the next
  // launch, because this runs every time a signed-in user is set.
  //
  // Until 5.59.10 an "Import Existing Shows?" dialog did this, and its Skip
  // button (and Escape / back) deleted the shows for good.
  const rescueRunning = useRef(false);
  const rescueLocalShows = async (uid) => {
    const local = [
      ...readLocalShows(storage.get(STORAGE_KEYS.GUEST_SHOWS)),
      ...readLocalShows(storage.get(STORAGE_KEYS.LEGACY_SHOWS)),
    ];
    if (!local.length || rescueRunning.current) return;
    rescueRunning.current = true;
    try {
      let accountShows;
      try {
        const snap = await getDocs(collection(db, 'users', uid, 'shows'));
        accountShows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (error) {
        // Can't check for duplicates, so don't write; next launch tries again.
        console.warn('[guest rescue] account shows unreadable; keeping local shows:', error?.message);
        return;
      }
      // How many shows the account had before, for the welcome email.
      const prevCount = accountShows.length;
      const result = await mergeGuestShows({
        localShows: local,
        accountShows,
        writeShow: async (show) => { await writeShowDoc(uid, show); },
      });
      // Only the failures stay on the device, all under 'guest-shows'.
      if (result.failed.length) storage.set(STORAGE_KEYS.GUEST_SHOWS, JSON.stringify(result.failed));
      else storage.remove(STORAGE_KEYS.GUEST_SHOWS);
      storage.remove(STORAGE_KEYS.LEGACY_SHOWS);
      if (result.saved.length) {
        noteShowsAdded(prevCount, result.saved);
        loadShows(uid);
        requestStatsRecompute();
      }
      const note = mergeMessage(result);
      if (note) setToast(note.type === 'error' ? note : note.message);
    } finally {
      rescueRunning.current = false;
    }
  };

  useEffect(() => {
    if (user?.uid && !guestMode) rescueLocalShows(user.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, guestMode]);

  // ── Auth handlers ───────────────────────────────────────────────────
  const handleLogin = async () => {
    try {
      // Same rule as the auth forms: on native the popup is a silent no-op,
      // so go through the native sheet and never fall back to it.
      if (isNativePlatform()) {
        const result = await nativeOAuthSignIn('google');
        if (!result) throw new Error('Sign in is unavailable on this device.');
      } else {
        await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      }
    } catch (error) {
      console.error('Login failed:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        alert('Login failed. Please try again.');
      }
    }
  };

  // Everything one account loaded, back to empty (5.59.14). The per-user
  // effects below return early when there is no user and don't reset
  // their state, so without this a second account could briefly, or after
  // a failed read for good, see the first one's friends, tags or alerts.
  const resetUserState = () => {
    // Synchronous and returns nothing: safe as a sign-out step
    // (lib/signOutFlow.js), nothing a Capacitor plugin can hang.
    stopShowsListener();
    setlistInFlight.current = new Map();
    setShows([]);
    latestShows.current = [];
    setShowsLoadedFor(null);
    setFestivals([]);
    setFestivalsLoading(false);
    setSelectedShow(null);
    setSelectedArtist(null);
    setBulkAdd(null);
    setUserCreatedAt(null);
    setUserRank(null);
    setFriends([]);
    setPendingFriendRequests([]);
    setSentFriendRequests([]);
    setPendingShowTags([]);
    setUpcomingShows([]);
    setUpcomingLoaded(false);
    setTagFriendsShow(null);
    setShowSuggestions([]);
    setPendingInvites([]);
    setInviteStats(null);
    setSentPendingEmailTags([]);
    setBlockedUserIds([]);
    setFavoriteArtists([]);
    setFavoritesLoaded(false);
    setUnreadNotifications([]);
    setPendingTagsForReview([]);
    setWelcomeState(null);
    setPushOffer(null);
    setVenueRatingShow(null);
    setSetlistScanning(false);
    setSetlistScanProgress({ current: 0, total: 0, found: 0 });
  };

  // Logout (5.59.14). Until then the push cleanup was awaited before
  // signOut, and on iOS that await never settled (lib/pushAlerts.js
  // messaging()), so Logout did nothing from 3.11 to 3.13.13.
  // lib/signOutFlow.js runs each step time-limited and best-effort, in an
  // order that can't leave a session behind: the push token (needs the
  // session), the web session, the native session, then local state.
  const handleLogout = async () => {
    await performSignOut({
      beforeSignOut: () => forgetPushToken(),
      webSignOut: () => signOut(auth),
      nativeSignOut: () => nativeSignOut(),
      clearLocal: () => {
        resetUserState();
        // Each on its own: one failing must not skip the others.
        for (const clear of [clearSignedInHint, () => rememberHeardShows(null), clearSpotifySession]) {
          try { clear(); } catch (error) { console.warn('[sign-out] local cleanup step failed', error?.message); }
        }
      },
      navigate: () => router.push('/'),
    });
  };

  /**
   * Record the current user's agreement from the launch gate.
   *
   * Optimism is deliberate but ordered: the write is awaited so a failure
   * keeps the gate up (TermsGate catches the throw and shows an inline
   * error), and only a successful write flips the flag that unmounts it.
   * Letting someone past on a failed write would leave an account marked
   * as never having agreed.
   */
  const acceptTerms = useCallback(async () => {
    if (!user) return;
    await recordTermsAcceptance(user.uid);
    setTermsAccepted(true);
  }, [user]);

  const openAuthModal = (mode) => setAuthModal(mode);
  const closeAuthModal = () => setAuthModal(null);
  const switchAuthMode = (mode) => setAuthModal(mode);
  const handleAuthSuccess = () => setAuthModal(null);

  // ── Guest mode ──────────────────────────────────────────────────────
  const enterGuestMode = async () => {
    setGuestMode(true);
    loadGuestShows();

    try {
      let sessionId = storage.get(STORAGE_KEYS.GUEST_SESSION);
      if (!sessionId) {
        const sessionDoc = await addDoc(collection(db, 'guestSessions'), {
          startedAt: serverTimestamp(),
          converted: false,
          showsAdded: 0,
          userAgent: navigator.userAgent,
        });
        sessionId = sessionDoc.id;
        storage.set(STORAGE_KEYS.GUEST_SESSION, sessionId);
      }
    } catch (error) {
      console.log('Failed to track guest session:', error);
    }
  };

  const exitGuestMode = () => {
    setGuestMode(false);
    setShows([]);
    storage.remove(STORAGE_KEYS.GUEST_SESSION);
  };

  // ── Show CRUD ───────────────────────────────────────────────────────
  // ── Adding a show (5.60.6) ──────────────────────────────────────────
  //
  // Every add path sends an input ({ kind, … }) to normalize-show, which
  // builds and writes the document (lib/normalizeShow.js); the app shows
  // the document the server wrote. When the server can't be reached, the
  // show is built here with the same code, saved with needsNormalization,
  // and its input kept in this device's outbox until the server takes it
  // (lib/showAdd.js). A guest has no account to send to, so a guest's show
  // is always built here, band source included.

  // A show written here while normalize-show was out of reach, by id:
  // { settled } once Firestore has the write. The outbox commits an entry
  // only after that (or after a restart, when the write is gone with the
  // process), so a late device write can't land on the server's document.
  const pendingDeviceWrites = useRef(new Map());
  const flushingOutbox = useRef(false);

  // The reads lib/normalizeShow.js needs, from the app.
  const clientShowDeps = ({ bandSource = true } = {}) => ({
    setlistfmSetlist: async () => null, // every app input carries its setlist
    bandSetlist: bandSource ? fetchBandSetlistResponse : async () => null,
    showTag: async (tagId) => {
      const snap = await getDoc(doc(db, 'showTags', tagId));
      const tag = snap.exists() ? snap.data() : null;
      return tag && tag.toUid === user?.uid && tag.status === 'pending' ? tag : null;
    },
    pendingEmailTag: async (tagId) => {
      const snap = await getDoc(doc(db, 'pendingEmailTags', tagId));
      const tag = snap.exists() ? snap.data() : null;
      const mine = String(user?.email || '').toLowerCase();
      return tag && mine && String(tag.toEmail || '').toLowerCase() === mine && tag.status === 'pending' ? tag : null;
    },
    upcomingShow: async (id) => upcomingShows.find((u) => u.id === id) || null,
  });

  // Any caller still passing show data rather than an input is a typed show.
  const asInput = (raw) => (raw && raw.kind ? raw : { kind: 'manual', ...(raw || {}) });

  // Every single-show add lands on the same "you can open it now" toast.
  // The id is minted on the device (mintShowId) and is the Firestore doc
  // id, and the show is already in `shows` by the time this runs, so the
  // link resolves immediately — no reload, no temp id. Callers that add in
  // a loop (CSV import) or that say something more specific themselves
  // (accepting a friend's tag) pass { silent: true }.
  const announceAddedShow = (showId, artist, { duplicate = false } = {}) => {
    setToast({
      message: duplicate
        ? `${artist || 'That show'} is already in your shows.`
        : `Added ${artist || 'show'} to your shows.`,
      href: showHref(showId),
      actionLabel: 'View show',
    });
  };

  // ── Welcome email (5.55.0) ────────────────────────────────────────
  // The one place a show write asks for the welcome email. Each of the
  // functions that add shows (addShow, addShowsFromTour,
  // importShowsToFestival, rescueLocalShows) calls this after its write
  // succeeds, with how many shows the account had before it. A guest has
  // no account and no address; their shows reach this through
  // rescueLocalShows once they sign up. Fire-and-forget: the save never
  // waits on it. See lib/welcomeEmailTrigger.js and
  // netlify/functions/lib/welcomeEmail.js, which decides for itself.
  const noteShowsAdded = (prevCount, addedShows = []) => {
    if (!user || guestMode) return;
    if (!isFirstShowTransition(prevCount, addedShows.length)) return;
    requestWelcomeEmail(user, addedShows[0]?.id, {
      url: apiUrl('/.netlify/functions/send-welcome-email'),
    });
  };

  // What follows a new show, however it was added.
  const afterShowsAdded = (prevCount, added, { activity = true } = {}) => {
    if (!added.length) return;
    const updatedShows = [...latestShows.current];
    noteShowsAdded(prevCount, added);
    updateUserProfile(user, updatedShows).catch(() => {});
    requestStatsRecompute();
    if (!activity) return;
    added.forEach((show) => {
      // Background suggestion check — non-blocking
      checkShowSuggestionsForNewShow(show).catch(() => {});
      // The friend activity entry is written by normalize-show (5.60.38).
    });
  };

  const appendShows = (added) => {
    if (!added.length) return;
    const updated = [...latestShows.current, ...added];
    latestShows.current = updated;
    setShows(updated);
  };

  // A friend's tag merged into a show already logged: the server credited
  // the friend on it (normalize-show); mirror that here.
  const noteTagMerged = (showId, show) => {
    if (!show?.taggedBy) return;
    setShows((prev) => prev.map((s) => (s.id === showId && !s.taggedBy
      ? { ...s, taggedBy: show.taggedBy, taggedByUid: show.taggedByUid || null }
      : s)));
  };

  // The server's document as the app holds it: `id` plus the stored fields.
  const asLoadedShow = (show) => ({ ...show, setlist: show.setlist || [] });

  // ── Offline: built here, written with needsNormalization, kept in the outbox
  const addShowOnDevice = async (input, showId, { silent = false, onPossible = 'ask', confirmed = false } = {}) => {
    if (input.kind === 'tag' || input.kind === 'email-tag') {
      // A friend's tag has to be read from the server to be accepted.
      setToast({ message: 'You’re offline. Accept the tag again when you’re connected.', type: 'error' });
      return null;
    }
    let built;
    try {
      built = await normalizeShowInput({ ...input, showId }, { deps: clientShowDeps({ bandSource: false }), existingShows: latestShows.current });
    } catch (err) {
      setToast({ message: err?.message || 'That show couldn’t be saved.', type: 'error' });
      return null;
    }
    const { show, duplicate } = built;
    if (duplicate && duplicate.rule !== 'possible') {
      setShowForm(false);
      if (!silent) announceAddedShow(duplicate.showId, show.artist, { duplicate: true });
      return { id: duplicate.showId, duplicate: true };
    }
    if (duplicate && !confirmed) {
      const existing = latestShows.current.find((s) => s.id === duplicate.showId);
      const ok = onPossible === 'add' || (onPossible === 'ask' && window.confirm(possibleDuplicateQuestion(existing, show)));
      if (!ok) return { id: duplicate.showId, duplicate: true, possible: true };
    }

    const { id, fields, local, outboxEntry } = deviceShowWrite(show, input);
    const state = { settled: false };
    pendingDeviceWrites.current.set(id, state);
    setDoc(doc(db, 'users', user.uid, 'shows', id), { ...fields, createdAt: serverTimestamp() })
      .then(() => { state.settled = true; flushOutbox(); })
      .catch((error) => { state.settled = true; console.error('Failed to save show on the device:', error); });
    addToOutbox(user.uid, outboxEntry);

    const prevCount = latestShows.current.length;
    appendShows([local]);
    setShowForm(false);
    afterShowsAdded(prevCount, [local], { activity: false });
    if (!silent) {
      setToast({
        message: `Saved ${show.artist || 'the show'} on this device. It finishes saving when you’re back online.`,
        href: showHref(id),
        actionLabel: 'View show',
      });
    }
    return id;
  };

  // ── The outbox: inputs normalize-show hasn't taken yet ──────────────
  const flushOutbox = async () => {
    if (!user || guestMode || flushingOutbox.current) return;
    const ready = readOutbox(user.uid).filter((e) => {
      const write = pendingDeviceWrites.current.get(e.showId);
      return !write || write.settled;
    });
    if (!ready.length) return;
    flushingOutbox.current = true;
    try {
      const results = await commitShowInputs(ready.map((e) => ({ ...e.input, showId: e.showId, confirmPossible: true })));
      const done = [];
      const refreshed = new Map();
      results.forEach((res, i) => {
        const entry = ready[i];
        if (!entry) return;
        done.push(entry.showId);
        if (res.error) {
          console.warn(`[outbox] ${entry.showId} can't be normalized (${res.error.code}); the sweep leaves it as saved`);
          return;
        }
        if (res.show && (res.written || res.alreadyNormalized)) refreshed.set(entry.showId, res.show);
      });
      removeFromOutbox(user.uid, done);
      done.forEach((id) => pendingDeviceWrites.current.delete(id));
      // The server's document for each, read back so the user's edits made
      // meanwhile (kept by the server) and the band source's setlist both show.
      for (const id of refreshed.keys()) {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid, 'shows', id));
          if (snap.exists()) refreshed.set(id, { id, ...snap.data() });
        } catch { /* keep the server's answer */ }
      }
      if (refreshed.size) {
        setShows((prev) => prev.map((s) => (refreshed.has(s.id) ? asLoadedShow({ ...refreshed.get(s.id), id: s.id }) : s)));
        latestShows.current = latestShows.current.map((s) => (refreshed.has(s.id) ? asLoadedShow({ ...refreshed.get(s.id), id: s.id }) : s));
        requestStatsRecompute();
      }
    } catch (err) {
      if (!(err instanceof OfflineError)) console.warn('[outbox] flush failed:', err?.message);
    } finally {
      flushingOutbox.current = false;
    }
  };

  // Commit the outbox once signed in, whenever the device comes back
  // online, and whenever the app comes back to the foreground.
  useEffect(() => {
    if (!user?.uid || guestMode) return undefined;
    flushOutbox();
    const onOnline = () => flushOutbox();
    const onVisible = () => { if (document.visibilityState === 'visible') flushOutbox(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, guestMode]);

  /**
   * addShow(input, { silent, onPossible }) -> the show id, { id, duplicate }
   * for a show already logged (with `possible` when the user said no to a
   * possible duplicate), or null.
   *
   * onPossible: 'ask' (the default) asks the user; 'skip' treats a possible
   * duplicate as already logged (the spreadsheet import); 'add' adds it.
   */
  const addShow = async (rawInput, { silent = false, onPossible = 'ask' } = {}) => {
    const input = asInput(rawInput);
    const prevCount = latestShows.current.length;

    if (guestMode) {
      let built;
      try {
        built = await normalizeShowInput({ ...input, showId: mintShowId() }, { deps: clientShowDeps(), existingShows: latestShows.current });
      } catch (err) {
        setToast({ message: err?.message || 'That show couldn’t be saved.', type: 'error' });
        return null;
      }
      const { show, duplicate } = built;
      if (duplicate && duplicate.rule !== 'possible') {
        setShowForm(false);
        if (!silent) announceAddedShow(duplicate.showId, show.artist, { duplicate: true });
        return { id: duplicate.showId, duplicate: true };
      }
      if (duplicate) {
        const existing = latestShows.current.find((s) => s.id === duplicate.showId);
        const ok = onPossible === 'add' || (onPossible === 'ask' && window.confirm(possibleDuplicateQuestion(existing, show)));
        if (!ok) return { id: duplicate.showId, duplicate: true, possible: true };
      }
      const { normalizedVersion: _v, ...guestShow } = show;
      appendShows([guestShow]);
      saveGuestShows(latestShows.current);
      setShowForm(false);

      try {
        const sessionId = storage.get(STORAGE_KEYS.GUEST_SESSION);
        if (sessionId) {
          await updateDoc(doc(db, 'guestSessions', sessionId), { showsAdded: latestShows.current.length });
        }
      } catch (error) {
        console.log('Failed to update guest session:', error);
      }

      // A guest's first show opens the account prompt (in place of the
      // usual "added" toast below). Until 5.59.4 it waited two seconds
      // behind a first-show animation.
      const isFirstShow = prevCount === 0;
      if (isFirstShow) setShowGuestPrompt(true);
      if (!silent && !isFirstShow) announceAddedShow(guestShow.id, guestShow.artist);
      return guestShow.id;
    }

    if (!user) return null;

    const showId = mintShowId();
    let res;
    try {
      [res] = await commitShowInputs([{ ...input, showId }]);
    } catch (err) {
      if (err instanceof OfflineError) return addShowOnDevice(input, showId, { silent, onPossible });
      throw err;
    }

    if (res?.needsConfirmation) {
      const existing = latestShows.current.find((s) => s.id === res.duplicate?.showId);
      const ok = onPossible === 'add' || (onPossible === 'ask' && window.confirm(possibleDuplicateQuestion(existing, res.show)));
      if (!ok) return { id: res.duplicate.showId, duplicate: true, possible: true };
      try {
        [res] = await commitShowInputs([{ ...input, showId, confirmPossible: true }]);
      } catch (err) {
        if (err instanceof OfflineError) return addShowOnDevice(input, showId, { silent, onPossible, confirmed: true });
        throw err;
      }
    }

    if (!res || res.error) {
      setToast({ message: res?.error?.message || 'Failed to add show. Please try again.', type: 'error' });
      return null;
    }

    if (res.mergedInto) {
      noteTagMerged(res.mergedInto, res.show);
      setShowForm(false);
      if (!silent) announceAddedShow(res.mergedInto, res.show?.artist, { duplicate: true });
      return { id: res.mergedInto, duplicate: true };
    }

    const newShow = asLoadedShow(res.show);
    appendShows([newShow]);
    setShowForm(false);
    afterShowsAdded(prevCount, [newShow]);
    if (!silent) announceAddedShow(newShow.id, newShow.artist);
    return newShow.id;
  };

  // ── Bulk add: every night you caught on one tour ────────────────────
  // The write half of the tour browse flow (components/tours/
  // TourBrowseModal.jsx), "Add all" on the search and the Songs I've heard
  // tool. `inputs` are normalize-show inputs; the picker already showed
  // which nights are logged or possibly logged and the user chose, so a
  // possible duplicate is added (confirmPossible).
  //
  // Not all-or-nothing: normalize-show writes each show on its own, 25 to a
  // request, and partial failure is the normal case. If the connection
  // drops mid-run, what the server took stands and the rest are saved on
  // the device for the outbox; a show the server refused is reported as
  // failed so the user can retry it.
  //
  // Progress lives in AppContext rather than in the modal on purpose: the
  // run survives closing the modal and navigating around the app. No
  // per-show activity-feed entry: catching five nights of a tour is one
  // action by the user.
  const addShowsFromTour = async (inputs = []) => {
    const empty = { added: [], skipped: [], failed: [] };
    if (!user || guestMode || !inputs.length) return empty;

    const prevCount = latestShows.current.length;
    const all = inputs.map((input) => ({ ...asInput(input), showId: mintShowId(), confirmPossible: true }));
    const added = [];
    const skipped = [];
    const failed = [];
    let offlineFrom = all.length;

    setBulkAdd({ total: all.length, completed: 0, added: 0, running: true });
    let results = [];
    try {
      results = await commitShowInputs(all, {
        onProgress: (n) => setBulkAdd({ total: all.length, completed: n, added: 0, running: true }),
      });
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      results = err.done || [];
      offlineFrom = results.length;
    }

    results.forEach((res, i) => {
      if (res.error) failed.push({ candidate: inputs[i], reason: res.error.message || res.error.code });
      else if (res.mergedInto) skipped.push(inputs[i]);
      else if (res.created) added.push(asLoadedShow(res.show));
    });
    appendShows(added);
    // Aggregates once for what the server took, not once per show.
    afterShowsAdded(prevCount, added, { activity: false });

    // The rest, saved on the device for the outbox.
    for (let i = offlineFrom; i < all.length; i++) {
      setBulkAdd({ total: all.length, completed: i, added: added.length, running: true });
      const { showId, ...input } = all[i];
      const id = await addShowOnDevice(input, showId, { silent: true, onPossible: 'add', confirmed: true });
      if (typeof id === 'string') added.push(latestShows.current.find((s) => s.id === id));
      else if (id && id.duplicate) skipped.push(inputs[i]);
      else failed.push({ candidate: inputs[i], reason: 'Couldn’t be saved' });
    }

    setBulkAdd({ total: all.length, completed: all.length, added: added.length, running: false });

    // Never claim success for the batch when part of it failed.
    if (failed.length > 0) {
      setToast({ message: `Added ${added.length} of ${all.length} shows — ${failed.length} failed.`, type: 'error' });
    } else if (added.length > 0) {
      setToast(`Added ${added.length} show${added.length !== 1 ? 's' : ''}.`);
    }

    return { added: added.filter(Boolean), skipped, failed };
  };

  const updateShowData = async (showId, rawUpdates) => {
    // A changed date is stored as ISO, like every other write.
    const updates = rawUpdates && rawUpdates.date
      ? { ...rawUpdates, date: toIsoDate(rawUpdates.date) || rawUpdates.date }
      : rawUpdates;
    if (guestMode) {
      const updatedShows = shows.map(s => s.id === showId ? { ...s, ...updates } : s);
      setShows(updatedShows);
      saveGuestShows(updatedShows);
      return;
    }
    if (!user) return;
    try {
      const showRef = doc(db, 'users', user.uid, 'shows', showId);
      await updateDoc(showRef, updates);
      setShows(prev => prev.map(s => s.id === showId ? { ...s, ...updates } : s));
      requestStatsRecompute();
    } catch (error) {
      console.error('Failed to update show data:', error);
    }
  };

  // ── Setlists from a source (5.60.7) ─────────────────────────────────
  //
  // Every change to a setlist from a band source or setlist.fm is made on
  // the server (netlify/functions/lib/setlistOps.js): the merge, the
  // "never lose a rating" guard, and the write, in a transaction against
  // the show as it is stored. The app asks and shows the answer; it never
  // merges or writes a source's setlist itself. The answers keep the
  // shapes the show page and the review sheet already read: { ok, reason,
  // detail, summary, result, setlist, ambiguous, message }, plus `fields`,
  // what was written, which is folded into the shows here.

  const callSetlistOp = async (op, body) => {
    try {
      const res = await authedFetch(`/.netlify/functions/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: 'http-error', detail: data.error || `HTTP ${res.status}` };
      return data;
    } catch (err) {
      return { ok: false, reason: 'fetch-failed', detail: err?.message || String(err) };
    }
  };

  // What the server wrote, into the shows and the open show.
  const applyServerFields = (showId, fields) => {
    if (!fields) return;
    const patch = (s) => (s.id === showId ? { ...s, ...fields } : s);
    latestShows.current = latestShows.current.map(patch);
    setShows(prev => prev.map(patch));
    if (selectedShow?.id === showId) setSelectedShow(prev => (prev && prev.id === showId ? { ...prev, ...fields } : prev));
    requestStatsRecompute();
  };

  // An admin's own shows with no setlist (the Admin button): the band
  // source where the band has one, else setlist.fm, a few shows per request
  // until every one has been asked about. The scheduled
  // scan-missing-setlists-scheduled does the same for everyone.
  const scanForMissingSetlists = async () => {
    const missing = shows.filter(s => !s.setlist || s.setlist.length === 0).map(s => s.id);
    if (missing.length === 0) {
      alert('All your shows already have setlists!');
      return;
    }
    setSetlistScanning(true);
    setSetlistScanProgress({ current: 0, total: missing.length, found: 0 });
    let remaining = missing;
    let done = 0;
    let found = 0;
    while (remaining.length) {
      const out = await callSetlistOp('scan-missing-setlists', { showIds: remaining });
      if (!Array.isArray(out.results) || !out.results.length) break;
      out.results.forEach((r) => {
        if (r.status === 'found') { found++; applyServerFields(r.showId, r.fields); }
      });
      done += out.results.length;
      setSetlistScanProgress({ current: done, total: missing.length, found });
      remaining = out.remaining || [];
    }
    setSetlistScanning(false);
    if (found > 0) {
      alert(`Found ${found} new setlist${found !== 1 ? 's' : ''}!`);
    } else {
      alert('No new setlists found. Some shows may not have setlists on setlist.fm yet.');
    }
  };

  // The band source's setlist merged into this show's, for the user to see
  // first (the Internet Archive review); nothing is written.
  const proposeSetlistFromSource = (showId) => callSetlistOp('propose-setlist', { showId });

  // A proposal the user accepted: re-merged on the server against the show
  // as stored, refused rather than written if it would lose a rating or a
  // comment. `onlyIfEmpty`: only into a show that still has no setlist.
  const applySetlistProposal = async (showId, result, { onlyIfEmpty = false } = {}) => {
    const out = await callSetlistOp('accept-proposal', { showId, result, onlyIfEmpty });
    if (out.ok) applyServerFields(showId, out.fields);
    return out;
  };

  // ── Stored proposals (the Internet Archive backfill) ──────────────────
  //
  // admin-resync-setlists writes `setlistProposal` on a Grateful Dead show
  // instead of touching its setlist. Accept writes it (the same merge and
  // guard; a proposal the guard refuses is recorded as blocked) and records
  // the decision; Keep current records the decision. With the source
  // switched off the proposals are not offered.
  const pendingProposalShows = useMemo(
    () => (SETLIST_SOURCES.archive ? shows.filter(s => s.setlistProposal?.status === 'pending') : []),
    [shows]
  );

  const acceptStoredProposal = async (showId) => {
    const out = await callSetlistOp('accept-proposal', { showId });
    applyServerFields(showId, out.fields);
    return out;
  };

  const declineStoredProposal = async (showId) => {
    const out = await callSetlistOp('reject-proposal', { showId });
    applyServerFields(showId, out.fields);
    return out.ok ? { ok: true } : out;
  };

  // The user has looked at a `needsReview` setlist and it is right.
  const clearSetlistReview = async (showId) => {
    await updateShowData(showId, { needsReview: false, needsReviewReason: null });
    if (selectedShow?.id === showId) setSelectedShow(prev => (prev ? { ...prev, needsReview: false, needsReviewReason: null } : prev));
  };

  // Re-fetch one show's setlist from its band source and write it, for the
  // sources that need no review (the server refuses an Archive setlist
  // here: those go through the review sheet).
  const resyncSetlistFromSource = async (showId) => {
    const out = await callSetlistOp('resync-show', { showId });
    if (out.ok) applyServerFields(showId, out.fields);
    return out;
  };

  // ── Delete show ─────────────────────────────────────────────────────
  const deleteShow = async (showId) => {
    if (guestMode) {
      const updatedShows = shows.filter(s => s.id !== showId);
      setShows(updatedShows);
      saveGuestShows(updatedShows);
      if (selectedShow?.id === showId) setSelectedShow(null);
      setToast('Show deleted.');
      return;
    }

    if (!user) return;

    try {
      const showRef = doc(db, 'users', user.uid, 'shows', showId);
      await deleteDoc(showRef);
      const updatedShows = shows.filter(s => s.id !== showId);
      setShows(updatedShows);
      if (selectedShow?.id === showId) setSelectedShow(null);

      await updateUserProfile(user, updatedShows);
      requestStatsRecompute();
      setToast('Show deleted.');
    } catch (error) {
      console.error('Failed to delete show:', error);
      setToast({ message: 'Failed to delete show. Please try again.', type: 'error' });
      throw error;
    }
  };

  // === FESTIVAL FUNCTIONS ===
  //
  // TWO DOCUMENTS PER USER PER FESTIVAL. This replaces 5.28.0's fully
  // per-user festivals, where two people who both went to Bonnaroo 2026
  // created two unrelated records.
  //
  //   festivals/{festivalId} — the CANONICAL, shared document. One per
  //   real-world festival edition. Readable by any signed-in user, and
  //   written only by the server since 5.60.36: create and the creator's
  //   (or admin's) edit are netlify/functions/festivals.js. Fields, and
  //   these are the only fields it ever holds:
  //       name            string   as the creator typed it
  //       nameNormalized  string   lib/festivalMatch normalizeFestivalName(name),
  //                                the key the dedup prefix query ranges over
  //       startDate       string   yyyy-MM-dd   } both, or neither (5.58.0):
  //       endDate         string   yyyy-MM-dd   } == startDate for one day
  //       year            number   the start date's year; on its own when
  //                                the dates aren't known. Absent from
  //                                festivals created before 5.58.0 and
  //                                from catalog festivals, which always
  //                                have dates. lib/festivalDates.js reads
  //                                all three, so screens never need to.
  //       location        string   free text city/state, or a venue
  //       edition         string   optional, e.g. "2026"
  //       createdBy       string   uid
  //       createdAt       Timestamp
  //       updatedAt       Timestamp
  //
  //   Two kinds of document add to those, both written only with the Admin
  //   SDK: lineup fields from netlify/functions/festival-lineup.js, and
  //   catalog festivals from netlify/functions/admin-seed-festivals.js
  //   (createdBy "system:seed", plus source/seedKey/seedConfidence/genre/
  //   status/notes — see lib/festivalCatalog.js for the two that are shown).
  //   The client never writes either kind of field.
  //
  //   users/{uid}/festivals/{attendanceId} — the per-user ATTENDANCE
  //   record, in the same private subcollection festivals have always
  //   lived in. Fields:
  //       festivalId      string   pointer to the canonical document
  //       notes           string   this user's notes
  //       rating          number|null  this user's rating
  //       myLineup        string[] the lineup this user typed (private)
  //       createdAt, updatedAt
  //   Created (create, join) and deleted (leave) by festivals.js; notes and
  //   myLineup are this user's own field writes.
  //
  // NOTHING PERSONAL GOES IN THE CANONICAL DOCUMENT, AND NO CANONICAL
  // FIELD IS COPIED ONTO THE ATTENDANCE RECORD. That is the whole point of
  // the split: the failure mode here is the same fact living in both
  // documents and drifting, so a name or date change by the creator is
  // visible to everyone immediately because nobody else stored a copy.
  // loadFestivals joins the two at read time.
  //
  // ATTENDANCE ID vs FESTIVAL ID. A show's `festivalId` field points at
  // the *attendance* record's id, exactly as it did before this change —
  // so no show document had to be rewritten to move to shared festivals,
  // and /festivals/?festival=<id> links from before it still resolve. The
  // canonical id is reached through the attendance record's own
  // `festivalId` field. Everything that takes a "festivalId" argument in
  // this file (attachShowsToFestival, detachShowsFromFestival,
  // importShowsToFestival, useFestivalShows) means the attendance id.
  //
  // Link direction for shows is unchanged: `festivalId` lives on the Show
  // doc rather than `showIds` on the festival, because shows are already
  // loaded in full into `shows` state, so filtering that array is cheap
  // and never needs a second write to stay consistent. A show may belong
  // to at most one festival; attachShowsToFestival reports any show
  // already attached elsewhere as a `conflict` rather than silently
  // double-attaching.
  //
  // DUPLICATE CANONICAL FESTIVALS are cleaned up by the admin merge tool,
  // not from here: netlify/functions/admin-merge-festivals.js, surfaced
  // beside the other bulk tools in components/AdminView.jsx. It uses the
  // same match rule this file does, via the shared CommonJS copy in
  // netlify/functions/lib/festivalMatchRule.js.
  //
  // Nothing on the client can do this, by design. Merging means deleting a
  // canonical festival, and firestore.rules says `allow delete: if false`
  // for every client; the tool deletes with the admin SDK, which bypasses
  // rules. So a user who spots a duplicate has no self-service path and is
  // not meant to — silently repointing other people's attendance records
  // is not a thing one attendee should be able to do to another.

  // Finds canonical festivals that are probably the one the user is about
  // to create. The catalog queries (a name prefix and a ±7-day start
  // window, 20 each) and the rule run on the server since 5.60.8
  // (netlify/functions/lib/festivalMatchServer.js); see there.
  const findFestivalMatchesFor = async (draft) => {
    if (!user || !draft?.name?.trim() || (!draft?.startDate && !draft?.year)) return [];
    // Matched on the server (match-festivals, 5.60.8): the catalog's
    // candidates, the user's own festivals left out, the one rule
    // (lib/festivalMatch.js). A failed lookup must never block creation —
    // the worst outcome is a duplicate the rule will surface next time.
    try {
      const res = await authedFetch('/.netlify/functions/match-festivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, startDate: draft.startDate || '', endDate: draft.endDate || '',
          ...(Number.isInteger(draft.year) ? { year: draft.year } : {}), location: draft.location || '',
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.matches) ? data.matches : [];
    } catch (error) {
      console.warn('Festival match lookup failed:', error.message);
      return [];
    }
  };


  // Creating, joining, leaving and editing a festival's shared details go
  // through netlify/functions/festivals.js (5.60.36, Stage 5 Part 2): the
  // canonical document is read by everyone who attends, so no app writes
  // it. Each answers the joined festival (lib/festivalCatalog.js). Notes and
  // the typed lineup stay this user's own field writes (updateFestivalData).
  const festivalError = (error, fallback) => {
    setToast({ message: error?.offline || error?.status ? error.message : fallback, type: 'error' });
  };

  // Joins an existing canonical festival: only this user's attendance
  // record is written. Joining twice answers the record already there.
  const joinFestival = async (canonicalFestival) => {
    if (!user) throw new Error('Sign in required to join a festival.');
    if (!canonicalFestival?.id) throw new Error('No festival to join.');
    const already = (festivals || []).find(f => f.festivalId === canonicalFestival.id);
    if (already) return already;
    try {
      const { festival } = await callFestivals('join', {
        festivalId: canonicalFestival.id, attendanceId: mintAttendanceId(user.uid),
      });
      setFestivals(prev => (prev.some(f => f.id === festival.id) ? prev : [...prev, festival]));
      setToast(`Joined ${festival.name}.`);
      return festival;
    } catch (error) {
      console.error('Failed to join festival:', error);
      festivalError(error, 'Failed to join that festival. Please try again.');
      throw error;
    }
  };

  // Creates a canonical festival and this user's attendance record, in one
  // batch on the server. Two users creating the same festival within
  // seconds both succeed (no distributed lock); the match rule surfaces the
  // near-duplicate to the next person.
  const createFestival = async (festivalData) => {
    if (!user) throw new Error('Sign in required to create a festival.');
    try {
      const { festival } = await callFestivals('create', {
        attendanceId: mintAttendanceId(user.uid),
        name: (festivalData.name || '').trim(),
        startDate: festivalData.startDate || '',
        endDate: festivalData.endDate || '',
        ...(festivalData.year ? { year: Number(festivalData.year) } : {}),
        location: festivalData.location || '',
        edition: festivalData.edition || '',
        notes: festivalData.notes || '',
      });
      setFestivals(prev => (prev.some(f => f.id === festival.id) ? prev : [...prev, festival]));
      setToast('Festival created.');
      return festival;
    } catch (error) {
      console.error('Failed to create festival:', error);
      festivalError(error, 'Failed to create festival. Please try again.');
      throw error;
    }
  };

  // Splits an edit between the two documents by field. Shared details
  // (name/dates/location/edition) go to the server's `update`, which only
  // the creator (or admin) may make. Personal fields (notes, rating,
  // myLineup) are this user's own attendance record, one updateDoc.
  const CANONICAL_FESTIVAL_FIELDS = ['name', 'startDate', 'endDate', 'year', 'location', 'edition'];

  const updateFestivalData = async (attendanceId, updates) => {
    if (!user) return;
    const festival = (festivals || []).find(f => f.id === attendanceId);
    if (!festival) return;

    const canonicalPatch = {};
    const personalPatch = {};
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (CANONICAL_FESTIVAL_FIELDS.includes(key)) canonicalPatch[key] = value;
      else personalPatch[key] = value;
    });
    // Only what changed: the edit form sends every field, and a joiner's
    // save carries only notes.
    for (const key of Object.keys(canonicalPatch)) {
      if ((canonicalPatch[key] ?? '') === (festival[key] ?? '')) delete canonicalPatch[key];
    }
    if (['startDate', 'endDate', 'year'].some(k => k in canonicalPatch)) {
      // Dates are rewritten whole on the server: send all three.
      canonicalPatch.startDate = updates.startDate ?? festival.startDate ?? '';
      canonicalPatch.endDate = updates.endDate ?? festival.endDate ?? '';
      canonicalPatch.year = updates.year ?? (canonicalPatch.startDate ? undefined : festival.year);
      if (canonicalPatch.year === undefined || canonicalPatch.year === '') delete canonicalPatch.year;
    }

    if (Object.keys(canonicalPatch).length > 0 && !festival.isCreator && !festival.unmigrated) {
      setToast({
        message: festival.isSeeded
          ? 'Festivals from the MySetlists catalog can’t be edited here.'
          : 'Only the person who created this festival can change its details.',
        type: 'error',
      });
      return;
    }

    try {
      let fromServer = null;
      if (Object.keys(canonicalPatch).length > 0) {
        ({ festival: fromServer } = await callFestivals('update', { attendanceId, ...canonicalPatch }));
      }
      if (Object.keys(personalPatch).length > 0) {
        await updateDoc(doc(db, 'users', user.uid, 'festivals', attendanceId), {
          ...personalPatch,
          updatedAt: serverTimestamp(),
        });
      }
      setFestivals(prev => prev.map(f => (
        f.id === attendanceId ? { ...f, ...(fromServer || {}), ...personalPatch } : f
      )));
    } catch (error) {
      console.error('Failed to update festival:', error);
      festivalError(error, 'Failed to save festival changes. Please try again.');
      throw error;
    }
  };

  // Leaving deletes ONLY this user's attendance record and detaches every
  // show of theirs from it (on the server, so shows this device hasn't
  // loaded are detached too). The canonical festival survives, including
  // when the person leaving created it. The shows themselves are kept.
  const leaveFestival = async (attendanceId) => {
    if (!user) return;
    try {
      await callFestivals('leave', { attendanceId });
      setShows(prev => prev.map(s => (s.festivalId === attendanceId ? { ...s, festivalId: null } : s)));
      setFestivals(prev => prev.filter(f => f.id !== attendanceId));
      setToast('Left the festival. Your shows were kept in your history.');
    } catch (error) {
      console.error('Failed to leave festival:', error);
      festivalError(error, 'Failed to leave the festival. Please try again.');
      throw error;
    }
  };

  // Attaches multiple shows to a festival in one batch write. Returns
  // { success: true } or, when one or more of the requested shows is
  // already attached to a *different* festival, { success: false, conflicts }
  // without writing anything — the caller decides whether to re-call with
  // `force: true` to move those shows over.
  const attachShowsToFestival = async (festivalId, showIds, { force = false } = {}) => {
    if (!user || !festivalId || !showIds?.length) return { success: false, conflicts: [] };

    if (!force) {
      const conflicts = showIds
        .map(id => shows.find(s => s.id === id))
        .filter(s => s && s.festivalId && s.festivalId !== festivalId)
        .map(s => ({ showId: s.id, artist: s.artist, date: s.date, festivalId: s.festivalId }));
      if (conflicts.length > 0) return { success: false, conflicts };
    }

    try {
      const batch = writeBatch(db);
      showIds.forEach(showId => {
        batch.update(doc(db, 'users', user.uid, 'shows', showId), { festivalId });
      });
      await batch.commit();
      setShows(prev => prev.map(s => showIds.includes(s.id) ? { ...s, festivalId } : s));
      setToast(`Added ${showIds.length} show${showIds.length !== 1 ? 's' : ''} to the festival.`);
      return { success: true };
    } catch (error) {
      console.error('Failed to attach shows to festival:', error);
      setToast({ message: 'Failed to add shows to the festival. Please try again.', type: 'error' });
      throw error;
    }
  };

  // Bulk "import these festival sets and put them all in the festival" —
  // the write half of the lineup search (see
  // components/festivals/FestivalLineupModal.jsx).
  //
  // For each candidate it either (a) reuses the show the user already has
  // logged for that artist/venue/date, or (b) creates a new one — then
  // attaches every one of them to the festival through the existing
  // attachShowsToFestival batch, so there is only ever one attach path.
  //
  // Duplicates by the one rule (lib/showIdentity.js classifyDuplicate,
  // 5.60.6): a set already logged (by setlist.fm id, or artist + venue +
  // day) is attached rather than created again, and a set picked twice in
  // this import is created once. A "possible" match is created: the user
  // picked it from the lineup knowing what they have.
  //
  // `candidates` are setlist.fm rows from the lineup search
  // (search-festival-lineup.js). New sets are written by normalize-show
  // (festival-row inputs, with festivalId), like every other add.
  const importShowsToFestival = async (festivalId, candidates = [], { force = false } = {}) => {
    if (!user || !festivalId || !candidates.length) return { success: false, created: 0, attached: 0, conflicts: [] };

    // Resolve every candidate to either an existing show or a new one
    // *before* writing anything, so a conflict bail-out can't leave newly
    // created shows stranded outside the festival.
    const existingIds = [];
    const fresh = [];
    const prevCount = latestShows.current.length;
    candidates.forEach((row) => {
      const data = showDataFromSetlistfmRow(row);
      const match = classifyDuplicate([...latestShows.current, ...fresh.map((f) => f.data)], data);
      if (match && match.rule !== 'possible') {
        if (match.show.id) existingIds.push(match.show.id);
        return;
      }
      fresh.push({ row, data: { ...data, id: `fresh-${fresh.length}` } });
    });

    // Only already-logged shows can belong to another festival; the ones
    // about to be created obviously can't.
    if (!force) {
      const conflicts = existingIds
        .map(id => latestShows.current.find(s => s.id === id))
        .filter(s => s && s.festivalId && s.festivalId !== festivalId)
        .map(s => ({ showId: s.id, artist: s.artist, date: s.date, festivalId: s.festivalId }));
      if (conflicts.length > 0) return { success: false, created: 0, attached: 0, conflicts };
    }

    const created = [];
    if (fresh.length) {
      try {
        const results = await commitShowInputs(fresh.map(({ row }) => ({
          kind: 'festival-row', row, festivalId, showId: mintShowId(), confirmPossible: true,
        })));
        results.forEach((res) => {
          if (res.created) created.push(asLoadedShow(res.show));
          else if (res.mergedInto) existingIds.push(res.mergedInto);
        });
      } catch (error) {
        console.error('Failed to import festival shows:', error);
        setToast({
          message: error instanceof OfflineError ? 'You’re offline. Import the lineup again when you’re connected.' : 'Failed to add those shows. Please try again.',
          type: 'error',
        });
        throw error;
      }
      appendShows(created);
      afterShowsAdded(prevCount, created, { activity: false });
    }

    // force:true here because the conflict check above already ran against
    // the right set.
    await attachShowsToFestival(festivalId, [...existingIds, ...created.map(s => s.id)], { force: true });

    return { success: true, created: created.length, attached: existingIds.length, conflicts: [] };
  };

  // Detaches shows from whichever festival they're on (does not delete the
  // shows themselves) — one batch write.
  const detachShowsFromFestival = async (showIds) => {
    if (!user || !showIds?.length) return;
    try {
      const batch = writeBatch(db);
      showIds.forEach(showId => {
        batch.update(doc(db, 'users', user.uid, 'shows', showId), { festivalId: null });
      });
      await batch.commit();
      setShows(prev => prev.map(s => showIds.includes(s.id) ? { ...s, festivalId: null } : s));
      setToast(`Removed ${showIds.length} show${showIds.length !== 1 ? 's' : ''} from the festival.`);
    } catch (error) {
      console.error('Failed to remove shows from festival:', error);
      setToast({ message: 'Failed to remove shows from the festival. Please try again.', type: 'error' });
      throw error;
    }
  };

  // === FRIEND FUNCTIONS ===

  // The server reads both names itself, so only the uid goes.
  const sendFriendRequest = async (targetUid) => {
    if (!user || targetUid === user.uid) {
      alert('You cannot send a friend request to yourself.');
      return;
    }
    try {
      // The server checks for a friendship, a request either way and a
      // block, and writes the request (5.60.28). If they had already asked,
      // it accepts theirs instead.
      const { result } = await callFriends('request', { toUid: targetUid });
      if (result === 'already-friends') {
        alert('You are already friends with this user.');
      } else if (result === 'already-requested') {
        alert('Friend request already sent.');
      } else if (result === 'friends') {
        await loadFriends();
        alert('You are now friends!');
      } else {
        alert('Friend request sent!');
      }
    } catch (error) {
      console.error('Failed to send friend request:', error);
      alert(error.status === 429 || error.status === 404 ? error.message : 'Failed to send friend request. Please try again.');
    }
  };

  const sendFriendRequestByEmail = async (email) => {
    if (!user) return;
    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail === user.email?.toLowerCase()) {
      alert('You cannot send a friend request to yourself.');
      return;
    }

    try {
      // The server looks the address up (5.59.7, S-01): profiles no longer
      // carry email, and no client reads anyone else's.
      const match = await callFriends('lookupByEmail', { email: trimmedEmail });
      if (match.self) {
        alert('You cannot send a friend request to yourself.');
        return;
      }
      if (!match.found) {
        alert('No user found with that email address. They may need to sign up first.');
        return;
      }
      await sendFriendRequest(match.uid);
    } catch (error) {
      console.error('Failed to find user or send request:', error);
      alert(error.status === 429 ? error.message : 'Something went wrong. Please try again.');
    }
  };

  const acceptFriendRequest = async (requestId) => {
    if (!user) return;
    try {
      // The server writes both sides (5.59.7, S-04).
      await callFriends('accept', { requestId });
      await loadFriends();
    } catch (error) {
      console.error('Failed to accept friend request:', error);
      alert('Failed to accept friend request. Please try again.');
    }
  };

  const declineFriendRequest = async (requestId) => {
    try {
      await callFriends('decline', { requestId });
    } catch (error) {
      console.error('Failed to decline friend request:', error);
    }
  };

  const removeFriend = async (friendUid) => {
    if (!user) return;
    if (!window.confirm('Remove this friend?')) return;
    try {
      // Both sides, on the server (5.60.11): the app no longer writes into
      // another user's friends list, deletes included.
      await callFriends('remove', { friendUid });
      setFriends(prev => prev.filter(f => f.friendUid !== friendUid));
    } catch (error) {
      console.error('Failed to remove friend:', error);
    }
  };

  // === SHOW TAGGING FUNCTIONS ===

  // Tags are written and emailed by the server (5.60.29, friends.js tag),
  // from the show as stored, never from this copy, and only to mutual
  // friends with no block either way.
  const tagFriendsAtShow = async (show, selectedFriendUids) => {
    if (!user || selectedFriendUids.length === 0) return;
    try {
      const { tagged = [] } = await callFriends('tag', { showId: show.id, friendUids: selectedFriendUids });
      // Functional update: the manual add form tags straight after addShow,
      // from a closure whose `shows` predates the new show. Mapping that
      // stale list would drop the show it just added. The server has added
      // the same uids to the stored list.
      setShows(prev => prev.map(s => (s.id === show.id
        ? { ...s, taggedFriendUids: [...new Set([...(s.taggedFriendUids || []), ...tagged])] }
        : s)));
      setTagFriendsShow(null);
      setToast(`Tagged ${tagged.length} friend${tagged.length !== 1 ? 's' : ''} at ${show.artist}!`);
    } catch (error) {
      console.error('Failed to tag friends:', error);
      alert(error.status && error.status < 500 ? error.message : 'Failed to tag friends. Please try again.');
    }
  };

  // === UPCOMING SHOWS ===
  // Shows the user is going to. Stored apart from `shows` (see
  // lib/upcomingShows.js for why), tagged through the same showTags flow
  // as past shows, and converted into a normal show once the date passes.

  const upcomingRef = (id) => doc(db, 'users', user.uid, UPCOMING_COLLECTION, id);

  // Returns the new (or existing duplicate) id, or null when nothing was
  // saved. Throws a readable Error for invalid input so the form can show it.
  const addUpcomingShow = async (input, { silent = false, extra = {} } = {}) => {
    if (!user || guestMode) return null;
    const problem = validateUpcomingInput(input);
    if (problem) throw new Error(problem);
    const data = normalizeUpcomingInput(input);

    const existing = findDuplicateUpcoming(upcomingShows, data);
    if (existing) {
      if (extra.taggedBy && !existing.taggedBy) {
        await updateDoc(upcomingRef(existing.id), {
          taggedBy: extra.taggedBy,
          taggedByUid: extra.taggedByUid || null,
          originUpcomingId: extra.originUpcomingId || null,
          updatedAt: serverTimestamp(),
        });
      }
      if (!silent) {
        setToast({
          message: `${data.artist} on that date is already in your upcoming shows.`,
          href: upcomingShowHref(existing.id),
          actionLabel: 'View',
        });
      }
      return existing.id;
    }

    const ref = doc(collection(db, 'users', user.uid, UPCOMING_COLLECTION));
    const record = newUpcomingRecord(data, extra, serverTimestamp());
    await setDoc(ref, record);
    // The listener will deliver it too; adding it here means the "View"
    // link resolves on this tick rather than after the round trip.
    setUpcomingShows(prev => sortUpcoming([...prev.filter(u => u.id !== ref.id), { id: ref.id, ...record }]));
    if (!silent) {
      setToast({ message: `Added ${data.artist} to your upcoming shows.`, href: upcomingShowHref(ref.id), actionLabel: 'View' });
    }
    return ref.id;
  };

  const updateUpcomingShow = async (show, input) => {
    if (!user || !show?.id) return;
    const problem = validateUpcomingInput(input);
    if (problem) throw new Error(problem);
    const data = normalizeUpcomingInput(input);
    await updateDoc(upcomingRef(show.id), upcomingUpdate(data, serverTimestamp()));
    setUpcomingShows(prev => sortUpcoming(prev.map(u => (u.id === show.id ? { ...u, ...data } : u))));

    // A friend who hasn't answered yet should be answering about the right
    // date and venue. Accepted copies are theirs and are left alone. The
    // server rebuilds the pending tags from the show as now stored.
    try {
      await callFriends('refreshUpcomingTags', { upcomingId: show.id });
    } catch (e) {
      console.error('Failed to update pending tags for upcoming show:', e);
    }
    setToast('Upcoming show updated.');
  };

  const deleteUpcomingShow = async (show, { silent = false } = {}) => {
    if (!user || !show?.id) return;
    await deleteDoc(upcomingRef(show.id));
    setUpcomingShows(prev => prev.filter(u => u.id !== show.id));
    revokeUpcomingTags(show.id);
    if (!silent) setToast('Upcoming show deleted.');
  };

  // Same showTags documents and the same email as tagging a past show;
  // `upcoming: true` on the show data is what tells the recipient's app (and
  // the email copy) that this is "going to", not "was at".
  const tagFriendsAtUpcomingShow = async (show, selectedFriendUids) => {
    if (!user || !show?.id || selectedFriendUids.length === 0) return;
    // Never a blocked account, even if a stale friend list still holds one
    // (the server checks too).
    const uids = selectedFriendUids.filter(uid => !blockedUserIds.includes(uid));
    if (uids.length === 0) return;
    try {
      const { tagged = [] } = await callFriends('tag', { upcomingId: show.id, friendUids: uids });
      setUpcomingShows(prev => prev.map(u => (u.id === show.id
        ? { ...u, taggedFriendUids: [...new Set([...(u.taggedFriendUids || []), ...tagged])] }
        : u)));
      setTagFriendsShow(null);
      setToast(`Tagged ${tagged.length} friend${tagged.length !== 1 ? 's' : ''} as going to ${show.artist}!`);
    } catch (error) {
      console.error('Failed to tag friends at upcoming show:', error);
      setToast({ message: error.status && error.status < 500 ? error.message : 'Failed to tag friends. Please try again.', type: 'error' });
    }
  };

  const untagFriendFromUpcomingShow = async (show, friendUid) => {
    if (!user || !show?.id || !friendUid) return;
    try {
      // The server takes them off the show and revokes their pending tag.
      await callFriends('revokeTag', { upcomingId: show.id, toUid: friendUid });
      setUpcomingShows(prev => prev.map(u => (u.id === show.id
        ? { ...u, taggedFriendUids: (u.taggedFriendUids || []).filter(uid => uid !== friendUid) }
        : u)));
    } catch (error) {
      console.error('Failed to remove tagged friend:', error);
      setToast({ message: 'Failed to remove that friend. Please try again.', type: 'error' });
    }
  };

  // uid -> 'pending' | 'accepted' | 'declined' | 'revoked' for the tags this
  // user sent on one upcoming show, so its detail view can say who has
  // confirmed. Only the tagger's own tags: a friend's copy of the show
  // never reveals who else they were tagged alongside.
  const loadUpcomingTagStatuses = useCallback(async (upcomingShowId) => {
    if (!user || !upcomingShowId) return {};
    try {
      const snap = await getDocs(query(
        collection(db, 'showTags'),
        where('fromUid', '==', user.uid),
        where('upcomingShowId', '==', upcomingShowId),
      ));
      const statuses = {};
      snap.docs.forEach(d => {
        const t = d.data();
        // Latest wins if a friend was tagged, removed and tagged again.
        if (!statuses[t.toUid] || t.status === 'pending' || t.status === 'accepted') statuses[t.toUid] = t.status;
      });
      return statuses;
    } catch (e) {
      console.error('Failed to load tag statuses:', e);
      return {};
    }
  }, [user]);

  // setlist.fm's setlist for an upcoming show's date, or null. Searches the
  // artist's shows that year, newest first, a few pages deep: a show that
  // has just happened is on page one.
  const findSetlistForUpcomingShow = async (show) => {
    const year = showYear(show.date);
    if (!show.artist || !year) return null;
    for (let page = 1; page <= 3; page++) {
      try {
        const params = new URLSearchParams({ artistName: show.artist, year, p: String(page) });
        const res = await fetch(apiUrl(`/.netlify/functions/search-setlists?${params.toString()}`));
        if (!res.ok) return null;
        const data = await res.json();
        const found = findSetlistForDate(data.setlist || [], show.date, show.venue || '');
        if (found) return found;
        const perPage = data.itemsPerPage || 20;
        if (!data.setlist?.length || page * perPage >= (data.total || 0)) return null;
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        console.error('Setlist lookup for upcoming show failed:', e);
        return null;
      }
    }
    return null;
  };

  // The date has passed and the user says they went: becomes a normal show
  // through addShow (so band sources, activity, profile counts all happen as
  // for any add), with the setlist.fm setlist when there is one and the
  // friend tags carried over. Returns { id, setlistFound } or null.
  const convertUpcomingShow = async (show, { setlist = null } = {}) => {
    if (!user || !show?.id) return null;
    const setlistData = !!setlist;
    const result = await addShow({ kind: 'upcoming', upcomingId: show.id, ...(setlist ? { setlist } : {}) }, { silent: true });
    const newId = typeof result === 'string' ? result : result?.id;
    if (!newId) return null;
    await deleteUpcomingShow(show, { silent: true });
    setToast({
      message: setlistData
        ? `${show.artist} moved to your shows, with the setlist.`
        : `${show.artist} moved to your shows.`,
      href: showHref(newId),
      actionLabel: 'View show',
    });
    return { id: newId, setlistFound: !!setlistData };
  };

  // === SHOWS TOGETHER ===

  // === SHOWS TOGETHER AND SUGGESTIONS (5.60.11) ===
  // Matched on the server (netlify/functions/friends.js): the app gets the
  // shows two friends were both at, never a friend's whole history, and
  // the server creates the "were you there together?" suggestions. Until
  // 5.60.11 the app read every friend's shows itself, once per friend on
  // every show added. Dates are compared as calendar days, setlist.fm ids
  // first (lib/showIdentity.js showMatchKey), as before.

  const getShowsTogether = useCallback(async (friendUid) => {
    try {
      const { shows: together } = await callFriends('showsTogether', { friendUid });
      return Array.isArray(together) ? together : [];
    } catch (error) {
      console.warn('Shows together failed:', error.message);
      return [];
    }
  }, []);

  // How many shows you share with each friend, one request for all of them
  // (the Friends page's cards).
  const getShowsTogetherCounts = useCallback(async (friendUids) => {
    try {
      const { counts } = await callFriends('showsTogetherCounts', { friendUids });
      return counts || {};
    } catch (error) {
      console.warn('Shows together counts failed:', error.message);
      return {};
    }
  }, []);

  // The key one night is known by across accounts (comments, photos,
  // meetups, notifications): lib/showIdentity.js showMatchKey.
  const normalizeShowKey = (show) => showMatchKey(show);

  // A new show: any friend who has the same night gets a suggestion.
  const checkShowSuggestionsForNewShow = async (newShow) => {
    if (!user || guestMode || friends.length === 0 || !newShow?.id) return;
    await callFriends('suggestionScan', { showId: newShow.id });
  };

  // Retroactive scan — runs once per user on this device (localStorage
  // flag); the server skips suggestions that already exist.
  const runRetroactiveSuggestionScan = async () => {
    if (!user || guestMode || friends.length === 0) return;
    const flagKey = `suggestionScan_${user.uid}`;
    if (storage.get(flagKey)) return;
    try {
      await callFriends('suggestionScan', {});
      storage.set(flagKey, '1');
    } catch (e) {
      console.error('Retroactive suggestion scan failed:', e);
    }
  };

  // The answer, the overall status and the one-time nudge email are the
  // server's (5.60.29, friends.js respondSuggestion): the suggestion is a
  // document both friends share.
  const respondToSuggestion = async (suggestion, response) => {
    if (!user) return;
    try {
      await callFriends('respondSuggestion', { suggestionId: suggestion.id, response });
    } catch (e) {
      console.error('Failed to respond to suggestion:', e);
      setToast({ message: e.status && e.status < 500 ? e.message : 'Couldn’t save your answer. Please try again.', type: 'error' });
    }
  };

  // ── Show tag accept / decline ───────────────────────────────────────
  const acceptShowTag = async (tagId, { silent = false } = {}) => {
    if (!user) return;
    try {
      const tagRef = doc(db, 'showTags', tagId);
      const tagSnap = await getDoc(tagRef);
      if (!tagSnap.exists()) return;
      const tagData = tagSnap.data();

      // A tag on an upcoming show goes to the upcoming list, not history.
      // The server adds it (or credits the one already there) and marks the
      // tag accepted (5.60.29). A tag accepted after the date has passed
      // belongs in history instead: normalize-show marks it accepted then.
      if (tagData.showData?.upcoming) {
        try {
          await callFriends('respondTag', { tagId, response: 'accepted' });
        } catch (e) {
          if (e.code !== 'date_passed') throw e;
          await addShow({ kind: 'tag', tagId, asPastShow: true }, { silent: true });
        }
        if (!silent) {
          setToast(`${tagData.showData.artist || 'Show'} added to your upcoming shows!`);
          navigateTo('shows');
        }
        return;
      }

      // normalize-show reads the tag, builds the show (never the tagger's
      // notes), credits the friend on a show already logged, and marks the
      // tag accepted with the write.
      const result = await addShow({ kind: 'tag', tagId }, { silent: true });
      if (!result) return;

      if (!silent) {
        const artist = tagData.showData?.artist || 'Show';
        if (result && result.duplicate) {
          setToast(`You already have ${artist}! Friend's tag was added to your existing show.`);
        } else {
          setToast(`${artist} added to your shows!`);
        }
        navigateTo('shows');
      }
    } catch (error) {
      console.error('Failed to accept show tag:', error);
      alert('Failed to import tagged show. Please try again.');
    }
  };

  const declineShowTag = async (tagId) => {
    try {
      await callFriends('respondTag', { tagId, response: 'declined' });
    } catch (error) {
      console.error('Failed to decline show tag:', error);
    }
  };

  // Bulk accept all pending show tags + suggestions
  const bulkAcceptAll = async (tags, suggestions) => {
    const results = await Promise.allSettled([
      ...tags.map(tag => acceptShowTag(tag.id, { silent: true })),
      ...suggestions.map(s => respondToSuggestion(s, 'confirmed')),
    ]);
    const accepted = results.filter(r => r.status === 'fulfilled').length;
    setToast(`${accepted} show${accepted !== 1 ? 's' : ''} added to your collection!`);
    navigateTo('shows');
  };

  // Bulk accept pending items from a specific friend
  const bulkAcceptFromFriend = async (friendUid, tags, suggestions) => {
    const friendTags = tags.filter(t => t.fromUid === friendUid);
    const friendSuggestions = suggestions.filter(s => s.participants?.includes(friendUid));
    const results = await Promise.allSettled([
      ...friendTags.map(tag => acceptShowTag(tag.id, { silent: true })),
      ...friendSuggestions.map(s => respondToSuggestion(s, 'confirmed')),
    ]);
    const accepted = results.filter(r => r.status === 'fulfilled').length;
    setToast(`${accepted} show${accepted !== 1 ? 's' : ''} added to your collection!`);
    navigateTo('shows');
  };

  // Accept a pending email tag (new user confirming a show tagged before they joined)
  const acceptPendingEmailTag = async (tag) => {
    if (!user) return;
    try {
      // normalize-show checks the tag was sent to this account's address,
      // builds the show and marks the tag accepted with the write.
      const result = await addShow({ kind: 'email-tag', pendingEmailTagId: tag.id }, { silent: true });
      if (!result) return;
      sendNotification({ type: 'tag_accepted', pendingTagId: tag.id }).catch(() => {});
      setPendingTagsForReview(prev => prev.filter(t => t.id !== tag.id));
      const artist = tag.showData?.artist || 'Show';
      if (result && result.duplicate) {
        setToast(`You already have ${artist}! Friend's tag was added to your existing show.`);
      } else {
        setToast(`${artist} added to your shows!`);
      }
    } catch (error) {
      console.error('Failed to accept pending email tag:', error);
    }
  };

  const declinePendingEmailTag = async (tag) => {
    try {
      await callFriends('respondTag', { pendingEmailTagId: tag.id, response: 'declined' });
      setPendingTagsForReview(prev => prev.filter(t => t.id !== tag.id));
    } catch (error) {
      console.error('Failed to decline pending email tag:', error);
    }
  };

  // Tag a non-registered friend at a show and send them an invite email.
  // The server writes the pending tag from the stored show and emails it
  // (5.60.29, friends.js tag with `emails`).
  const tagFriendByEmail = async ({ name, email: toEmailRaw, message, show }) => {
    if (!user) return;
    const toEmail = toEmailRaw.trim().toLowerCase();
    try {
      await callFriends('tag', { showId: show.id, emails: [{ email: toEmail, name, message: message || null }] });
    } catch (error) {
      console.error('Failed to tag friend by email:', error);
      throw error;
    }
  };

  // === NOTIFICATION MANAGEMENT ===

  const markNotificationsRead = useCallback(async () => {
    if (!user || unreadNotifications.length === 0) return;
    const batch = writeBatch(db);
    unreadNotifications.forEach(n => {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    });
    await batch.commit().catch(() => {});
  }, [user, unreadNotifications]);

  // === INVITE MANAGEMENT FUNCTIONS ===

  const loadInviteStats = async (uid) => {
    if (!uid) return;
    try {
      const snap = await getDocs(query(collection(db, 'invites'), where('inviterUid', '==', uid)));
      const docs = snap.docs.map(d => d.data());
      setInviteStats({
        total: docs.length,
        accepted: docs.filter(d => d.status === 'accepted').length,
      });
    } catch (err) {
      console.log('Failed to load invite stats:', err);
    }
  };

  // Invites are written and emailed by the server (5.60.28). Until then
  // the browser wrote them, and a resend's lastSentAt update was refused by
  // the rules, so resending never sent anything.
  const sendInvite = async (email) => {
    if (!user) return { error: 'Not signed in' };
    const toEmail = email.trim().toLowerCase();

    const existing = pendingInvites.find(inv => inv.inviteeEmail === toEmail);
    if (existing) {
      return { error: 'You already have a pending invite for this email. You can resend it from the Friends > Invites tab.' };
    }

    try {
      await callFriends('invite', { email: toEmail });
      loadInviteStats(user.uid);
      return { success: true };
    } catch (err) {
      console.error('Invite send failed:', err);
      return { error: err.status && err.status < 500 ? err.message : 'Failed to send invite. Please try again.' };
    }
  };

  const resendInvite = async (invite) => {
    if (!user) return;
    try {
      const res = await callFriends('resendInvite', { inviteId: invite.id });
      if (res.resent) {
        setToast(`Invite resent to ${invite.inviteeEmail}`);
        return true;
      }
      setToast(res.reason === 'recipient opted out'
        ? 'That address has turned off emails from MySetlists.'
        : 'You can only resend to the same person once per 24 hours.');
      return false;
    } catch (err) {
      console.error('Resend invite failed:', err);
      setToast(err.status === 429 ? err.message : 'Failed to resend invite. Please try again.');
      return false;
    }
  };

  const cancelInvite = async (inviteId) => {
    try {
      await callFriends('cancelInvite', { inviteId });
    } catch (err) {
      console.error('Cancel invite failed:', err);
      setToast('Failed to cancel invite. Please try again.');
    }
  };

  // ── Show / song rating & comment handlers ──────────────────────────
  // ── Editing a show (5.60.9, R-06) ───────────────────────────────────
  //
  // Each edit writes only what it changes. Until 5.60.9 every edit saved
  // the whole show from the copy this device loaded (setDoc with every
  // field), so the web app and the iOS app editing the same show took
  // turns erasing each other: a song rated on the phone was gone the next
  // time the laptop changed the show's comment.
  //
  //   show-level fields (rating, comment, archival pick)  updateDoc of the field
  //   tagged friends                                      arrayUnion
  //   the setlist                                         an edit by song id
  //       (lib/setlistEdits.js), applied in a transaction to the setlist
  //       as stored, so what another device changed meanwhile is kept
  //
  // The screen changes at once; the write follows. Offline (or when the
  // transaction can't run) the edit is written from this device's copy,
  // last write wins, as before. A guest's shows are on the device only.

  const showDocRef = (showId) => doc(db, 'users', user.uid, 'shows', showId);

  // The app's copy of one show, patched, everywhere it is held.
  const patchLocalShow = (showId, patch) => {
    const apply = (s) => (s.id === showId ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s);
    latestShows.current = latestShows.current.map(apply);
    setShows(prev => prev.map(apply));
    setSelectedShow(prev => (prev && prev.id === showId ? apply(prev) : prev));
  };

  const updateShowFields = async (showId, fields) => {
    patchLocalShow(showId, fields);
    if (guestMode) { saveGuestShows(latestShows.current); return; }
    if (!user) return;
    try {
      await updateDoc(showDocRef(showId), fields);
      requestStatsRecompute();
    } catch (error) {
      console.error('Failed to save show:', error);
    }
  };

  // The latest edit per show, so an answer from an older transaction
  // doesn't overwrite what a newer edit just put on the screen.
  const setlistEditSeq = useRef(new Map());

  const writeSetlistEdit = async (showId, edit, deviceSetlist, seq) => {
    const ref = showDocRef(showId);
    // Until this edit is back, a snapshot keeps this device's setlist for
    // the show (the transaction isn't in the listener's view until it
    // commits; lib/liveShows.js).
    setlistInFlight.current.set(showId, (setlistInFlight.current.get(showId) || 0) + 1);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    try {
      if (offline) throw new Error('offline');
      const stored = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const next = applySetlistEdit(snap.data().setlist || [], edit);
        if (next.changed) tx.update(ref, { setlist: next.setlist });
        return next.setlist;
      });
      // What is stored now (the edit on top of anyone else's), unless this
      // device has made another edit since.
      if (stored && setlistEditSeq.current.get(showId) === seq) patchLocalShow(showId, { setlist: stored });
    } catch (error) {
      // No connection, or the transaction couldn't run: this device's copy,
      // last write wins (queued until the connection is back).
      updateDoc(ref, { setlist: deviceSetlist })
        .catch((err) => console.error('Failed to save the setlist:', err));
    } finally {
      const left = (setlistInFlight.current.get(showId) || 1) - 1;
      if (left > 0) setlistInFlight.current.set(showId, left); else setlistInFlight.current.delete(showId);
    }
    requestStatsRecompute();
  };

  /**
   * editSetlist(showId, edit) -> applySetlistEdit's answer on this device's
   * copy ({ setlist, changed, removed?, index? }), or null with no such show.
   * The screen changes now; the write runs behind it.
   */
  const editSetlist = (showId, edit) => {
    const show = latestShows.current.find(s => s.id === showId);
    if (!show) return null;
    const result = applySetlistEdit(show.setlist || [], edit);
    if (!result.changed) return result;
    patchLocalShow(showId, { setlist: result.setlist });
    if (guestMode) { saveGuestShows(latestShows.current); return result; }
    if (!user) return result;
    const seq = (setlistEditSeq.current.get(showId) || 0) + 1;
    setlistEditSeq.current.set(showId, seq);
    writeSetlistEdit(showId, edit, result.setlist, seq);
    return result;
  };

  const updateShowRating = async (showId, rating) => {
    const show = latestShows.current.find(s => s.id === showId);
    await updateShowFields(showId, { rating });

    if (user && !guestMode && show) {
      // The server builds the entry from the stored show (5.60.38).
      logRating(showId);
    }
  };

  const updateShowComment = (showId, comment) => updateShowFields(showId, { comment });

  // Remembers which archival recording (a Relisten source uuid) the user
  // picked for this show, so returning to the show doesn't reset the choice.
  const updateArchivalAudioPick = (showId, recordingId) => updateShowFields(showId, { archivalAudioPick: recordingId });

  const addSongToShow = async (showId, songData) => {
    editSetlist(showId, {
      type: 'add',
      song: { id: Date.now().toString(), ...songData, manuallyAdded: true, rating: null },
    });
  };

  const updateSongRating = async (showId, songId, rating) => {
    editSetlist(showId, { type: 'rate', songId, rating });
  };

  const updateSongComment = async (showId, songId, comment) => {
    editSetlist(showId, { type: 'comment', songId, comment });
  };

  const batchRateUnrated = async (showId, rating) => {
    editSetlist(showId, { type: 'rate-unrated', rating });
  };

  // Removes one song from a setlist. Returns { song, index } so a caller
  // can offer to put it back, and null when there was nothing to remove —
  // a double-tap, or a view rendered before someone else's edit.
  //
  // A deleted song takes its rating and its comment with it. The callers
  // that surface this (ShowDetailView's setlist editor, SetlistEditor) are
  // where that is made deliberate; the rule here is only that it says what
  // it removed.
  const deleteSong = async (showId, songId) => {
    const result = editSetlist(showId, { type: 'delete', songId });
    if (!result || !result.removed) return null;
    return { song: result.removed, index: result.index };
  };

  // The undo. Puts the song back exactly as it was — same id, same set,
  // same rating and comment — at the position it came from, so undoing a
  // deletion leaves no trace rather than appending the song to the end of
  // its section. A song already back (an undo pressed twice) is left alone.
  const restoreSongToShow = async (showId, song, index) => {
    if (!song) return;
    editSetlist(showId, { type: 'restore', song, index });
  };

  // The set editor's new order and set labels. Applied to the setlist as
  // stored: each song keeps its stored rating and comment, and a song added
  // elsewhere meanwhile stays (lib/setlistEdits.js reorder).
  const updateSetlistOrder = async (showId, newSetlist) => {
    editSetlist(showId, { type: 'reorder', setlist: newSetlist });
  };

  // ── Stats helpers ───────────────────────────────────────────────────
  // Each takes an optional show list so the Stats page can pass its
  // filtered set (components/shows/ShowFilters.jsx); everything else gets
  // the full library. Song counts are distinct shows — see
  // lib/songCounts.js.
  const getSongStats = (showList = shows) => buildSongStats(showList);

  // One row per band by the lib/stats band key (5.59.15): "Goose" and
  // "goose (US)" are one band, shown under the first spelling, the same
  // band the headline count counts.
  const getArtistStats = (showList = shows) => {
    const artistMap = {};
    showList.forEach(show => {
      const key = bandKey(show.artist);
      if (!key) return;
      if (!artistMap[key]) {
        artistMap[key] = { name: show.artist, count: 0, ratings: [], uniqueSongs: new Set() };
      }
      artistMap[key].count++;
      (show.setlist || []).forEach(song => { const k = songKey(song && song.name); if (k) artistMap[key].uniqueSongs.add(k); });
      if (show.rating) artistMap[key].ratings.push(show.rating);
    });
    return Object.values(artistMap)
      .map((data) => ({
        name: data.name,
        count: data.count,
        totalSongs: data.uniqueSongs.size,
        avgRating: data.ratings.length ?
          (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(1) : null,
      }))
      .sort((a, b) => b.count - a.count);
  };

  // ── Followed bands ────────────────────────────────────────────────
  // One band is one band however it is typed: "Goose" and "goose " are
  // the same follow, as they are to the daily alert job
  // (netlify/functions/lib/followedBandAlerts.js's artistKey).
  const bandKey = (name) => (name || '').trim().toLowerCase();

  const toggleFavoriteArtist = async (artistName) => {
    if (!user?.uid || !artistName) return;
    const profileRef = doc(db, 'userProfiles', user.uid);
    const isFav = favoriteArtists.some(a => bandKey(a.name) === bandKey(artistName));
    try {
      if (isFav) {
        const updated = favoriteArtists.filter(a => bandKey(a.name) !== bandKey(artistName));
        setFavoriteArtists(updated);
        await updateDoc(profileRef, { favoriteArtists: updated });
        setToast(`Unfollowed ${artistName.trim()}`);
      } else {
        // Add — fetch mbid from setlist.fm
        let mbid = null;
        try {
          const res = await fetch(`${apiUrl('/.netlify/functions/get-artist-info')}?artistName=${encodeURIComponent(artistName)}`);
          if (res.ok) {
            const data = await res.json();
            mbid = data.mbid || null;
          }
        } catch (e) {
          console.log('Could not fetch mbid for', artistName, e);
        }
        const newFav = { name: artistName.trim(), mbid, addedAt: new Date().toISOString() };
        const updated = [...favoriteArtists, newFav];
        setFavoriteArtists(updated);
        await updateDoc(profileRef, { favoriteArtists: updated });
        // Finds the band on Ticketmaster for on-sale alerts. Not waited for,
        // and the scan backfills anything this misses.
        user.getIdToken()
          .then((idToken) => fetch(apiUrl('/.netlify/functions/resolve-artist'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ artistName: artistName.trim() }),
          }))
          .catch(() => {});
        const noCity = await loadAlertSettings(user.uid).then((s) => !s?.homeLocation).catch(() => false);
        const cityNudge = noCity ? { href: '/profile/', actionLabel: 'Add city' } : {};
        const cityLine = noCity ? ' Add your city to get on-sale alerts.' : '';
        // The first follow on an iPhone that has never been asked offers
        // push, with an explainer before iOS's own prompt, once the offer
        // is switched on in config/app (iosPushOfferEnabled, 5.59.14).
        if ((await pushOfferEnabled()) && await shouldOfferPush()) {
          markPushOffered();
          setPushOffer(artistName.trim());
        } else if ((await pushPermission()) === 'granted') {
          setToast({ message: `Following ${artistName.trim()}. We'll let you know when they announce a tour.${cityLine}`, ...cityNudge });
        } else {
          setToast({ message: `Following ${artistName.trim()}. We'll email you when they announce a tour.${cityLine}`, ...cityNudge });
        }
      }
    } catch (err) {
      console.error('Failed to toggle followed band:', err);
      setToast({ message: "Couldn't update the bands you follow. Please try again.", type: 'error' });
    }
  };

  const isArtistFavorite = (artistName) => {
    return favoriteArtists.some(a => bandKey(a.name) === bandKey(artistName));
  };

  // Apply a ?follow= link once signed in and the current follows are known
  // (following twice would toggle the band back off).
  useEffect(() => {
    if (!user?.uid || guestMode || !favoritesLoaded) return;
    const band = storage.get(STORAGE_KEYS.PENDING_FOLLOW);
    if (!band) return;
    storage.remove(STORAGE_KEYS.PENDING_FOLLOW);
    if (isArtistFavorite(band)) {
      setToast(`You already follow ${band}`);
    } else {
      toggleFavoriteArtist(band);
    }
  }, [user?.uid, guestMode, favoritesLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const getVenueStats = (showList = shows) => {
    const venueMap = {};
    // Grouped by the shared venue rule (lib/venueCount.js, B-04); shown
    // under the first spelling seen.
    showList.forEach(show => {
      const key = venueCountKey(show);
      if (!key) return;
      if (!venueMap[key]) {
        venueMap[key] = { name: show.venue + (show.city ? `, ${show.city}` : ''), count: 0, artists: new Set() };
      }
      venueMap[key].count++;
      venueMap[key].artists.add(show.artist);
    });
    return Object.values(venueMap)
      .map((data) => ({
        name: data.name,
        count: data.count,
        artists: data.artists.size,
      }))
      .sort((a, b) => b.count - a.count);
  };

  // === VENUE RATING HELPERS ===

  const normalizeVenueKey = (venue, city) =>
    `${(venue || '').trim().toLowerCase()}::${(city || '').trim().toLowerCase()}`;

  const getVenueRatings = async (venueKey) => {
    const snap = await getDocs(query(collection(db, 'venueRatings'), where('venueKey', '==', venueKey)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  const computeVenueAggregate = (ratings) => {
    if (!ratings.length) return null;
    const avg = arr => {
      const valid = arr.filter(v => v != null && v > 0);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    return {
      count: ratings.length,
      overallAvg: avg(ratings.map(r => r.overallRating)),
      subAvgs: {
        soundQuality: avg(ratings.map(r => r.subRatings?.soundQuality)),
        sightlines: avg(ratings.map(r => r.subRatings?.sightlines)),
        atmosphere: avg(ratings.map(r => r.subRatings?.atmosphere)),
        accessibility: avg(ratings.map(r => r.subRatings?.accessibility)),
        foodDrinks: avg(ratings.map(r => r.subRatings?.foodDrinks)),
      },
    };
  };

  const getTopRatedShows = (showList = shows) => {
    return showList
      .filter(s => s.rating)
      .sort((a, b) => b.rating - a.rating || parseDate(b.date) - parseDate(a.date))
      .slice(0, 10);
  };

  // ── Share collection ────────────────────────────────────────────────
  const shareCollection = async () => {
    const ratedShows = shows.filter(s => s.rating);
    const avgShowRating = ratedShows.length
      ? (ratedShows.reduce((acc, s) => acc + s.rating, 0) / ratedShows.length).toFixed(1)
      : null;

    const totalSongs = shows.reduce((acc, show) => acc + (show.setlist?.length || 0), 0);

    // Find top artist
    const artistCounts = {};
    shows.forEach(s => { artistCounts[s.artist] = (artistCounts[s.artist] || 0) + 1; });
    const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Try to create a persistent shareable link
    try {
      if (user && !guestMode) {
        const token = await user.getIdToken();
        // The server builds the snapshot from this account's own shows
        // (5.59.12); nothing about them is sent from here.
        const res = await fetch(apiUrl('/.netlify/functions/create-shared-collection'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: '{}',
        });

        if (res.ok) {
          const { url } = await res.json();
          await navigator.clipboard.writeText(url);
          setToast({ message: 'Share link copied to clipboard!', type: 'success' });
          return;
        }
        // A limit (429) says so instead of silently falling back to text.
        if (res.status === 429) {
          const data = await res.json().catch(() => null);
          setToast({ message: apiErrorMessage(res, data, 'Couldn’t share right now.'), type: 'error' });
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to create shared collection, falling back to text share:', err);
    }

    // Fallback: copy text to clipboard
    const shareText = `My Concert Collection\n\n${shows.length} shows | ${totalSongs} songs${avgShowRating ? ` | Avg show rating: ${avgShowRating}/10` : ''}\n\nTop Songs:\n${getSongStats().slice(0, 5).map((s, i) => `${i + 1}. ${s.name} (${s.count}x)`).join('\n')}`;

    try {
      await navigator.clipboard.writeText(shareText);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2000);
    } catch (error) {
      alert(shareText);
    }
  };

  // ── Derived / memoized data ─────────────────────────────────────────
  const importedIds = useMemo(() => new Set(shows.map(s => s.setlistfmId).filter(Boolean)), [shows]);
  // setlist.fm id -> this user's show id, so a search result that is
  // already in the library can link straight to it (SearchView).
  const showIdBySetlistfmId = useMemo(() => {
    const map = new Map();
    shows.forEach(s => { if (s.setlistfmId) map.set(s.setlistfmId, s.id); });
    return map;
  }, [shows]);

  const availableYears = useMemo(() => availableYearsFor(shows), [shows]);

  // My Shows' list. The filtering itself is lib/showFilters.js, shared with
  // Stats, Tours and Festivals; only My Shows sorts the result.
  const sortedFilteredShows = useMemo(() => {
    const filtered = applyShowFilters(shows, { searchTerm, filterYear, filterDate });
    return filtered.sort((a, b) => {
      if (sortBy === 'date') return parseDate(b.date) - parseDate(a.date);
      if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
      if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
      return 0;
    });
  }, [shows, searchTerm, sortBy, filterYear, filterDate]);

  const artistGroups = useMemo(() => {
    const groups = {};
    sortedFilteredShows.forEach(show => {
      if (!groups[show.artist]) {
        groups[show.artist] = [];
      }
      groups[show.artist].push(show);
    });
    return Object.entries(groups).sort((a, b) => {
      if (sortBy === 'artist') return a[0].localeCompare(b[0]);
      if (sortBy === 'rating') {
        const avgA = a[1].filter(s => s.rating).reduce((acc, s, _, arr) => acc + s.rating / arr.length, 0) || 0;
        const avgB = b[1].filter(s => s.rating).reduce((acc, s, _, arr) => acc + s.rating / arr.length, 0) || 0;
        return avgB - avgA;
      }
      return b[1].length - a[1].length;
    });
  }, [sortedFilteredShows, sortBy]);

  // The headline numbers (5.59.15): the server's userStats/{uid} when it
  // matches the shows on screen, otherwise the same lib/stats computed
  // here (a new account, or the seconds between a change and the server's
  // recompute). One definition either way.
  const localStats = useMemo(() => computeUserStats(shows), [shows]);
  const headlineStats = useMemo(() => (
    serverStats && serverStats.statsVersion === STATS_VERSION && serverStats.showCount === shows.length
      ? serverStats
      : localStats
  ), [serverStats, localStats, shows.length]);

  // No song count here: no screen showed one (Stage 5 call D; native's
  // "Different song titles" tile has no web counterpart).
  const summaryStats = useMemo(() => ({
    avgRating: headlineStats.avgShowRating,
    uniqueArtists: headlineStats.bandCount,
    uniqueVenues: headlineStats.venueCount,
  }), [headlineStats]);

  // ── Context value ───────────────────────────────────────────────────
  const value = {
    // Navigation
    router,
    pathname,
    searchParams,
    navigateTo,
    activeView,
    setActiveView,

    // Core state
    shows,
    setShows,
    showForm,
    setShowForm,
    bucketListPrefill,
    setBucketListPrefill,
    selectedShow,
    setSelectedShow,
    searchTerm,
    setSearchTerm,
    filterYear,
    setFilterYear,
    filterDate,
    setFilterDate,
    availableYears,
    shareSuccess,
    setShareSuccess,
    isLoading,
    setIsLoading,
    showsLoadedFor,
    sortBy,
    setSortBy,
    selectedArtist,
    setSelectedArtist,
    statsTab,
    setStatsTab,
    friendsInitialTab,
    setFriendsInitialTab,

    // Auth
    user,
    authLoading,
    authModal,
    setAuthModal,
    pendingHeard,
    clearPendingHeard,
    guestMode,
    setGuestMode,
    showGuestPrompt,
    setShowGuestPrompt,
    handleLogin,
    handleLogout,
    openAuthModal,
    closeAuthModal,
    switchAuthMode,
    handleAuthSuccess,
    enterGuestMode,
    exitGuestMode,

    // Admin
    isAdmin,

    // Account age
    userCreatedAt,
    isReturningUser,

    // Community
    communityStats,
    userRank,

    // Setlist scanning
    setlistScanning,
    setSetlistScanning,
    setlistScanProgress,
    setSetlistScanProgress,
    scanForMissingSetlists,

    // Sidebar
    sidebarOpen,
    setSidebarOpen,

    // Friends
    friends,
    visibleFriends,
    setFriends,
    friendUids,
    loadFriends,
    pendingFriendRequests,
    sentFriendRequests,
    pendingShowTags,
    tagFriendsShow,
    setTagFriendsShow,
    sendFriendRequest,
    sendFriendRequestByEmail,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,

    // Show tagging
    tagFriendsAtShow,
    acceptShowTag,
    declineShowTag,
    bulkAcceptAll,
    bulkAcceptFromFriend,
    tagFriendByEmail,

    // Show suggestions
    showSuggestions,
    myPendingSuggestions,
    myConfirmedSuggestions,
    respondToSuggestion,
    normalizeShowKey,

    // Shows together
    getShowsTogether,
    getShowsTogetherCounts,

    // Pending invites
    pendingInvites,
    sentPendingEmailTags,
    inviteStats,
    sendInvite,
    resendInvite,
    cancelInvite,

    // Pending email tags
    pendingTagsForReview,
    setPendingTagsForReview,
    acceptPendingEmailTag,
    declinePendingEmailTag,

    // Notifications
    unreadNotifications,
    pendingNotificationCount,
    markNotificationsRead,

    // Welcome state
    welcomeState,
    setWelcomeState,

    // Toast
    toast,
    setToast,

    // Terms agreement (Guideline 1.2) — null until resolved, see the
    // state declaration above.
    termsAccepted,
    acceptTerms,
    isSuspended,

    // Moderation — blocked accounts (Guideline 1.2)
    blockedUserIds,
    isBlocked,
    blockUser,
    unblockUser,
    withoutBlocked,

    // Favorite artists
    favoriteArtists,
    toggleFavoriteArtist,
    isArtistFavorite,
    pushOffer,
    setPushOffer,

    // Venue rating
    venueRatingShow,
    setVenueRatingShow,
    normalizeVenueKey,
    getVenueRatings,
    computeVenueAggregate,

    // Festivals
    festivals,
    festivalsLoading,
    createFestival,
    updateFestivalData,
    findFestivalMatches: findFestivalMatchesFor,
    joinFestival,
    leaveFestival,
    attachShowsToFestival,
    detachShowsFromFestival,
    importShowsToFestival,

    // Show CRUD
    addShow,
    addShowsFromTour,
    bulkAdd,
    updateShowData,
    resyncSetlistFromSource,
    proposeSetlistFromSource,
    applySetlistProposal,
    pendingProposalShows,
    acceptStoredProposal,
    declineStoredProposal,
    clearSetlistReview,
    restoreSongToShow,
    deleteShow,
    updateShowRating,
    updateShowComment,
    updateArchivalAudioPick,
    addSongToShow,
    updateSongRating,
    updateSongComment,
    batchRateUnrated,
    deleteSong,
    updateSetlistOrder,

    // Stats
    getSongStats,
    getArtistStats,
    getVenueStats,
    getTopRatedShows,
    shareCollection,

    // Derived data
    importedIds,
    showIdBySetlistfmId,
    upcomingShows,
    upcomingLoaded,
    addUpcomingShow,
    updateUpcomingShow,
    deleteUpcomingShow,
    tagFriendsAtUpcomingShow,
    untagFriendFromUpcomingShow,
    loadUpcomingTagStatuses,
    findSetlistForUpcomingShow,
    convertUpcomingShow,
    sortedFilteredShows,
    artistGroups,
    summaryStats,
    headlineStats,
  };

  return (
    <AppContext.Provider value={value}>
      <SearchParamsListener onChange={setSearchParams} />
      {children}
    </AppContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export default AppContext;
