"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { nativeOAuthSignIn, isNativePlatform } from '@/lib/native-auth';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  serverTimestamp, onSnapshot, query, where, addDoc, writeBatch, limit,
} from 'firebase/firestore';
import { auth, db, googleProvider, browserPopupRedirectResolver } from '@/lib/firebase';
import { formatDate, parseDate, normalizeSongTitle } from '@/lib/utils';
import { ADMIN_EMAILS } from '@/lib/constants';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { apiUrl } from '@/lib/api';
import { fetchArtistImage } from '@/lib/artistImage';
import { isReturningUser as checkIsReturningUser } from '@/lib/popupManager';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { enrichShowDataWithBandSetlist, fetchBandSetlist, fetchBandSetlistWithReason, bandSetlistShowFields } from '@/lib/bandSetlist';
import { mergeBandSetlist, describeSummary } from '@/lib/bandSetlistMerge';
import { resolveSource } from '@/lib/setlistSources';
import { removeSongFromSetlist, insertSongAt } from '@/lib/setlistGrouping';
import { buildExistingShowIndex, existingShowStatus } from '@/lib/tourBrowse';
import { normalizeFestivalName, findFestivalMatches as matchFestivals } from '@/lib/festivalMatch';
import { logActivity } from '@/lib/activityFeed';
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
import { sendEmailIfAllowed } from '@/lib/email';
import {
  inviteEmail,
  friendJoinedEmail,
  tagByEmailNotification,
  tagAcceptedEmail,
  showTagNotification,
  suggestionNudgeEmail,
} from '@/lib/emailTemplates';

// Gap between writes in a bulk tour add. Enough to keep a 40-night
// selection from arriving at Firestore as one burst, small enough that a
// typical five-night selection still feels immediate.
const BULK_ADD_DELAY_MS = 120;

// ── Helper: mint a show document id ─────────────────────────────────────
// Show ids have always been millisecond timestamps as strings, and every
// existing document in Firestore is keyed that way, so the format is fixed.
// The counter is what makes it safe to mint several in a row: `Date.now()`
// alone returns the same value for every call inside the same millisecond,
// which is exactly what a bulk add does. Monotonic, so ids still sort by
// creation order.
let lastMintedShowId = 0;
function mintShowId() {
  const now = Date.now();
  lastMintedShowId = now > lastMintedShowId ? now : lastMintedShowId + 1;
  return String(lastMintedShowId);
}

// ── Helper: the one place a show document's shape is defined ────────────
// Both the single add (addShow) and the bulk tour add (addShowsFromTour)
// build their documents here, so a bulk-added show is byte-for-byte the
// same shape as a hand-added one — setlist, venue, artist, tour name, all
// of it. Change the shape here or not at all.
function buildShowDoc(showData, id) {
  return {
    ...showData,
    id,
    setlist: showData.setlist || [],
    createdAt: new Date().toISOString(),
    // `isManual` means "nobody but the user wrote this setlist", and it is
    // what admin-populate-setlist.js checks before it refuses to overwrite.
    // It used to be derived from setlistfmId alone, which was the same
    // question back when setlist.fm was the only source. A band-sourced
    // show (El Goose, Phish.net — see lib/setlistSources.js) has no
    // setlistfmId and is emphatically not manual, so the source id counts
    // too.
    isManual: !showData.setlistfmId && !isBandSourced(showData),
  };
}

// True when this show's setlist came from a band source rather than from
// setlist.fm or the user. Reads the stored `setlistSource` field rather than
// sniffing for the presence of `footnote`/`transitionMark`: a Goose show
// where nobody wrote any footnotes is still a Goose show from El Goose.
function isBandSourced(showData) {
  const id = showData?.setlistSource;
  return !!id && id !== 'setlistfm';
}

// The Firestore half of the same path. `createdAt` is replaced with a
// server timestamp on the way in (the local ISO string above is what the
// in-memory copy carries until the next load).
async function writeShowDoc(uid, show) {
  const { id, ...showData } = show;
  await setDoc(doc(db, 'users', uid, 'shows', id), { ...showData, createdAt: serverTimestamp() });
}

// ── Helper: update the user's profile doc with current stats ────────────
async function updateUserProfile(user, shows = []) {
  if (!user) return;

  const profileRef = doc(db, 'userProfiles', user.uid);
  const uniqueVenues = new Set(shows.map(s => s.venue)).size;
  const totalSongs = shows.reduce((acc, s) => acc + (s.setlist || []).length, 0);
  const ratedSongs = shows.reduce((acc, s) => acc + (s.setlist || []).filter(song => song.rating).length, 0);

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
    odubleserId: user.uid,
    email: user.email,
    photoURL: user.photoURL || '',
    lastLogin: serverTimestamp(),
    showCount: shows.length,
    songCount: totalSongs,
    ratedSongCount: ratedSongs,
    venueCount: uniqueVenues,
  };

  const existingProfile = await getDoc(profileRef);
  if (!existingProfile.exists()) {
    profileData.createdAt = serverTimestamp();
  }

  await setDoc(profileRef, profileData, { merge: true });
}

// ── Helper: rebuild community-wide leaderboard stats ────────────────────
// This scans every user profile and, per profile, reads that user's entire
// shows subcollection — an N+1 read pattern that gets more expensive as the
// user base grows. It's triggered on every page load plus every add/delete
// show, for every user, but the leaderboard it produces only needs to be
// roughly fresh — so skip the rebuild unless the cached stats are stale.
const COMMUNITY_STATS_MAX_AGE_MS = 60 * 60 * 1000;

async function updateCommunityStats() {
  try {
    const statsRef = doc(db, 'communityStats', 'global');
    const existingStats = await getDoc(statsRef);
    if (existingStats.exists()) {
      const updatedAtMs = existingStats.data().updatedAt?.toMillis?.();
      if (updatedAtMs && Date.now() - updatedAtMs < COMMUNITY_STATS_MAX_AGE_MS) {
        return;
      }
    }

    const profilesSnapshot = await getDocs(collection(db, 'userProfiles'));
    const profiles = profilesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const allSongs = {};
    const allVenues = {};
    let totalShows = profiles.reduce((acc, p) => acc + (p.showCount || 0), 0);
    let totalSongs = profiles.reduce((acc, p) => acc + (p.songCount || 0), 0);

    for (const profile of profiles) {
      try {
        const showsSnapshot = await getDocs(collection(db, 'users', profile.id, 'shows'));
        const userShows = showsSnapshot.docs.map(d => d.data());

        for (const show of userShows) {
          const venueName = show.venue + (show.city ? `, ${show.city}` : '');
          if (!allVenues[venueName]) {
            allVenues[venueName] = { count: 0, artists: new Set() };
          }
          allVenues[venueName].count++;
          allVenues[venueName].artists.add(show.artist);

          const setlist = show.setlist || [];
          for (const song of setlist) {
            const songKey = normalizeSongTitle(song.name) || song.name.toLowerCase().trim();
            if (!allSongs[songKey]) {
              allSongs[songKey] = { songName: song.name, users: new Set(), artists: new Set(), ratings: [] };
            }
            allSongs[songKey].users.add(profile.id);
            allSongs[songKey].artists.add(show.artist);
            if (song.rating) allSongs[songKey].ratings.push(song.rating);
          }
        }
      } catch (_) {
        // Permission denied for other users' shows — skip gracefully
      }
    }

    const topShowsAttended = [...profiles]
      .sort((a, b) => (b.showCount || 0) - (a.showCount || 0))
      .slice(0, 5)
      .map(p => ({ odubleserId: p.id, firstName: p.firstName, photoURL: p.photoURL, count: p.showCount || 0 }));

    const topSongsRated = [...profiles]
      .sort((a, b) => (b.ratedSongCount || 0) - (a.ratedSongCount || 0))
      .slice(0, 5)
      .map(p => ({ odubleserId: p.id, firstName: p.firstName, photoURL: p.photoURL, count: p.ratedSongCount || 0 }));

    const topVenuesVisited = [...profiles]
      .sort((a, b) => (b.venueCount || 0) - (a.venueCount || 0))
      .slice(0, 5)
      .map(p => ({ odubleserId: p.id, firstName: p.firstName, photoURL: p.photoURL, count: p.venueCount || 0 }));

    const topSongsBySightings = Object.values(allSongs)
      .map(s => ({ songName: s.songName, userCount: s.users.size, artists: [...s.artists].slice(0, 3) }))
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 5);

    const topSongsByRating = Object.values(allSongs)
      .filter(s => s.ratings.length >= 2)
      .map(s => ({
        songName: s.songName,
        avgRating: (s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length).toFixed(1),
        ratingCount: s.ratings.length,
        artists: [...s.artists].slice(0, 3),
      }))
      .sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating))
      .slice(0, 5);

    const topVenues = Object.entries(allVenues)
      .map(([name, data]) => ({ venueName: name, showCount: data.count, artistCount: data.artists.size }))
      .sort((a, b) => b.showCount - a.showCount)
      .slice(0, 5);

    await setDoc(statsRef, {
      updatedAt: serverTimestamp(),
      totalUsers: profiles.length,
      totalShows,
      totalSongs,
      topShowsAttended,
      topSongsRated,
      topVenuesVisited,
      topSongsBySightings,
      topSongsByRating,
      topVenues,
    });
  } catch (error) {
    console.error('Failed to update community stats:', error);
  }
}

// ── Context ─────────────────────────────────────────────────────────────
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Core state ──────────────────────────────────────────────────────
  const [shows, setShows] = useState([]);
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
  const [sortBy, setSortBy] = useState('date');
  const [selectedArtist, setSelectedArtist] = useState(null);

  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [localShowsToMigrate, setLocalShowsToMigrate] = useState([]);
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

  // Celebration animation
  const [showCelebration, setShowCelebration] = useState(false);

  // Friends feature state
  const [friends, setFriends] = useState([]);
  const [pendingFriendRequests, setPendingFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [pendingShowTags, setPendingShowTags] = useState([]);
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

  // Favorite artists
  const [favoriteArtists, setFavoriteArtists] = useState([]);

  // In-app notifications
  const [unreadNotifications, setUnreadNotifications] = useState([]);

  // Admin
  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

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

  // Derived suggestion state
  const myPendingSuggestions = showSuggestions.filter(s => s.responses?.[user?.uid] === 'pending' && s.overallStatus !== 'declined');
  const myConfirmedSuggestions = showSuggestions.filter(s => s.overallStatus === 'confirmed');

  const pendingNotificationCount = pendingInvites.length + pendingFriendRequests.length;

  // Post-signup welcome + pending tags
  const [welcomeState, setWelcomeState] = useState(null);
  const [pendingTagsForReview, setPendingTagsForReview] = useState([]);

  // Global toast notification
  const [toast, setToast] = useState(null);

  // Venue rating modal
  const [venueRatingShow, setVenueRatingShow] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear friendsInitialTab when navigating away from friends
  useEffect(() => {
    if (activeView !== 'friends') {
      setFriendsInitialTab(null);
    }
  }, [activeView]);

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

      // Enrich with each friend's live show count from their profile
      // (the friend subcollection doc never stores showCount itself).
      const profileSnaps = await Promise.all(
        friendDocs.map(f => getDoc(doc(db, 'userProfiles', f.friendUid)))
      );
      const enriched = friendDocs.map((f, i) => ({
        ...f,
        showCount: profileSnaps[i].exists() ? (profileSnaps[i].data().showCount || 0) : 0,
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
      setToast('Blocked. You won\u2019t see their posts, and they\u2019ve been removed from your friends.');
    } catch (error) {
      console.error('Failed to block user:', error);
      // "Please try again" is wrong for a rules denial — retrying never
      // clears it. Same reasoning as createFestival below, and the same
      // cause: `userBlocks` is a new collection in v5.32.0, and Firestore
      // denies any path with no matching rule, so this is exactly what an
      // undeployed firestore.rules looks like from the UI.
      setToast({
        message: error?.code === 'permission-denied'
          ? "Couldn't block that account — the app doesn't have permission to save your block list."
          : 'Failed to block that account. Please try again.',
        type: 'error',
      });
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
      setToast({
        message: error?.code === 'permission-denied'
          ? "Couldn't unblock that account — the app doesn't have permission to save your block list."
          : 'Failed to unblock that account. Please try again.',
        type: 'error',
      });
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

    // Favorite artists + account createdAt
    const favRef = doc(db, 'userProfiles', user.uid);
    const unsubFavorites = onSnapshot(favRef, (docSnap) => {
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

  // ── Local data migration check ──────────────────────────────────────
  const checkForLocalData = useCallback(() => {
    try {
      const stored = storage.get(STORAGE_KEYS.LEGACY_SHOWS);
      if (stored) {
        const localShows = JSON.parse(stored);
        if (localShows && localShows.length > 0) {
          setLocalShowsToMigrate(localShows);
          setShowMigrationPrompt(true);
        }
      }
    } catch (error) {
      console.log('No local data to migrate');
    }
  }, []);

  // ── Rank calculation ────────────────────────────────────────────────
  const calculateUserRank = useCallback(async (userId) => {
    try {
      const profilesSnapshot = await getDocs(collection(db, 'userProfiles'));
      const profiles = profilesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const sorted = profiles.sort((a, b) => (b.showCount || 0) - (a.showCount || 0));
      const rank = sorted.findIndex(p => p.id === userId) + 1;
      setUserRank({ rank, total: profiles.length });
    } catch (error) {
      console.error('Failed to calculate rank:', error);
    }
  }, []);

  // ── Load shows from Firestore ───────────────────────────────────────
  const loadShows = useCallback(async (userId) => {
    setIsLoading(true);
    try {
      const showsRef = collection(db, 'users', userId, 'shows');
      const snapshot = await getDocs(showsRef);
      const loadedShows = snapshot.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, setlist: data.setlist || [] };
      });
      setShows(loadedShows);

      if (auth.currentUser) {
        await updateUserProfile(auth.currentUser, loadedShows);
        updateCommunityStats();
        calculateUserRank(userId);
        runRetroactiveSuggestionScan().catch(() => {});
      }
    } catch (error) {
      console.error('Failed to load shows:', error);
    } finally {
      setIsLoading(false);
    }
  }, [calculateUserRank]);

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

      const loaded = await Promise.all(attendances.map(async (attendance) => {
        if (!attendance.festivalId) {
          // Pre-migration record: still fully per-user, so it already
          // carries its own name/dates. Renders exactly as it always has.
          return { ...attendance, festivalId: null, isCreator: true, unmigrated: true };
        }
        try {
          const canonicalSnap = await getDoc(doc(db, 'festivals', attendance.festivalId));
          if (!canonicalSnap.exists()) {
            return { ...attendance, unavailable: true, name: attendance.name || 'Unavailable festival' };
          }
          const canonical = canonicalSnap.data();
          return {
            // Personal fields first, canonical last: the shared document is
            // the single source of truth for name/dates/location, so it
            // wins on any field that somehow exists on both.
            ...attendance,
            name: canonical.name,
            startDate: canonical.startDate,
            endDate: canonical.endDate,
            location: canonical.location || '',
            edition: canonical.edition || '',
            createdBy: canonical.createdBy,
            isCreator: canonical.createdBy === userId,
          };
        } catch (e) {
          console.warn('Failed to read canonical festival:', attendance.festivalId, e.message);
          return { ...attendance, unavailable: true, name: attendance.name || 'Unavailable festival' };
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
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        // Close auth modal when user signs in (belt-and-suspenders)
        setAuthModal(null);

        // Navigate to shows list to clear any lingering detail view query
        // params from a previous user. This prevents signing in as a
        // different account from landing on the previous user's show.
        router.push('/shows/');


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
            let guestShowsAdded = 0;
            try {
              const guestSessionDoc = await getDoc(doc(db, 'guestSessions', guestSessionId));
              if (guestSessionDoc.exists()) {
                guestShowsAdded = guestSessionDoc.data().showsAdded || 0;
              }
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
        checkForLocalData();

        // Also check for guest shows to migrate
        const guestStored = storage.get(STORAGE_KEYS.GUEST_SHOWS);
        if (guestStored) {
          const guestShows = JSON.parse(guestStored);
          if (guestShows && guestShows.length > 0) {
            setLocalShowsToMigrate(prev => [...prev, ...guestShows]);
            setShowMigrationPrompt(true);
          }
        }
        loadShows(currentUser.uid);
        loadFestivals(currentUser.uid);
        loadInviteStats(currentUser.uid);

        // Auto-friend the user who invited them via referral link
        const referrerUid = storage.get(STORAGE_KEYS.INVITE_REFERRER);
        if (referrerUid && referrerUid !== currentUser.uid) {
          try {
            const existingFriend = await getDoc(doc(db, 'users', currentUser.uid, 'friends', referrerUid));
            if (!existingFriend.exists()) {
              const referrerProfile = await getDoc(doc(db, 'userProfiles', referrerUid));
              const referrerData = referrerProfile.exists() ? referrerProfile.data() : {};

              await setDoc(doc(db, 'users', currentUser.uid, 'friends', referrerUid), {
                friendUid: referrerUid,
                friendName: referrerData.displayName || referrerData.firstName || 'Friend',
                friendEmail: referrerData.email || '',
                friendPhotoURL: referrerData.photoURL || '',
                addedAt: serverTimestamp(),
              });

              await setDoc(doc(db, 'users', referrerUid, 'friends', currentUser.uid), {
                friendUid: currentUser.uid,
                friendName: currentUser.displayName || 'New Friend',
                friendEmail: currentUser.email || '',
                friendPhotoURL: currentUser.photoURL || '',
                addedAt: serverTimestamp(),
              });
            }
            storage.remove(STORAGE_KEYS.INVITE_REFERRER);
          } catch (err) {
            console.warn('Auto-friend from invite failed:', err);
            storage.remove(STORAGE_KEYS.INVITE_REFERRER);
          }
        }

        // ── Email-based invite lookup ─────────────────────────────────
        try {
          const inviteQuery = query(
            collection(db, 'invites'),
            where('inviteeEmail', '==', (currentUser.email || '').toLowerCase()),
            where('status', '==', 'pending')
          );
          const inviteSnap = await getDocs(inviteQuery);
          if (!inviteSnap.empty) {
            const inviteDoc = inviteSnap.docs.sort((a, b) =>
              (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0)
            )[0];
            const inviteData = inviteDoc.data();
            const { inviterUid, inviterName, inviterEmail } = inviteData;

            if (inviterUid && inviterUid !== currentUser.uid) {
              const existingFriend = await getDoc(doc(db, 'users', currentUser.uid, 'friends', inviterUid));
              if (!existingFriend.exists()) {
                const inviterProfile = await getDoc(doc(db, 'userProfiles', inviterUid));
                const inviterData = inviterProfile.exists() ? inviterProfile.data() : {};
                await setDoc(doc(db, 'users', currentUser.uid, 'friends', inviterUid), {
                  friendUid: inviterUid,
                  friendName: inviterData.displayName || inviterName || 'Friend',
                  friendEmail: inviterData.email || inviterEmail || '',
                  friendPhotoURL: inviterData.photoURL || '',
                  addedAt: serverTimestamp(),
                });
                await setDoc(doc(db, 'users', inviterUid, 'friends', currentUser.uid), {
                  friendUid: currentUser.uid,
                  friendName: currentUser.displayName || 'New Friend',
                  friendEmail: currentUser.email || '',
                  friendPhotoURL: currentUser.photoURL || '',
                  addedAt: serverTimestamp(),
                });
              }

              // Mark invite as accepted
              await setDoc(doc(db, 'invites', inviteDoc.id), { status: 'accepted' }, { merge: true });

              // Save invitedBy data on user profile
              await setDoc(doc(db, 'userProfiles', currentUser.uid), {
                invitedByUid: inviterUid,
                invitedByName: inviterName || '',
                invitedByEmail: inviterEmail || '',
                inviteAcceptedAt: serverTimestamp(),
              }, { merge: true });

              // Show welcome modal to the new user
              setWelcomeState({ inviterName: inviterName || 'your friend', inviterUid });

              // Notify inviter via email
              if (inviterEmail) {
                const email = friendJoinedEmail({
                  newUserName: currentUser.displayName || 'Your friend',
                });
                sendEmailIfAllowed({ to: inviterEmail, ...email }, { type: 'friend_joined' }).catch(() => {});
              }
            }
          }
        } catch (err) {
          console.warn('Email invite lookup failed:', err);
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
        setShows([]);
        setIsLoading(false);
        setFestivalsLoading(false);
      }
    });

    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, [checkForLocalData, loadShows, guestMode, loadGuestShows]);

  // ── Data migration ──────────────────────────────────────────────────
  const handleMigrateData = async () => {
    if (!user || localShowsToMigrate.length === 0) return;

    try {
      for (const show of localShowsToMigrate) {
        const showRef = doc(db, 'users', user.uid, 'shows', show.id);
        await setDoc(showRef, {
          ...show,
          createdAt: show.createdAt || serverTimestamp(),
          migratedFromLocal: true,
        });
      }
      storage.remove(STORAGE_KEYS.LEGACY_SHOWS);
      storage.remove(STORAGE_KEYS.GUEST_SHOWS);
      setShowMigrationPrompt(false);
      setLocalShowsToMigrate([]);
      loadShows(user.uid);
    } catch (error) {
      console.error('Failed to migrate data:', error);
      alert('Failed to migrate data. Please try again.');
    }
  };

  const handleSkipMigration = () => {
    setShowMigrationPrompt(false);
    setLocalShowsToMigrate([]);
    // Clear guest shows so the modal doesn't reappear on next login
    storage.remove(STORAGE_KEYS.GUEST_SHOWS);
    storage.remove(STORAGE_KEYS.LEGACY_SHOWS);
  };

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

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShows([]);
      setFestivals([]);
      setFestivalsLoading(false);
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
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
  const saveShow = async (updatedShow) => {
    if (guestMode) {
      const updatedShows = shows.map(s => s.id === updatedShow.id ? updatedShow : s);
      saveGuestShows(updatedShows);
      return;
    }
    if (!user) return;
    try {
      const showRef = doc(db, 'users', user.uid, 'shows', updatedShow.id);
      const { id, ...showData } = updatedShow;
      await setDoc(showRef, showData, { merge: true });
    } catch (error) {
      console.error('Failed to save show:', error);
    }
  };

  // ── Duplicate detection helper ─────────────────────────────────────
  const findDuplicateShow = (showData) => {
    if (!showData.artist || !showData.date) return null;
    return shows.find(s =>
      s.artist?.toLowerCase().trim() === showData.artist?.toLowerCase().trim() &&
      s.venue?.toLowerCase().trim() === (showData.venue || '').toLowerCase().trim() &&
      s.date === showData.date
    ) || null;
  };

  // Merge friend tag data into an existing show (comments, tags, etc.)
  const mergeTagDataIntoShow = async (existingShow, tagData) => {
    const updates = {};
    if (tagData.taggedBy && !existingShow.taggedBy) {
      updates.taggedBy = tagData.taggedBy;
      updates.taggedByUid = tagData.taggedByUid;
    }
    if (Object.keys(updates).length > 0 && user) {
      try {
        const showRef = doc(db, 'users', user.uid, 'shows', existingShow.id);
        await updateDoc(showRef, updates);
        setShows(prev => prev.map(s => s.id === existingShow.id ? { ...s, ...updates } : s));
      } catch (e) {
        console.error('Failed to merge tag data into existing show:', e);
      }
    }
    return existingShow.id;
  };

  const addShow = async (showData) => {
    // Check for duplicate before adding
    const existing = findDuplicateShow(showData);
    if (existing) {
      // Merge tag metadata into existing show rather than creating a duplicate
      await mergeTagDataIntoShow(existing, showData);
      setShowForm(false);
      return { id: existing.id, duplicate: true };
    }

    // ── Where the setlist comes from ──────────────────────────────────
    // Every add path lands here — the setlist.fm search in SearchView, the
    // CSV import, the ticket scanner, the festival lineup modal, the manual
    // form — so resolving the artist through lib/setlistSources.js once,
    // here, covers all of them rather than five copies of the same branch.
    // For an artist with no band source this is a no-op that stamps
    // `setlistSource: 'setlistfm'` and returns; see lib/bandSetlist.js.
    //
    // Deliberately after the duplicate check, so adding a show the user
    // already has doesn't spend a request on a volunteer-run archive.
    const enriched = await enrichShowDataWithBandSetlist(showData);

    const showId = mintShowId();
    const newShow = buildShowDoc(enriched, showId);

    const isFirstShow = shows.length === 0;

    if (guestMode) {
      const updatedShows = [...shows, newShow];
      setShows(updatedShows);
      saveGuestShows(updatedShows);
      setShowForm(false);

      try {
        const sessionId = storage.get(STORAGE_KEYS.GUEST_SESSION);
        if (sessionId) {
          await updateDoc(doc(db, 'guestSessions', sessionId), { showsAdded: updatedShows.length });
        }
      } catch (error) {
        console.log('Failed to update guest session:', error);
      }

      if (isFirstShow) {
        setShowCelebration(true);
        setTimeout(() => {
          setShowCelebration(false);
          setShowGuestPrompt(true);
        }, 2000);
      }

      // Fetch artist image in background for guest mode
      fetchArtistImage(newShow.artist).then(imageUrl => {
        if (!imageUrl) return;
        setShows(prev => {
          const updated = prev.map(s => s.id === showId ? { ...s, artistImage: imageUrl } : s);
          saveGuestShows(updated);
          return updated;
        });
      }).catch(() => {});

      return showId;
    }

    if (!user) return null;

    try {
      const showRef = doc(db, 'users', user.uid, 'shows', showId);
      await writeShowDoc(user.uid, newShow);
      const updatedShows = [...shows, newShow];
      setShows(updatedShows);
      setShowForm(false);

      if (isFirstShow) {
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 3000);
      }

      await updateUserProfile(user, updatedShows);
      updateCommunityStats();
      calculateUserRank(user.uid, updatedShows.length);

      // Background suggestion check — non-blocking
      checkShowSuggestionsForNewShow(newShow).catch(() => {});

      // Friend activity feed — best-effort, non-blocking (see lib/activityFeed.js)
      logActivity(user.uid, user.displayName, 'added_show', {
        showId: newShow.id,
        artist: newShow.artist,
        venue: newShow.venue || null,
      });

      // Fetch and store artist image in background — non-blocking
      fetchArtistImage(newShow.artist).then(imageUrl => {
        if (!imageUrl) return;
        updateDoc(showRef, { artistImage: imageUrl }).catch(() => {});
        setShows(prev => prev.map(s => s.id === showId ? { ...s, artistImage: imageUrl } : s));
      }).catch(() => {});

      return showId;
    } catch (error) {
      console.error('Failed to add show:', error);
      alert('Failed to add show. Please try again.');
      return null;
    }
  };

  // ── Bulk add: every night you caught on one tour ────────────────────
  // The write half of the tour browse flow (see
  // components/tours/TourBrowseModal.jsx and
  // netlify/functions/get-tour-shows.js).
  //
  // Deliberately NOT one Firestore batch. A batch is all-or-nothing, and
  // partial failure is the normal case here, not the exception: if three
  // of twelve fail the user must keep the nine and be told which three to
  // retry. So this writes one document at a time, throttled, recording
  // each outcome — losing connectivity mid-run leaves the completed
  // writes standing and reports the rest as not added.
  //
  // Every document goes through buildShowDoc/writeShowDoc, the same pair
  // addShow uses, so a bulk-added show is indistinguishable from a
  // hand-added one. What is NOT repeated per show is the aggregate work
  // addShow does — profile/community/rank recalculation and the artist
  // image fetch — which runs once at the end instead of N times.
  //
  // Progress lives in AppContext rather than in the modal on purpose: the
  // run survives closing the modal and navigating around the app. Only
  // closing the tab stops it, and whatever was written by then stands.
  //
  // No per-show activity-feed entry. Catching five nights of a tour is one
  // action by the user, and N feed items for it would drown a friend's
  // feed; the show documents themselves are identical either way.
  const addShowsFromTour = async (candidates = []) => {
    const empty = { added: [], skipped: [], failed: [] };
    if (!user || guestMode || !candidates.length) return empty;

    // Snapshot the dedup index once. `shows` can't change under us mid-run
    // (this closure holds one render's array), so ids created during the
    // run are tracked separately — two nights of the same tour can't
    // collide, but a candidate list containing the same show twice can.
    const index = buildExistingShowIndex(shows);
    const createdThisRun = [];
    const skipped = [];
    const failed = [];

    setBulkAdd({ total: candidates.length, completed: 0, added: 0, running: true });

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      setBulkAdd({ total: candidates.length, completed: i, added: createdThisRun.length, running: true });

      // Re-checked at write time, not just in the picker: the picker's
      // marking is a render-time snapshot, and this is the last line of
      // defence against creating a duplicate.
      if (existingShowStatus(index, candidate) === 'added') {
        skipped.push(candidate);
        continue;
      }

      try {
        // Same band-source resolution addShow does, for the same reason —
        // a bulk-added show must be indistinguishable from a hand-added
        // one, and that now includes where its setlist came from. A no-op
        // for any artist the registry doesn't claim, and a single
        // date-addressed request for one that does; the cache in
        // band-setlist.js means two nights of the same tour don't re-ask
        // for the same date.
        const enriched = await enrichShowDataWithBandSetlist(candidate);
        const show = buildShowDoc(enriched, mintShowId());
        await writeShowDoc(user.uid, show);
        createdThisRun.push(show);
        // Fold each success into the index so a repeated candidate in the
        // same selection is skipped rather than written twice.
        if (show.setlistfmId) index.bySetlistfmId.add(String(show.setlistfmId));
      } catch (error) {
        console.error('Failed to add show from tour:', error);
        failed.push({ candidate, reason: error?.message || 'Firestore write failed' });
      }

      // Throttle so a 40-night selection doesn't burst at Firestore.
      if (i < candidates.length - 1) await new Promise(r => setTimeout(r, BULK_ADD_DELAY_MS));
    }

    if (createdThisRun.length > 0) {
      setShows(prev => [...prev, ...createdThisRun]);

      // Aggregates once, off the post-run list rather than the stale
      // render-time `shows`.
      const updatedShows = [...shows, ...createdThisRun];
      updateUserProfile(user, updatedShows).catch(() => {});
      updateCommunityStats();
      calculateUserRank(user.uid, updatedShows.length);

      // One image fetch per distinct artist — a tour is almost always one
      // artist, so this is a single request for the whole batch.
      const artists = Array.from(new Set(createdThisRun.map(s => s.artist).filter(Boolean)));
      artists.forEach(artist => {
        fetchArtistImage(artist).then(imageUrl => {
          if (!imageUrl) return;
          const ids = createdThisRun.filter(s => s.artist === artist).map(s => s.id);
          ids.forEach(id => {
            updateDoc(doc(db, 'users', user.uid, 'shows', id), { artistImage: imageUrl }).catch(() => {});
          });
          setShows(prev => prev.map(s => (ids.includes(s.id) ? { ...s, artistImage: imageUrl } : s)));
        }).catch(() => {});
      });
    }

    setBulkAdd({ total: candidates.length, completed: candidates.length, added: createdThisRun.length, running: false });

    // Never claim success for the batch when part of it failed.
    if (failed.length > 0) {
      setToast({
        message: `Added ${createdThisRun.length} of ${candidates.length} shows — ${failed.length} failed.`,
        type: 'error',
      });
    } else if (createdThisRun.length > 0) {
      setToast(`Added ${createdThisRun.length} show${createdThisRun.length !== 1 ? 's' : ''}.`);
    }

    return { added: createdThisRun, skipped, failed };
  };

  const updateShowData = async (showId, updates) => {
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
    } catch (error) {
      console.error('Failed to update show data:', error);
    }
  };

  // Backfill artist images for existing shows that don't have one yet.
  // Runs in the background; caller can fire-and-forget.
  const backfillArtistImages = async () => {
    const missing = shows.filter(s => !s.artistImage);
    if (!missing.length) return;

    for (const show of missing) {
      try {
        const imageUrl = await fetchArtistImage(show.artist);
        if (imageUrl) {
          if (guestMode) {
            setShows(prev => {
              const updated = prev.map(s => s.id === show.id ? { ...s, artistImage: imageUrl } : s);
              saveGuestShows(updated);
              return updated;
            });
          } else if (user) {
            const showRef = doc(db, 'users', user.uid, 'shows', show.id);
            updateDoc(showRef, { artistImage: imageUrl }).catch(() => {});
            setShows(prev => prev.map(s => s.id === show.id ? { ...s, artistImage: imageUrl } : s));
          }
        }
      } catch {
        // skip this show and continue
      }
      // Rate limit: MusicBrainz allows ~1 req/sec; our function makes 2 calls per artist
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  };

  // ── Setlist scanning ────────────────────────────────────────────────
  const scanForMissingSetlists = async () => {
    const showsWithoutSetlists = shows.filter(s => !s.setlist || s.setlist.length === 0);
    if (showsWithoutSetlists.length === 0) {
      alert('All your shows already have setlists!');
      return;
    }

    setSetlistScanning(true);
    setSetlistScanProgress({ current: 0, total: showsWithoutSetlists.length, found: 0 });
    let found = 0;

    const searchAndMatch = async (searchArtist, date, year) => {
      for (let page = 1; page <= 3; page++) {
        const params = new URLSearchParams({ artistName: searchArtist, year, p: String(page) });
        const response = await fetch(apiUrl(`/api/search-setlists?${params.toString()}`));
        if (!response.ok) return null;
        const data = await response.json();
        if (!data.setlist || data.setlist.length === 0) return null;

        const match = data.setlist.find(s => {
          if (!s.eventDate) return false;
          const parts = s.eventDate.split('-');
          if (parts.length !== 3) return false;
          return `${parts[2]}-${parts[1]}-${parts[0]}` === date;
        });

        if (match) return match;
        if (data.setlist.length < 20) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return null;
    };

    const extractSongs = extractSongsFromSetlist;

    // ── The band-source shortcut ──────────────────────────────────────
    // For a Goose or Phish show this is ONE request: both archives are
    // addressable by show date, so there is a single URL that either has
    // the night or doesn't.
    //
    // What it replaces for those shows is searchAndMatch above, which is
    // built entirely around setlist.fm's search having no date endpoint:
    // up to three pages of twenty results, retried under up to three
    // artist-name variants ("X", "X and Y", "The X"), reversing
    // setlist.fm's DD-MM-YYYY into YYYY-MM-DD to compare each candidate.
    // Up to nine requests to find one night, and that loop exists for no
    // other reason. Every other artist keeps it unchanged.
    const scanViaBandSource = async (show) => {
      const result = await fetchBandSetlist({
        artist: show.artist,
        date: show.date,
        venue: show.venue,
      });
      if (!result) return false;

      // Through the merge rules like every other write, even though these
      // shows are the ones with no setlist — because "no setlist" is
      // `setlist: []` in most cases but not all, and a user who hand-added
      // two songs they remembered has a setlist worth keeping.
      const { setlist, changed, summary } = mergeBandSetlist(show.setlist || [], result.songs);
      if (!changed) return false;

      console.log(`[SETLIST SCAN] ${show.artist} ${show.date} via ${result.source}: ${describeSummary(summary)}`);
      await updateShowData(show.id, bandSetlistShowFields(result, setlist));
      return true;
    };

    for (let i = 0; i < showsWithoutSetlists.length; i++) {
      const show = showsWithoutSetlists[i];
      try {
        if (!show.artist || !show.date) continue;
        const year = show.date.split('-')[0];

        // One request instead of up to nine, where the artist has a band
        // source. A failure here falls through to the setlist.fm path
        // below rather than giving up on the show.
        if (resolveSource({ name: show.artist }).isBandSource) {
          if (await scanViaBandSource(show)) {
            found++;
            setSetlistScanProgress({ current: i + 1, total: showsWithoutSetlists.length, found });
            if (i < showsWithoutSetlists.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            continue;
          }
        }

        let match = await searchAndMatch(show.artist, show.date, year);

        if (!match && show.artist.includes('&')) {
          await new Promise(resolve => setTimeout(resolve, 300));
          match = await searchAndMatch(show.artist.replace(/&/g, 'and'), show.date, year);
        }

        if (!match) {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (show.artist.toLowerCase().startsWith('the ')) {
            match = await searchAndMatch(show.artist.substring(4), show.date, year);
          } else {
            match = await searchAndMatch('The ' + show.artist, show.date, year);
          }
        }

        if (match) {
          const songs = extractSongs(match);
          if (songs.length > 0) {
            // `setlistSource` is stamped explicitly on the setlist.fm path
            // too, so nothing downstream has to infer the source from
            // which fields happen to be present. Readers still default to
            // setlist.fm when the field is absent — every show document
            // written before this release has no such field, and
            // backfilling millions of them to say what the default already
            // says would be pointless churn.
            const updates = { setlist: songs, setlistfmId: match.id, isManual: false, setlistSource: 'setlistfm' };
            if (match.tour) updates.tour = match.tour.name;
            await updateShowData(show.id, updates);
            found++;
          }
        }
      } catch (err) {
        console.warn('Setlist scan error for', show.artist, err);
      }

      setSetlistScanProgress({ current: i + 1, total: showsWithoutSetlists.length, found });

      if (i < showsWithoutSetlists.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setSetlistScanning(false);
    if (found > 0) {
      alert(`Found ${found} new setlist${found !== 1 ? 's' : ''}!`);
    } else {
      alert('No new setlists found. Some shows may not have setlists on setlist.fm yet.');
    }
  };

  // ── Re-fetch one show's setlist from its band source ────────────────
  //
  // The per-show counterpart to scanForMissingSetlists, and the answer to
  // the case that one cannot reach: a show that ALREADY has a setlist.fm
  // setlist. scanForMissingSetlists only looks at shows where
  // `!s.setlist || s.setlist.length === 0`, which is right — it is a
  // backfill for gaps, and re-running it must not rewrite setlists people
  // have been rating for months. But it means a Goose show logged before
  // 5.33.0 keeps its setlist.fm setlist forever unless something asks for
  // the swap explicitly. This is that ask, one show at a time, initiated by
  // the user from the show itself.
  //
  // Returns a result object rather than a boolean, because the button that
  // calls it has to say what happened — including, especially, what
  // happened when nothing did. Never throws and never leaves the show
  // worse: every failure path returns `{ ok: false, reason }` with the
  // stored setlist untouched.
  const resyncSetlistFromSource = async (showId) => {
    const show = shows.find(s => s.id === showId);
    if (!show) return { ok: false, reason: 'show-not-found' };

    const source = resolveSource({ name: show.artist, mbid: show.artistMbid });
    if (!source.isBandSource) return { ok: false, reason: 'not-a-band-source', source };

    const { result, reason, detail } = await fetchBandSetlistWithReason({
      artist: show.artist,
      artistMbid: show.artistMbid,
      date: show.date,
      venue: show.venue,
    });

    if (!result) return { ok: false, reason, detail, source };

    // The same merge rule every other write goes through, so a rating or a
    // hand-added song cannot be lost by pressing this button. `changed` is
    // false only when the incoming setlist is empty or entirely untitled,
    // both of which are handled above — kept anyway, because the rule owns
    // that decision and this should not second-guess it.
    const { setlist, changed, summary } = mergeBandSetlist(show.setlist || [], result.songs);
    if (!changed) return { ok: false, reason: 'nothing-to-change', summary, source };

    console.log(`[RESYNC] ${show.artist} ${show.date} via ${result.source}: ${describeSummary(summary)}`);

    const fields = {
      ...bandSetlistShowFields(result, setlist),
      // Same rule as the add path: take the source's tour name only where
      // the show hasn't got one already.
      ...(show.tour ? {} : (result.tour ? { tour: result.tour } : {})),
    };

    await updateShowData(showId, fields);
    // updateShowData refreshes the `shows` array but not `selectedShow`,
    // and /shows renders the detail view from `selectedShow` — so without
    // this the setlist changes in Firestore and on the shows list while
    // the open show keeps showing the old one.
    if (selectedShow?.id === showId) {
      setSelectedShow(prev => (prev && prev.id === showId ? { ...prev, ...fields } : prev));
    }

    return { ok: true, summary, source, result, ambiguous: !!result.ambiguous, message: result.message };
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
      updateCommunityStats();
      calculateUserRank(user.uid, updatedShows.length);
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
  //   real-world festival edition. Readable by any signed-in user,
  //   editable only by its creator (and admin). Fields, and these are the
  //   only fields it ever holds:
  //       name            string   as the creator typed it
  //       nameNormalized  string   lib/festivalMatch normalizeFestivalName(name),
  //                                the key the dedup prefix query ranges over
  //       startDate       string   yyyy-MM-dd
  //       endDate         string   yyyy-MM-dd (== startDate for a one-day festival)
  //       location        string   free text city/state, or a venue
  //       edition         string   optional, e.g. "2026"
  //       createdBy       string   uid
  //       createdAt       Timestamp
  //       updatedAt       Timestamp
  //
  //   users/{uid}/festivals/{attendanceId} — the per-user ATTENDANCE
  //   record, in the same private subcollection festivals have always
  //   lived in. Fields:
  //       festivalId      string   pointer to the canonical document
  //       notes           string   this user's notes
  //       rating          number|null  this user's rating
  //       createdAt, updatedAt
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

  // How many canonical festivals a dedup lookup will pull down before
  // fuzzy-matching client-side. Firestore can't do fuzzy search, so the
  // query has to be bounded and the real comparison happens in
  // lib/festivalMatch.js over a small candidate set.
  const FESTIVAL_CANDIDATE_LIMIT = 20;

  // Finds canonical festivals that are probably the one the user is about
  // to create.
  //
  // TWO BOUNDED QUERIES, both single-field ranges, both served by
  // Firestore's automatic single-field indexes — no composite index is
  // required and none was added to firestore.indexes.json:
  //
  //   1. Name prefix: nameNormalized >= <first token> AND
  //      nameNormalized <= <first token> + '\uf8ff'. Catches "Bonnaroo"
  //      against "Bonnaroo Music and Arts Festival" and vice versa.
  //   2. Date window: startDate >= (start - 7d) AND startDate <= (end + 7d).
  //      Catches a festival whose name is spelled differently enough that
  //      the prefix misses it — the common case being a canonical record
  //      whose name starts with a word the user didn't type.
  //
  // The union of the two is then run through the real rule
  // (lib/festivalMatch.js), which is where the year/edition guard lives.
  const findFestivalMatchesFor = async (draft) => {
    if (!user || !draft?.name?.trim() || !draft?.startDate) return [];

    const normalized = normalizeFestivalName(draft.name);
    const prefix = normalized.split(' ')[0] || '';
    const catalog = new Map();

    const collect = (snap) => snap.docs.forEach(d => catalog.set(d.id, { id: d.id, ...d.data() }));

    try {
      if (prefix) {
        collect(await getDocs(query(
          collection(db, 'festivals'),
          where('nameNormalized', '>=', prefix),
          where('nameNormalized', '<=', `${prefix}\uf8ff`),
          limit(FESTIVAL_CANDIDATE_LIMIT),
        )));
      }

      const pad = 7 * 86400000;
      const from = new Date(Date.parse(`${draft.startDate}T00:00:00Z`) - pad);
      const to = new Date(Date.parse(`${draft.endDate || draft.startDate}T00:00:00Z`) + pad);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        collect(await getDocs(query(
          collection(db, 'festivals'),
          where('startDate', '>=', from.toISOString().slice(0, 10)),
          where('startDate', '<=', to.toISOString().slice(0, 10)),
          limit(FESTIVAL_CANDIDATE_LIMIT),
        )));
      }
    } catch (error) {
      // A failed lookup must never block creation — the worst outcome is a
      // duplicate the match rule will surface next time.
      console.warn('Festival match lookup failed:', error.message);
      return [];
    }

    // A festival the user has already joined isn't a match to offer.
    const joined = new Set((festivals || []).map(f => f.festivalId).filter(Boolean));
    return matchFestivals(draft, Array.from(catalog.values()).filter(c => !joined.has(c.id)));
  };

  // Writes only the user's attendance record against an existing canonical
  // festival. The canonical document is never touched — not even a
  // counter: the attendee count is derived on read where it's needed,
  // which is simpler and leaves nothing for a client to inflate.
  const joinFestival = async (canonicalFestival) => {
    if (!user) throw new Error('Sign in required to join a festival.');
    if (!canonicalFestival?.id) throw new Error('No festival to join.');

    const already = (festivals || []).find(f => f.festivalId === canonicalFestival.id);
    if (already) return already;

    try {
      const ref = doc(collection(db, 'users', user.uid, 'festivals'));
      const attendance = {
        festivalId: canonicalFestival.id,
        notes: '',
        rating: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, attendance);

      const joined = {
        ...attendance,
        id: ref.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        name: canonicalFestival.name,
        startDate: canonicalFestival.startDate,
        endDate: canonicalFestival.endDate,
        location: canonicalFestival.location || '',
        edition: canonicalFestival.edition || '',
        createdBy: canonicalFestival.createdBy,
        isCreator: canonicalFestival.createdBy === user.uid,
      };
      setFestivals(prev => [...prev, joined]);
      setToast(`Joined ${canonicalFestival.name}.`);
      return joined;
    } catch (error) {
      console.error('Failed to join festival:', error);
      setToast({ message: 'Failed to join that festival. Please try again.', type: 'error' });
      throw error;
    }
  };

  // Creates a canonical festival AND the creator's own attendance record.
  //
  // Two users creating the same festival within seconds of each other both
  // succeed — there is deliberately no distributed lock. One of them ends
  // up holding a near-duplicate, which the match rule surfaces to the next
  // person who tries to create it. Crashing, or blocking a create on a
  // read that may be a second stale, would both be worse.
  const createFestival = async (festivalData) => {
    if (!user) throw new Error('Sign in required to create a festival.');
    const name = (festivalData.name || '').trim();
    try {
      // doc() mints the id locally without writing, so the attendance
      // record can point at the canonical before the canonical exists.
      const canonicalRef = doc(collection(db, 'festivals'));
      const canonical = {
        name,
        nameNormalized: normalizeFestivalName(name),
        startDate: festivalData.startDate,
        endDate: festivalData.endDate || festivalData.startDate,
        location: festivalData.location?.trim() || '',
        edition: (festivalData.edition || '').trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const attendanceRef = doc(collection(db, 'users', user.uid, 'festivals'));
      const attendance = {
        festivalId: canonicalRef.id,
        notes: festivalData.notes?.trim() || '',
        rating: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Private record first, shared catalog second. These can't be one
      // atomic write (different collections, and the canonical is shared),
      // so one of them has to fail second — and the orders are not
      // equivalent. Canonical-first strands a festival in the shared
      // catalog that nobody attends, and `festivals` has
      // `allow delete: if false`, so no client can ever remove it: it
      // would surface forever in other users' join suggestions. This order
      // fails to a record private to this user, which loadFestivals
      // already renders as "Unavailable festival" and which they can leave.
      await setDoc(attendanceRef, attendance);
      await setDoc(canonicalRef, canonical);

      const created = {
        ...attendance,
        id: attendanceRef.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        name: canonical.name,
        startDate: canonical.startDate,
        endDate: canonical.endDate,
        location: canonical.location,
        edition: canonical.edition,
        createdBy: user.uid,
        isCreator: true,
      };
      setFestivals(prev => [...prev, created]);
      setToast('Festival created.');
      return created;
    } catch (error) {
      console.error('Failed to create festival:', error);
      // "Please try again" is wrong for a rules denial — retrying never
      // clears it. v5.30.0 added the shared `festivals` collection, and
      // Firestore denies any path with no matching rule, so this is what
      // an undeployed firestore.rules looks like from the UI. Name that,
      // rather than sending the user round the same loop.
      setToast({
        message: error?.code === 'permission-denied'
          ? "Couldn't create the festival — the app doesn't have permission to write to the shared festival catalog."
          : 'Failed to create festival. Please try again.',
        type: 'error',
      });
      throw error;
    }
  };

  // Splits an edit between the two documents by field. Shared details
  // (name/dates/location/edition) go to the canonical document and are
  // creator-only — the rules reject anyone else, and the UI doesn't offer
  // it. Personal fields (notes, rating) always go to the caller's own
  // attendance record.
  const CANONICAL_FESTIVAL_FIELDS = ['name', 'startDate', 'endDate', 'location', 'edition'];

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

    // A pre-migration record has no canonical document yet, so every field
    // still belongs on the user's own record — it keeps working untouched
    // until the migration reaches it.
    if (festival.unmigrated) {
      Object.assign(personalPatch, canonicalPatch);
      for (const key of Object.keys(canonicalPatch)) delete canonicalPatch[key];
    }

    if (Object.keys(canonicalPatch).length > 0 && !festival.isCreator) {
      setToast({ message: 'Only the person who created this festival can change its details.', type: 'error' });
      return;
    }

    try {
      if (Object.keys(canonicalPatch).length > 0 && festival.festivalId) {
        if (canonicalPatch.name != null) {
          canonicalPatch.nameNormalized = normalizeFestivalName(canonicalPatch.name);
        }
        await updateDoc(doc(db, 'festivals', festival.festivalId), {
          ...canonicalPatch,
          updatedAt: serverTimestamp(),
        });
      }
      if (Object.keys(personalPatch).length > 0) {
        await updateDoc(doc(db, 'users', user.uid, 'festivals', attendanceId), {
          ...personalPatch,
          updatedAt: serverTimestamp(),
        });
      }
      setFestivals(prev => prev.map(f => (
        f.id === attendanceId ? { ...f, ...personalPatch, ...canonicalPatch, updatedAt: new Date() } : f
      )));
    } catch (error) {
      console.error('Failed to update festival:', error);
      setToast({ message: 'Failed to save festival changes. Please try again.', type: 'error' });
      throw error;
    }
  };

  // Leaving deletes ONLY this user's attendance record and detaches their
  // own shows from it. The canonical festival survives — including when
  // the person leaving is the one who created it, so everyone else keeps
  // theirs — and nobody else's attendance, notes or shows are touched.
  // The shows themselves are never deleted; they go back to being ordinary
  // shows in the user's history.
  const leaveFestival = async (attendanceId) => {
    if (!user) return;
    try {
      const attachedIds = (shows || []).filter(s => s.festivalId === attendanceId).map(s => s.id);
      if (attachedIds.length > 0) {
        const batch = writeBatch(db);
        attachedIds.forEach(showId => {
          batch.update(doc(db, 'users', user.uid, 'shows', showId), { festivalId: null });
        });
        await batch.commit();
        setShows(prev => prev.map(s => (attachedIds.includes(s.id) ? { ...s, festivalId: null } : s)));
      }
      await deleteDoc(doc(db, 'users', user.uid, 'festivals', attendanceId));
      setFestivals(prev => prev.filter(f => f.id !== attendanceId));
      setToast('Left the festival. Your shows were kept in your history.');
    } catch (error) {
      console.error('Failed to leave festival:', error);
      setToast({ message: 'Failed to leave the festival. Please try again.', type: 'error' });
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
  // Dedup reuses findDuplicateShow (artist + venue + date, the same check
  // the manual add and the setlist.fm import already run) and additionally
  // matches on setlistfmId, which catches the case where the same set was
  // imported under a slightly different venue spelling.
  //
  // The writes go out as one Firestore batch rather than N addShow() calls:
  // addShow derives its doc id from Date.now() and closes over the current
  // `shows` array, so calling it in a loop would collide ids and clobber
  // state. `shows` is updated with a functional setState here for the same
  // reason.
  const importShowsToFestival = async (festivalId, candidates = [], { force = false } = {}) => {
    if (!user || !festivalId || !candidates.length) return { success: false, created: 0, attached: 0, conflicts: [] };

    const bySetlistfmId = new Map(
      shows.filter(s => s.setlistfmId).map(s => [s.setlistfmId, s])
    );

    // Resolve every candidate to either an existing show or a new one
    // *before* writing anything, so a conflict bail-out can't leave newly
    // created shows stranded outside the festival.
    const existingIds = [];
    const toCreate = [];
    let idSeed = Date.now();

    candidates.forEach(candidate => {
      const existing =
        (candidate.setlistfmId && bySetlistfmId.get(candidate.setlistfmId)) ||
        findDuplicateShow(candidate);
      if (existing) {
        existingIds.push(existing.id);
        return;
      }
      toCreate.push({
        ...candidate,
        id: String(idSeed++),
        setlist: candidate.setlist || [],
        createdAt: new Date().toISOString(),
        isManual: !candidate.setlistfmId,
      });
    });

    // Only already-logged shows can belong to another festival; the ones
    // about to be created obviously can't.
    if (!force) {
      const conflicts = existingIds
        .map(id => shows.find(s => s.id === id))
        .filter(s => s && s.festivalId && s.festivalId !== festivalId)
        .map(s => ({ showId: s.id, artist: s.artist, date: s.date, festivalId: s.festivalId }));
      if (conflicts.length > 0) return { success: false, created: 0, attached: 0, conflicts };
    }

    try {
      if (toCreate.length > 0) {
        const batch = writeBatch(db);
        toCreate.forEach(show => {
          const { id, ...showData } = show;
          batch.set(doc(db, 'users', user.uid, 'shows', id), { ...showData, createdAt: serverTimestamp() });
        });
        await batch.commit();
        setShows(prev => [...prev, ...toCreate]);
      }
    } catch (error) {
      console.error('Failed to import festival shows:', error);
      setToast({ message: 'Failed to add those shows. Please try again.', type: 'error' });
      throw error;
    }

    // force:true here because the conflict check above already ran against
    // the right set — attachShowsToFestival's own check reads the `shows`
    // array from this render, which doesn't yet contain the rows created
    // a few lines up.
    await attachShowsToFestival(festivalId, [...existingIds, ...toCreate.map(s => s.id)], { force: true });

    if (toCreate.length > 0) {
      const updatedShows = [...shows, ...toCreate];
      await updateUserProfile(user, updatedShows);
      updateCommunityStats();
      calculateUserRank(user.uid, updatedShows.length);
    }

    return { success: true, created: toCreate.length, attached: existingIds.length, conflicts: [] };
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

  const sendFriendRequest = async (targetUid, targetName, targetEmail) => {
    if (!user || targetUid === user.uid) {
      alert('You cannot send a friend request to yourself.');
      return;
    }

    try {
      const friendRef = doc(db, 'users', user.uid, 'friends', targetUid);
      const existingFriend = await getDoc(friendRef);
      if (existingFriend.exists()) {
        alert('You are already friends with this user.');
        return;
      }

      try {
        const allRequests = await getDocs(collection(db, 'friendRequests'));
        const pendingFromUs = allRequests.docs.find(d => {
          const data = d.data();
          return data.from === user.uid && data.to === targetUid && data.status === 'pending';
        });
        if (pendingFromUs) {
          alert('Friend request already sent.');
          return;
        }

        const pendingFromThem = allRequests.docs.find(d => {
          const data = d.data();
          return data.from === targetUid && data.to === user.uid && data.status === 'pending';
        });
        if (pendingFromThem) {
          await acceptFriendRequest(pendingFromThem.id);
          return;
        }
      } catch (readError) {
        console.log('Could not check existing requests, proceeding:', readError.message);
      }

      await addDoc(collection(db, 'friendRequests'), {
        from: user.uid,
        to: targetUid,
        fromName: user.displayName || 'Anonymous',
        fromEmail: user.email || '',
        toName: targetName || '',
        toEmail: targetEmail || '',
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      alert('Friend request sent!');
    } catch (error) {
      console.error('Failed to send friend request:', error);
      alert('Failed to send friend request. Check the browser console for details — you may need to update Firestore security rules to allow the "friendRequests" collection.');
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
      const profilesSnapshot = await getDocs(collection(db, 'userProfiles'));
      const matchingProfile = profilesSnapshot.docs.find(d =>
        d.data().email?.toLowerCase() === trimmedEmail
      );
      if (!matchingProfile) {
        alert('No user found with that email address. They may need to sign up first.');
        return;
      }
      await sendFriendRequest(matchingProfile.id, matchingProfile.data().displayName, matchingProfile.data().email);
    } catch (error) {
      console.error('Failed to find user or send request:', error);
      alert('Something went wrong. Check the browser console (F12) for details — this may be a Firestore permissions issue with new collections.');
    }
  };

  const acceptFriendRequest = async (requestId) => {
    if (!user) return;
    try {
      const reqRef = doc(db, 'friendRequests', requestId);
      const reqSnap = await getDoc(reqRef);
      if (!reqSnap.exists()) return;
      const reqData = reqSnap.data();

      await setDoc(reqRef, { status: 'accepted' }, { merge: true });

      const myFriendRef = doc(db, 'users', user.uid, 'friends', reqData.from);
      await setDoc(myFriendRef, {
        friendUid: reqData.from,
        friendName: reqData.fromName,
        friendEmail: reqData.fromEmail,
        friendPhotoURL: '',
        addedAt: serverTimestamp(),
      });

      const theirFriendRef = doc(db, 'users', reqData.from, 'friends', user.uid);
      await setDoc(theirFriendRef, {
        friendUid: user.uid,
        friendName: user.displayName || 'Anonymous',
        friendEmail: user.email || '',
        friendPhotoURL: user.photoURL || '',
        addedAt: serverTimestamp(),
      });

      await loadFriends();
    } catch (error) {
      console.error('Failed to accept friend request:', error);
      alert('Failed to accept friend request. Please try again.');
    }
  };

  const declineFriendRequest = async (requestId) => {
    try {
      const reqRef = doc(db, 'friendRequests', requestId);
      await setDoc(reqRef, { status: 'declined' }, { merge: true });
    } catch (error) {
      console.error('Failed to decline friend request:', error);
    }
  };

  const removeFriend = async (friendUid) => {
    if (!user) return;
    if (!window.confirm('Remove this friend?')) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'friends', friendUid));
      await deleteDoc(doc(db, 'users', friendUid, 'friends', user.uid));
      setFriends(prev => prev.filter(f => f.friendUid !== friendUid));
    } catch (error) {
      console.error('Failed to remove friend:', error);
    }
  };

  // === SHOW TAGGING FUNCTIONS ===

  const sanitizeShowForTag = (show) => ({
    artist: show.artist,
    venue: show.venue,
    date: show.date,
    city: show.city || '',
    tour: show.tour || '',
    setlistfmId: show.setlistfmId || null,
    isManual: show.isManual || false,
    setlist: (show.setlist || []).map(song => ({
      id: song.id,
      name: song.name,
    })),
  });

  const tagFriendsAtShow = async (show, selectedFriendUids) => {
    if (!user || selectedFriendUids.length === 0) return;
    const sanitizedShow = sanitizeShowForTag(show);
    try {
      const batch = writeBatch(db);
      for (const friendUid of selectedFriendUids) {
        const ref = doc(collection(db, 'showTags'));
        batch.set(ref, {
          fromUid: user.uid,
          fromName: user.displayName || 'Anonymous',
          toUid: friendUid,
          showData: sanitizedShow,
          status: 'pending',
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();

      // Send email notifications to tagged friends
      const taggerName = user.displayName || 'A friend';
      console.log('[TagEmail] Starting email notifications for', selectedFriendUids.length, 'friend(s)');
      for (const friendUid of selectedFriendUids) {
        try {
          const friend = friends.find(f => f.friendUid === friendUid);
          const friendEmail = friend?.friendEmail;
          console.log('[TagEmail] Friend:', friendUid, '| email:', friendEmail || 'NONE');
          if (friendEmail) {
            const email = showTagNotification({
              taggerName,
              artist: sanitizedShow.artist,
              venue: sanitizedShow.venue || '',
              date: sanitizedShow.date ? formatDate(sanitizedShow.date) : '',
            });
            const result = await sendEmailIfAllowed({ to: friendEmail, ...email }, { type: 'tag' });
            console.log('[TagEmail] sendEmailIfAllowed result:', result);
          } else {
            console.warn('[TagEmail] No email found for friend:', friendUid);
          }
        } catch (emailErr) {
          console.error('[TagEmail] Failed to send tag notification email:', emailErr);
        }
      }
      console.log('[TagEmail] Done sending notifications');

      const existingUids = show.taggedFriendUids || [];
      const mergedUids = [...new Set([...existingUids, ...selectedFriendUids])];
      const updatedShow = { ...show, taggedFriendUids: mergedUids };
      const updatedShows = shows.map(s => s.id === show.id ? updatedShow : s);
      setShows(updatedShows);
      await saveShow(updatedShow);

      setTagFriendsShow(null);
      setToast(`Tagged ${selectedFriendUids.length} friend${selectedFriendUids.length !== 1 ? 's' : ''} at ${show.artist}!`);
    } catch (error) {
      console.error('Failed to tag friends:', error);
      alert('Failed to tag friends. Please try again.');
    }
  };

  // === SHOWS TOGETHER ===

  const getShowsTogether = useCallback(async (friendUid) => {
    const [mySnap, theirSnap] = await Promise.all([
      getDocs(collection(db, 'users', user.uid, 'shows')),
      getDocs(collection(db, 'users', friendUid, 'shows')),
    ]);
    const myShows = mySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const theirShows = theirSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const norm = s => (s || '').trim().toLowerCase();
    const key = s => s.setlistfmId || `${norm(s.artist)}|${norm(s.venue)}|${norm(s.date)}`;
    const theirMap = {};
    theirShows.forEach(s => { theirMap[key(s)] = s; });
    return myShows
      .filter(s => theirMap[key(s)])
      .map(s => ({ ...s, friendShow: theirMap[key(s)] }));
  }, [user]);

  // === SHOW SUGGESTIONS ===

  const normalizeShowKey = (show) => {
    const norm = v => (v || '').trim().toLowerCase();
    return show.setlistfmId || `${norm(show.artist)}|${norm(show.venue)}|${norm(show.date)}`;
  };

  const buildSuggestionDocId = (uid1raw, uid2raw, showKey) => {
    const [uid1, uid2] = [uid1raw, uid2raw].sort();
    return `${uid1}_${uid2}_${showKey.replace(/[^a-z0-9]/g, '_').slice(0, 80)}`;
  };

  const createShowSuggestion = async (friendUid, friendName, show) => {
    if (!user) return;
    const showKey = normalizeShowKey(show);
    const [uid1, uid2] = [user.uid, friendUid].sort();
    const docId = buildSuggestionDocId(uid1, uid2, showKey);
    const ref = doc(db, 'showSuggestions', docId);
    try {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
      const myName = user.displayName || 'Someone';
      const name1 = uid1 === user.uid ? myName : friendName;
      const name2 = uid2 === user.uid ? myName : friendName;
      await setDoc(ref, {
        participants: [uid1, uid2],
        names: { [uid1]: name1, [uid2]: name2 },
        showKey,
        showData: {
          artist: show.artist || '',
          venue: show.venue || '',
          date: show.date || '',
          city: show.city || '',
          setlistfmId: show.setlistfmId || null,
        },
        responses: { [uid1]: 'pending', [uid2]: 'pending' },
        overallStatus: 'pending',
        emailSentToUid: null,
        emailSentAt: null,
        lastViewedAt: { [uid1]: null, [uid2]: null },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Failed to create show suggestion:', e);
    }
  };

  const checkShowSuggestionsForNewShow = async (newShow) => {
    if (!user || guestMode || friends.length === 0) return;
    const showKey = normalizeShowKey(newShow);
    for (const friend of friends) {
      try {
        const theirSnap = await getDocs(collection(db, 'users', friend.friendUid, 'shows'));
        const hasMatch = theirSnap.docs.some(d => {
          const s = d.data();
          return normalizeShowKey(s) === showKey;
        });
        if (hasMatch) {
          await createShowSuggestion(friend.friendUid, friend.friendName, newShow);
        }
      } catch (e) {
        console.error('Suggestion check error for friend:', friend.friendUid, e);
      }
    }
  };

  // Retroactive scan — runs once ever per user (localStorage flag).
  const runRetroactiveSuggestionScan = async () => {
    if (!user || guestMode || friends.length === 0 || shows.length === 0) return;
    const flagKey = `suggestionScan_${user.uid}`;
    if (storage.get(flagKey)) return;
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'showSuggestions'), where('participants', 'array-contains', user.uid))
      );
      const existingIds = new Set(existingSnap.docs.map(d => d.id));
      for (const friend of friends) {
        try {
          const theirSnap = await getDocs(collection(db, 'users', friend.friendUid, 'shows'));
          const theirShows = theirSnap.docs.map(d => d.data());
          const theirKeySet = new Set(theirShows.map(s => normalizeShowKey(s)));
          for (const myShow of shows) {
            const showKey = normalizeShowKey(myShow);
            if (!theirKeySet.has(showKey)) continue;
            const docId = buildSuggestionDocId(user.uid, friend.friendUid, showKey);
            if (existingIds.has(docId)) continue;
            await createShowSuggestion(friend.friendUid, friend.friendName, myShow);
            existingIds.add(docId);
          }
        } catch (e) {
          console.error('Retroactive scan error for friend:', friend.friendUid, e);
        }
      }
      storage.set(flagKey, '1');
    } catch (e) {
      console.error('Retroactive suggestion scan failed:', e);
    }
  };

  const respondToSuggestion = async (suggestion, response) => {
    if (!user) return;
    const friendUid = suggestion.participants.find(uid => uid !== user.uid);
    const theirResponse = suggestion.responses?.[friendUid];
    let newOverallStatus;
    if (response === 'declined') {
      newOverallStatus = 'declined';
    } else if (theirResponse === 'confirmed') {
      newOverallStatus = 'confirmed';
    } else {
      newOverallStatus = 'partially_confirmed';
    }
    const ref = doc(db, 'showSuggestions', suggestion.id);
    try {
      await updateDoc(ref, {
        [`responses.${user.uid}`]: response,
        overallStatus: newOverallStatus,
        updatedAt: serverTimestamp(),
      });
      // Send email nudge when we confirm and friend hasn't responded yet
      if (response === 'confirmed' && theirResponse === 'pending' && !suggestion.emailSentToUid) {
        const friendData = friends.find(f => f.friendUid === friendUid);
        if (friendData?.friendEmail) {
          const { artist, venue, date } = suggestion.showData;
          const email = suggestionNudgeEmail({
            fromName: user.displayName || 'A friend',
            friendName: suggestion.names?.[friendUid] || 'your friend',
            artist, venue, date,
          });
          await sendEmailIfAllowed({ to: friendData.friendEmail, ...email }, { type: 'suggestion_nudge' });
          await updateDoc(ref, { emailSentToUid: friendUid, emailSentAt: serverTimestamp() });
        }
      }
    } catch (e) {
      console.error('Failed to respond to suggestion:', e);
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

      const result = await addShow({
        ...tagData.showData,
        taggedBy: tagData.fromName,
        taggedByUid: tagData.fromUid,
      });

      await setDoc(tagRef, { status: 'accepted' }, { merge: true });

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
      const tagRef = doc(db, 'showTags', tagId);
      await setDoc(tagRef, { status: 'declined' }, { merge: true });
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
      const result = await addShow({ ...tag.showData, taggedBy: tag.fromName, taggedByUid: tag.fromUid });
      await setDoc(doc(db, 'pendingEmailTags', tag.id), { status: 'accepted' }, { merge: true });
      if (tag.fromEmail) {
        const email = tagAcceptedEmail({
          confirmerName: user.displayName || 'Your friend',
          artist: tag.showData.artist,
          venue: tag.showData.venue || '',
          date: tag.showData.date ? formatDate(tag.showData.date) : '',
        });
        sendEmailIfAllowed({ to: tag.fromEmail, ...email }, { type: 'tag_accepted' }).catch(() => {});
      }
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
      await setDoc(doc(db, 'pendingEmailTags', tag.id), { status: 'declined' }, { merge: true });
      setPendingTagsForReview(prev => prev.filter(t => t.id !== tag.id));
    } catch (error) {
      console.error('Failed to decline pending email tag:', error);
    }
  };

  // Tag a non-registered friend at a show and send them an invite email
  const tagFriendByEmail = async ({ name, email: toEmailRaw, message, show }) => {
    if (!user) return;
    const toEmail = toEmailRaw.trim().toLowerCase();
    const sanitizedShow = sanitizeShowForTag(show);
    try {
      await addDoc(collection(db, 'pendingEmailTags'), {
        fromUid: user.uid,
        fromName: user.displayName || 'Anonymous',
        fromEmail: user.email || '',
        toEmail,
        toName: name,
        showData: sanitizedShow,
        personalMessage: message || null,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      const inviterName = user.displayName || 'A friend';
      const email = tagByEmailNotification({
        taggerName: inviterName,
        artist: sanitizedShow.artist,
        venue: sanitizedShow.venue || '',
        date: sanitizedShow.date ? formatDate(sanitizedShow.date) : '',
        personalMessage: message || '',
        signupUrl: `https://mysetlists.net?ref=${user.uid}`,
      });
      await sendEmailIfAllowed({ to: toEmail, ...email }, { type: 'tag' });
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

  const sendInvite = async (email) => {
    if (!user) return { error: 'Not signed in' };
    const toEmail = email.trim().toLowerCase();

    const existing = pendingInvites.find(inv => inv.inviteeEmail === toEmail);
    if (existing) {
      return { error: 'You already have a pending invite for this email. You can resend it from the Friends > Invites tab.' };
    }

    try {
      const inviterDisplayName = user.displayName || 'A friend';
      const inviteUrl = `https://mysetlists.net?ref=${user.uid}`;
      await addDoc(collection(db, 'invites'), {
        inviterUid: user.uid,
        inviterName: inviterDisplayName,
        inviterEmail: user.email || '',
        inviteeEmail: toEmail,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      const email = inviteEmail({ inviterName: inviterDisplayName, inviteUrl });
      await sendEmailIfAllowed({ to: toEmail, ...email }, { type: 'invite' });
      loadInviteStats(user.uid);
      return { success: true };
    } catch (err) {
      console.error('Invite send failed:', err);
      return { error: 'Failed to send invite. Please try again.' };
    }
  };

  const resendInvite = async (invite) => {
    if (!user) return;
    const lastSent = invite.lastSentAt?.toMillis?.() ?? invite.createdAt?.toMillis?.() ?? 0;
    if (Date.now() - lastSent < 24 * 60 * 60 * 1000) {
      setToast('You can only resend to the same person once per 24 hours.');
      return false;
    }
    try {
      const inviterDisplayName = user.displayName || 'A friend';
      const inviteUrl = `https://mysetlists.net?ref=${user.uid}`;
      const email = inviteEmail({ inviterName: inviterDisplayName, inviteUrl });
      const res = await sendEmailIfAllowed({ to: invite.inviteeEmail, ...email }, { type: 'invite' });
      if (res && !res.ok) throw new Error('Email send failed');
      await updateDoc(doc(db, 'invites', invite.id), { lastSentAt: serverTimestamp() });
      setToast(`Invite resent to ${invite.inviteeEmail}`);
      return true;
    } catch (err) {
      console.error('Resend invite failed:', err);
      setToast('Failed to resend invite. Please try again.');
      return false;
    }
  };

  const cancelInvite = async (inviteId) => {
    try {
      await deleteDoc(doc(db, 'invites', inviteId));
    } catch (err) {
      console.error('Cancel invite failed:', err);
      setToast('Failed to cancel invite. Please try again.');
    }
  };

  // ── Show / song rating & comment handlers ──────────────────────────
  const updateShowRating = async (showId, rating) => {
    const updatedShows = shows.map(show =>
      show.id === showId ? { ...show, rating } : show
    );
    setShows(updatedShows);
    if (selectedShow?.id === showId) {
      setSelectedShow(updatedShows.find(s => s.id === showId));
    }
    const updatedShow = updatedShows.find(s => s.id === showId);
    await saveShow(updatedShow);

    if (user && !guestMode) {
      logActivity(user.uid, user.displayName, 'rated_show', {
        showId,
        artist: updatedShow.artist,
        venue: updatedShow.venue || null,
        rating,
      });
    }
  };

  const updateShowComment = async (showId, comment) => {
    const updatedShows = shows.map(show =>
      show.id === showId ? { ...show, comment } : show
    );
    setShows(updatedShows);
    if (selectedShow?.id === showId) {
      setSelectedShow(updatedShows.find(s => s.id === showId));
    }
    await saveShow(updatedShows.find(s => s.id === showId));
  };

  // Remembers which archival recording (a Relisten source uuid) the user
  // picked for this show, so returning to the show doesn't reset the choice.
  const updateArchivalAudioPick = async (showId, recordingId) => {
    const updatedShows = shows.map(show =>
      show.id === showId ? { ...show, archivalAudioPick: recordingId } : show
    );
    setShows(updatedShows);
    if (selectedShow?.id === showId) {
      setSelectedShow(updatedShows.find(s => s.id === showId));
    }
    await saveShow(updatedShows.find(s => s.id === showId));
  };

  const addSongToShow = async (showId, songData) => {
    const updatedShows = shows.map(show => {
      if (show.id === showId) {
        return {
          ...show,
          setlist: [...(show.setlist || []), {
            id: Date.now().toString(),
            ...songData,
            manuallyAdded: true,
            rating: null,
          }],
        };
      }
      return show;
    });
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  const updateSongRating = async (showId, songId, rating) => {
    const updatedShows = shows.map(show => {
      if (show.id === showId) {
        return {
          ...show,
          setlist: show.setlist.map(song =>
            song.id === songId ? { ...song, rating } : song
          ),
        };
      }
      return show;
    });
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  const updateSongComment = async (showId, songId, comment) => {
    const updatedShows = shows.map(show => {
      if (show.id === showId) {
        return {
          ...show,
          setlist: show.setlist.map(song =>
            song.id === songId ? { ...song, comment } : song
          ),
        };
      }
      return show;
    });
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  const batchRateUnrated = async (showId, rating) => {
    const updatedShows = shows.map(show => {
      if (show.id === showId) {
        return {
          ...show,
          setlist: show.setlist.map(song =>
            song.rating ? song : { ...song, rating }
          ),
        };
      }
      return show;
    });
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  // Removes one song from a setlist. Returns { song, index } so a caller
  // can offer to put it back, and null when there was nothing to remove —
  // a double-tap, or a view rendered before someone else's edit. Returning
  // null rather than writing matters: the save is a whole-array replace, so
  // a no-op write could stamp a stale setlist over a newer one.
  //
  // A deleted song takes its rating and its comment with it. The callers
  // that surface this (ShowDetailView's setlist editor, SetlistEditor) are
  // where that is made deliberate; the rule here is only that it says what
  // it removed.
  const deleteSong = async (showId, songId) => {
    const show = shows.find(s => s.id === showId);
    if (!show) return null;

    const { setlist, removed, index } = removeSongFromSetlist(show.setlist || [], songId);
    if (!removed) return null;

    const updatedShows = shows.map(s => (s.id === showId ? { ...s, setlist } : s));
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    if (selectedShow?.id === showId) setSelectedShow(updatedShow);
    await saveShow(updatedShow);

    return { song: removed, index };
  };

  // Persists a full setlist array after a set-editor move/reorder — used
  // instead of addSongToShow/updateSongRating since the whole array (order
  // and each song's `set` label) may have changed, not just one field.
  // The undo. Puts the song back exactly as it was — same id, same set,
  // same rating and comment — at the position it came from, so undoing a
  // deletion leaves no trace rather than appending the song to the end of
  // its section.
  const restoreSongToShow = async (showId, song, index) => {
    const show = shows.find(s => s.id === showId);
    if (!show || !song) return;
    // Already back (an undo pressed twice, or a re-fetch that returned it).
    if ((show.setlist || []).some(s => s.id === song.id)) return;

    const setlist = insertSongAt(show.setlist || [], song, index);
    const updatedShows = shows.map(s => (s.id === showId ? { ...s, setlist } : s));
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    if (selectedShow?.id === showId) setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  const updateSetlistOrder = async (showId, newSetlist) => {
    const updatedShows = shows.map(show =>
      show.id === showId ? { ...show, setlist: newSetlist } : show
    );
    const updatedShow = updatedShows.find(s => s.id === showId);
    setShows(updatedShows);
    setSelectedShow(updatedShow);
    await saveShow(updatedShow);
  };

  // ── Stats helpers ───────────────────────────────────────────────────
  // Each takes an optional show list so the Stats page can pass its
  // filtered set (components/shows/ShowFilters.jsx); everything else gets
  // the full library. Song counts are distinct shows — see
  // lib/songCounts.js.
  const getSongStats = (showList = shows) => buildSongStats(showList);

  const getArtistStats = (showList = shows) => {
    const artistMap = {};
    showList.forEach(show => {
      if (!artistMap[show.artist]) {
        artistMap[show.artist] = { count: 0, ratings: [], uniqueSongs: new Set() };
      }
      artistMap[show.artist].count++;
      (show.setlist || []).forEach(song => artistMap[show.artist].uniqueSongs.add((song.name || '').toLowerCase().trim()));
      if (show.rating) artistMap[show.artist].ratings.push(show.rating);
    });
    return Object.entries(artistMap)
      .map(([name, data]) => ({
        name,
        count: data.count,
        totalSongs: data.uniqueSongs.size,
        avgRating: data.ratings.length ?
          (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(1) : null,
      }))
      .sort((a, b) => b.count - a.count);
  };

  // ── Favorite Artists ──────────────────────────────────────────────
  const toggleFavoriteArtist = async (artistName) => {
    if (!user?.uid || !artistName) return;
    const profileRef = doc(db, 'userProfiles', user.uid);
    const isFav = favoriteArtists.some(a => a.name === artistName);
    try {
      if (isFav) {
        // Remove
        const updated = favoriteArtists.filter(a => a.name !== artistName);
        setFavoriteArtists(updated);
        await updateDoc(profileRef, { favoriteArtists: updated });
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
        const newFav = { name: artistName, mbid, addedAt: new Date().toISOString() };
        const updated = [...favoriteArtists, newFav];
        setFavoriteArtists(updated);
        await updateDoc(profileRef, { favoriteArtists: updated });
      }
    } catch (err) {
      console.error('Failed to toggle favorite artist:', err);
    }
  };

  const isArtistFavorite = (artistName) => {
    return favoriteArtists.some(a => a.name === artistName);
  };

  const getVenueStats = (showList = shows) => {
    const venueMap = {};
    showList.forEach(show => {
      const key = show.venue + (show.city ? `, ${show.city}` : '');
      if (!venueMap[key]) {
        venueMap[key] = { count: 0, artists: new Set() };
      }
      venueMap[key].count++;
      venueMap[key].artists.add(show.artist);
    });
    return Object.entries(venueMap)
      .map(([name, data]) => ({
        name,
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
        const res = await fetch(apiUrl('/.netlify/functions/create-shared-collection'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            shows: shows.map(s => ({
              artist: s.artist,
              venue: s.venue,
              city: s.city || '',
              date: s.date || '',
              rating: s.rating || null,
              setlist: (s.setlist || []).map(song => ({ name: song.name, rating: song.rating || null })),
            })),
            stats: {
              totalShows: shows.length,
              totalSongs,
              topArtist,
              avgRating: avgShowRating,
            },
            ownerName: user.displayName || user.email?.split('@')[0] || 'A Fan',
          }),
        });

        if (res.ok) {
          const { url } = await res.json();
          await navigator.clipboard.writeText(url);
          setToast({ message: 'Share link copied to clipboard!', type: 'success' });
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

  const summaryStats = useMemo(() => {
    const uniqueSongs = new Set();
    shows.forEach(s => (s.setlist || []).forEach(song => uniqueSongs.add((song.name || '').toLowerCase().trim())));
    const uniqueSongCount = uniqueSongs.size;

    const ratedShows = shows.filter(s => s.rating);
    const avgRating = ratedShows.length
      ? (ratedShows.reduce((a, s) => a + s.rating, 0) / ratedShows.length).toFixed(1)
      : null;
    const uniqueArtists = new Set(shows.map(s => s.artist)).size;
    const uniqueVenues = new Set(shows.map(s => s.venue)).size;
    return { totalSongs: uniqueSongCount, avgRating, uniqueArtists, uniqueVenues };
  }, [shows]);

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
    guestMode,
    setGuestMode,
    showGuestPrompt,
    setShowGuestPrompt,
    showMigrationPrompt,
    localShowsToMigrate,
    handleLogin,
    handleLogout,
    openAuthModal,
    closeAuthModal,
    switchAuthMode,
    handleAuthSuccess,
    enterGuestMode,
    exitGuestMode,
    handleMigrateData,
    handleSkipMigration,

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

    // Celebration
    showCelebration,
    setShowCelebration,

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
    saveShow,
    addShow,
    addShowsFromTour,
    bulkAdd,
    updateShowData,
    resyncSetlistFromSource,
    restoreSongToShow,
    deleteShow,
    backfillArtistImages,
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
    sortedFilteredShows,
    artistGroups,
    summaryStats,
  };

  return (
    <AppContext.Provider value={value}>
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
