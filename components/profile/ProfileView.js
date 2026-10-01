'use client';
import { useState, useEffect, useMemo } from 'react';
import { User, Mail, Calendar, Music, MapPin, Star, Trophy, Edit2, Save, X, Camera, Trash2, MailX, LogOut, MessageSquare, Eye, Heart, Info, Sparkles, Globe, Lock, ExternalLink, Copy, Check } from 'lucide-react';
import { Button, Card, Badge, Input, Modal } from '@/components/ui';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { updateProfile, signOut } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { artistColor, parseDate } from '@/lib/utils';
import { claimHandle, handleFormatError, normalizeHandle, saveDisplayName } from '@/lib/handles';
import { contentProblem } from '@/lib/contentFilter';
import { publicProfileUrl, openExternalUrl, externalLinkClick } from '@/lib/publicProfile';
import BlockedAccountsSection from '@/components/moderation/BlockedAccountsSection';
import NotificationSettings from '@/components/notifications/NotificationSettings';
import TourInfoModal from '@/components/TourInfoModal';
import ArtistAIChat from '@/components/ArtistAIChat';

export default function ProfileView({ user, shows, userRank, onProfileUpdate, onViewShow, friends = [], favoriteArtists = [], onToggleFavoriteArtist }) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [memberSince, setMemberSince] = useState(null);

  // Email opt-out state
  // Both are opt-OUT flags on the server; the switches below show the
  // positive ("you get these") so on means on.
  const [emailOptOut, setEmailOptOut] = useState(false);
  const [announcementsOptOut, setAnnouncementsOptOut] = useState(false);
  const [emailOptOutLoading, setEmailOptOutLoading] = useState(false);
  const [emailPrefsError, setEmailPrefsError] = useState('');

  // Public profile state — off by default for every user, always.
  const [handle, setHandle] = useState(null);
  const [publicProfile, setPublicProfile] = useState(false);

  // Friend activity feed — on by default (opt-out), unlike Public Profile.
  // Read/written in lib/activityFeed.js's logActivity() before every write.
  const [shareActivity, setShareActivity] = useState(true);
  const [shareActivityLoading, setShareActivityLoading] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [handleSaving, setHandleSaving] = useState(false);
  const [handleError, setHandleError] = useState('');
  const [publicToggleLoading, setPublicToggleLoading] = useState(false);
  const [showPublicPreview, setShowPublicPreview] = useState(false);

  // Account deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Comments state
  const [myCommentsPage, setMyCommentsPage] = useState(1);
  const [tourInfoArtist, setTourInfoArtist] = useState(null);
  const [aiChatArtist, setAiChatArtist] = useState(null);
  const COMMENTS_PER_PAGE = 20;

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setPhotoURL(user.photoURL || '');

      // Load member since date and email preferences from Firestore
      const loadProfile = async () => {
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profile = await getDoc(profileRef);
        if (profile.exists()) {
          if (profile.data().createdAt) {
            setMemberSince(profile.data().createdAt.toDate());
          }
          setEmailOptOut(profile.data().emailOptOut || false);
          setAnnouncementsOptOut(profile.data().announcementsOptOut || false);
          setHandle(profile.data().handle || null);
          setPublicProfile(profile.data().publicProfile || false);
          setShareActivity(profile.data().shareActivity !== false);
        }
      };
      loadProfile();

      // The server's answer wins over the profile doc: it also counts an
      // address-level unsubscribe from before this account existed.
      const loadEmailPrefs = async () => {
        try {
          const token = await auth.currentUser.getIdToken();
          const res = await fetch(apiUrl('/api/email-preferences'), { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const prefs = await res.json();
          setEmailOptOut(prefs.emailOptOut === true);
          setAnnouncementsOptOut(prefs.announcementsOptOut === true);
        } catch { /* keep the profile doc's values */ }
      };
      if (auth.currentUser) loadEmailPrefs();
    }
  }, [user]);

  // Calculate stats from shows
  const stats = {
    totalShows: shows.length,
    totalSongs: shows.reduce((acc, s) => acc + (s.setlist?.length || 0), 0),
    ratedSongs: shows.reduce((acc, s) => acc + (s.setlist?.filter(song => song.rating)?.length || 0), 0),
    uniqueVenues: new Set(shows.map(s => s.venue)).size,
    uniqueArtists: new Set(shows.map(s => s.artist)).size,
    avgShowRating: shows.filter(s => s.rating).length > 0
      ? (shows.filter(s => s.rating).reduce((a, s) => a + s.rating, 0) / shows.filter(s => s.rating).length).toFixed(1)
      : null
  };

  // Extract all user's comments (show notes + song notes)
  const myComments = useMemo(() => {
    const comments = [];
    shows.forEach(show => {
      if (show.comment && show.comment.trim()) {
        comments.push({
          type: 'show',
          text: show.comment,
          show,
          date: show.date,
          songName: null,
        });
      }
      (show.setlist || []).forEach(song => {
        if (song.comment && song.comment.trim()) {
          comments.push({
            type: 'song',
            text: song.comment,
            show,
            date: show.date,
            songName: song.name,
          });
        }
      });
    });
    comments.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateB - dateA;
    });
    return comments;
  }, [shows]);

  const handleSave = async () => {
    if (!user?.uid) return;

    // A display name is shown next to every comment, photo and activity
    // item this user posts, so it is user-generated content in the sense
    // Guideline 1.2 means and goes through the same filter as a comment.
    const nameProblem = contentProblem(displayName);
    if (nameProblem) {
      setError(nameProblem);
      return;
    }

    setSaving(true);
    setError('');

    try {
      // The name goes through the server, which runs the same filter and
      // is the only writer firestore.rules still allows for displayName
      // and firstName. It throws with the inline message on a rejection,
      // so an unfiltered name never reaches Firebase Auth below either.
      await saveDisplayName(displayName);

      await updateProfile(auth.currentUser, {
        displayName: displayName.trim(),
        photoURL: photoURL.trim() || null
      });

      // photoURL stays a direct write — it is a URL the client already
      // uploaded to Storage, not free text, and the rules still allow it.
      const profileRef = doc(db, 'userProfiles', user.uid);
      await updateDoc(profileRef, { photoURL: photoURL.trim() });

      onProfileUpdate?.({ displayName: displayName.trim(), photoURL: photoURL.trim() });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
      setError('Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDisplayName(user?.displayName || '');
    setPhotoURL(user?.photoURL || '');
    setIsEditing(false);
    setError('');
  };

  // field: 'emailOptOut' | 'announcementsOptOut'; optOut: the new value.
  const updateEmailPref = async (field, optOut) => {
    if (!user?.uid) return;
    setEmailOptOutLoading(true);
    setEmailPrefsError('');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(apiUrl('/api/email-preferences'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: optOut }),
      });
      if (!res.ok) throw new Error('Failed to update preferences');
      const prefs = await res.json();
      setEmailOptOut(prefs.emailOptOut === true);
      setAnnouncementsOptOut(prefs.announcementsOptOut === true);
    } catch (err) {
      console.error('Failed to update email preferences:', err);
      setEmailPrefsError("Couldn't save that change. Please try again.");
    } finally {
      setEmailOptOutLoading(false);
    }
  };

  const [copiedProfileLink, setCopiedProfileLink] = useState(false);
  const handleCopyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(publicProfileUrl(handle));
      setCopiedProfileLink(true);
      setTimeout(() => setCopiedProfileLink(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure context): the link is
      // still right there to open or copy by hand.
    }
  };

  const handleClaimHandle = async () => {
    if (!user?.uid) return;
    const formatError = handleFormatError(handleInput);
    if (formatError) {
      setHandleError(formatError);
      return;
    }
    setHandleSaving(true);
    setHandleError('');
    try {
      await claimHandle(user.uid, handleInput);
      setHandle(normalizeHandle(handleInput));
      setHandleInput('');
    } catch (err) {
      setHandleError(err.message || 'Failed to claim handle. Please try again.');
    } finally {
      setHandleSaving(false);
    }
  };

  const handlePublicProfileToggle = async () => {
    if (!user?.uid || !handle) return;
    setPublicToggleLoading(true);
    const newValue = !publicProfile;
    try {
      await updateDoc(doc(db, 'userProfiles', user.uid), { publicProfile: newValue });
      setPublicProfile(newValue);
    } catch (err) {
      console.error('Failed to update public profile setting:', err);
    } finally {
      setPublicToggleLoading(false);
    }
  };

  const handleShareActivityToggle = async () => {
    if (!user?.uid) return;
    setShareActivityLoading(true);
    const newValue = !shareActivity;
    try {
      await updateDoc(doc(db, 'userProfiles', user.uid), { shareActivity: newValue });
      setShareActivity(newValue);
    } catch (err) {
      console.error('Failed to update activity sharing setting:', err);
    } finally {
      setShareActivityLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.uid) return;
    // No typed confirmation. Opening this modal from Profile is already a
    // deliberate two-step act, and the Firebase ID token is what actually
    // authorises the deletion server-side — the typing only ever added
    // friction. It also required an on-screen keyboard, which on iOS covered
    // the confirm button and made deletion impossible to complete at all. A
    // destructive action nobody can finish is worse than one that is easy to
    // finish deliberately.
    setDeleteLoading(true);
    setDeleteError('');

    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(apiUrl('/api/delete-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmText: 'DELETE' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Deletion failed');
      }

      await signOut(auth);
      window.location.href = '/';
    } catch (err) {
      console.error('Account deletion failed:', err);
      setDeleteError(err.message || 'Failed to delete account. Please try again.');
      setDeleteLoading(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatShowDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return dateStr; }
  };

  // Compute stats per favorite artist
  const favoriteArtistStats = useMemo(() => {
    return favoriteArtists.map(fav => {
      const artistShows = shows.filter(s => s.artist === fav.name);
      const lastShow = artistShows.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return {
        ...fav,
        showCount: artistShows.length,
        lastSeen: lastShow?.date || null,
        lastVenue: lastShow?.venue || null,
      };
    });
  }, [favoriteArtists, shows]);

  const paginatedMyComments = myComments.slice(0, myCommentsPage * COMMENTS_PER_PAGE);

  // Exactly the fields the live public page will show — shows/artists/venues
  // counts, years active, and a recent-shows list — computed here so the
  // "preview as strangers would see it" is honest, not decorative. Notes,
  // photos, wishlists, and friend lists never enter this computation.
  const publicPreview = useMemo(() => {
    const years = new Set(shows.map(s => (s.date || '').slice(0, 4)).filter(Boolean));
    const sorted = shows.slice().sort((a, b) => parseDate(b.date) - parseDate(a.date));
    return {
      showCount: shows.length,
      artistCount: new Set(shows.map(s => s.artist)).size,
      venueCount: new Set(shows.map(s => s.venue)).size,
      yearsActive: years.size,
      recentShows: sorted.slice(0, 5),
    };
  }, [shows]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Profile Header */}
      <Card padding="md">
        <div className="flex items-start gap-6">
          <div className="relative">
            {photoURL || user?.photoURL ? (
              <img
                src={photoURL || user?.photoURL}
                alt=""
                className="w-24 h-24 rounded-2xl object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className={`w-24 h-24 rounded-2xl bg-gradient-to-br from-brand to-amber flex items-center justify-center ${photoURL || user?.photoURL ? 'hidden' : ''}`}
            >
              <User className="w-12 h-12 text-primary" />
            </div>
            {isEditing && (
              <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                <Camera className="w-6 h-6 text-primary" />
              </div>
            )}
          </div>

          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-3">
                <Input
                  type="text"
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); if (error) setError(''); }}
                  placeholder="Display name"
                />
                <Input
                  type="url"
                  value={photoURL}
                  onChange={(e) => setPhotoURL(e.target.value)}
                  placeholder="Photo URL (optional)"
                />
                {error && <p className="text-danger text-sm">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    icon={Save}
                    onClick={handleSave}
                    disabled={saving}
                    loading={saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={X}
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-primary">
                    {user?.displayName || 'Anonymous'}
                  </h2>
                  <Button variant="ghost" size="sm" icon={Edit2} onClick={() => setIsEditing(true)}>
                    Edit
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-secondary mt-1">
                  <Mail className="w-4 h-4" />
                  <span className="text-sm">{user?.email}</span>
                </div>
                <div className="flex items-center gap-2 text-secondary mt-1">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">Member since {formatDate(memberSince)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={<Music className="w-5 h-5" />} label="Shows" value={stats.totalShows} color="emerald" />
        <StatCard icon={<Music className="w-5 h-5" />} label="Songs Heard" value={stats.totalSongs} color="teal" />
        <StatCard icon={<Star className="w-5 h-5" />} label="Songs Rated" value={stats.ratedSongs} color="amber" />
        <StatCard icon={<MapPin className="w-5 h-5" />} label="Venues" value={stats.uniqueVenues} color="cyan" />
        <StatCard icon={<User className="w-5 h-5" />} label="Artists" value={stats.uniqueArtists} color="purple" />
        <StatCard icon={<Trophy className="w-5 h-5" />} label="Rank" value={userRank ? `#${userRank.rank}` : '-'} subtext={userRank ? `of ${userRank.total}` : ''} color="amber" />
      </div>

      {/* Average Rating */}
      {stats.avgShowRating && (
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-primary">Average Show Rating</h3>
              <p className="text-secondary text-sm">Based on {shows.filter(s => s.rating).length} rated shows</p>
            </div>
            <div className="flex items-center gap-2">
              <Star className="w-6 h-6 text-brand fill-amber" />
              <span className="text-3xl font-bold text-primary">{stats.avgShowRating}</span>
              <span className="text-secondary">/10</span>
            </div>
          </div>
        </Card>
      )}

      {/* Favorite Artists */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/30 to-red-500/10 flex items-center justify-center">
              <Heart className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-primary">Favorite Artists</h3>
                <Badge tone="beta" size="sm" uppercase>Beta</Badge>
              </div>
              <p className="text-xs text-muted">Tap the heart on any artist to add them here</p>
            </div>
          </div>
        </div>
        <div className="px-6 pb-5">
          {favoriteArtistStats.length === 0 ? (
            <div className="text-center py-6">
              <Heart className="w-10 h-10 text-muted mx-auto mb-3" />
              <p className="text-muted text-sm">No favorite artists yet.</p>
              <p className="text-muted text-xs mt-1">Heart an artist in Stats or any show modal to add them.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {favoriteArtistStats.map(artist => (
                <Card key={artist.name} padding="none" className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: artistColor(artist.name) }} />
                    <div className="min-w-0">
                      <span className="font-medium text-primary text-sm">{artist.name}</span>
                      <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                        <span>{artist.showCount} show{artist.showCount !== 1 ? 's' : ''}</span>
                        {artist.lastSeen && <span>Last: {formatShowDate(artist.lastSeen)}</span>}
                        {artist.lastVenue && <span className="truncate hidden sm:inline">{artist.lastVenue}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setAiChatArtist(artist)}
                      className="bg-brand/10 text-brand hover:bg-brand/20 border border-brand/20"
                    >
                      Ask AI
                    </Button>
                    {artist.mbid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Info}
                        onClick={() => setTourInfoArtist(artist)}
                      >
                        Tour Info
                      </Button>
                    )}
                    {onToggleFavoriteArtist && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Heart}
                        onClick={() => onToggleFavoriteArtist(artist.name)}
                        className="text-red-500"
                        title="Remove from favorites"
                      />
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* My Comments Section */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-amber flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-primary">My Comments</h3>
            {myComments.length > 0 && (
              <span className="bg-brand-subtle text-brand px-2 py-0.5 rounded-full text-xs">{myComments.length}</span>
            )}
          </div>
        </div>

        <div className="px-6 pb-5">
          <div className="space-y-3 mt-3">
            {myComments.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="w-10 h-10 text-muted mx-auto mb-3" />
                <p className="text-muted text-sm">No comments yet. Add notes to your shows to remember the details!</p>
              </div>
            ) : (
              <>
                {paginatedMyComments.map((comment, i) => (
                  <Card key={`${comment.show?.id}-${comment.songName || 'show'}-${i}`} padding="none" className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted mb-1.5">
                          <Badge tone={comment.type === 'show' ? 'navy' : 'amber'} size="sm">
                            {comment.type === 'show' ? 'Show Note' : 'Song Note'}
                          </Badge>
                          <span>{formatShowDate(comment.date)}</span>
                        </div>
                        <p className="text-primary text-sm leading-relaxed">{comment.text}</p>
                        <div className="mt-2 text-xs text-secondary">
                          <span className="font-medium text-primary">{comment.show?.artist}</span>
                          {comment.songName && <span> &middot; {comment.songName}</span>}
                          <span> &middot; {comment.show?.venue}</span>
                        </div>
                      </div>
                      {onViewShow && comment.show?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Eye}
                          onClick={() => onViewShow(comment.show)}
                        >
                          View Show
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
                {myComments.length > paginatedMyComments.length && (
                  <Button
                    variant="ghost"
                    full
                    onClick={() => setMyCommentsPage(p => p + 1)}
                  >
                    Show more ({myComments.length - paginatedMyComments.length} remaining)
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Help & support. Guideline 1.2 requires published contact
          information; the footer carries it on every page for people
          without an account, and this is the signed-in equivalent, next to
          the moderation controls it is most likely to be needed alongside. */}
      <Card padding="md" className="mt-6">
        <h3 className="text-lg font-semibold text-primary mb-2 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-brand" />
          Help &amp; support
        </h3>
        <p className="text-sm text-secondary mb-3">
          Something broken, or something you need to report that you can’t reach with the
          flag icon? Email{' '}
          <a href="mailto:support@mysetlists.net" className="text-brand underline">
            support@mysetlists.net
          </a>
          . Moderation reports are answered within 24 hours.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="/terms#community-guidelines" className="text-brand underline">Community Guidelines</a>
          <a href="/how-to-use" className="text-brand underline">How to use MySetlists</a>
          <a href="/feedback" className="text-brand underline">Send feedback</a>
        </div>
      </Card>

      {/* Blocked accounts — the undo for a block, which Guideline 1.2
          requires to exist somewhere the user can find it. */}
      <BlockedAccountsSection />

      {/* Notification Settings */}
      <NotificationSettings userId={user?.uid} />

      {/* Public Profile — off by default for every user. */}
      <Card padding="md">
        <h3 className="text-lg font-semibold text-primary mb-2 flex items-center gap-2">
          {publicProfile ? <Globe className="w-5 h-5 text-brand" /> : <Lock className="w-5 h-5 text-brand" />}
          Public Profile
        </h3>
        <p className="text-secondary text-sm mb-4">
          {publicProfile
            ? 'Your profile is public. Anyone with the link below can see the shows, dates, venues, artists, and setlists you\'ve logged, and your own ratings.'
            : 'Off by default. Turning this on makes a page at mysetlists.net/u/'.concat(handle || '{handle}', ' visible to anyone, showing the shows, dates, venues, artists, setlists, and your own ratings you\'ve logged. Your notes, photos, venue notes, home location, email, wishlist, and friend list are never made public, no matter what.')}
        </p>

        {!handle ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="text"
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value.toLowerCase())}
                placeholder="pick-a-handle"
                disabled={handleSaving}
                className="flex-1"
              />
              <Button variant="secondary" onClick={handleClaimHandle} disabled={handleSaving || !handleInput.trim()} loading={handleSaving}>
                Claim
              </Button>
            </div>
            {handleError && <p className="text-danger text-sm">{handleError}</p>}
            <p className="text-muted text-xs">
              3-20 characters, lowercase letters/numbers/underscores only. This cannot be changed once set, so choose carefully.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="text-secondary">Your page:</span>
                {/* A real link only while the page is actually public —
                    while private, /u/{handle} is a "not found" page. */}
                {publicProfile ? (
                  <a
                    href={publicProfileUrl(handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => externalLinkClick(e, publicProfileUrl(handle))}
                    className="font-mono text-brand underline truncate"
                  >
                    mysetlists.net/u/{handle}
                  </a>
                ) : (
                  <span className="font-mono text-primary truncate">mysetlists.net/u/{handle}</span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {publicProfile && (
                  <>
                    <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openExternalUrl(publicProfileUrl(handle))}>
                      Open
                    </Button>
                    <Button variant="ghost" size="sm" icon={copiedProfileLink ? Check : Copy} onClick={handleCopyProfileLink}>
                      {copiedProfileLink ? 'Copied' : 'Copy link'}
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" icon={Eye} onClick={() => setShowPublicPreview(true)}>
                  Preview
                </Button>
              </div>
            </div>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={publicProfile}
                onChange={handlePublicProfileToggle}
                disabled={publicToggleLoading}
                className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
                Make my profile public
              </span>
            </label>
            {publicToggleLoading && <p className="text-muted text-xs">Saving...</p>}
          </div>
        )}
      </Card>

      {/* Friend Activity Feed — on by default for every user, unlike Public Profile. */}
      <Card padding="md">
        <h3 className="text-lg font-semibold text-primary mb-2 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand" />
          Activity Feed
        </h3>
        <p className="text-secondary text-sm mb-4">
          When you add a show or rate one, friends who follow your activity see it in their feed. This never includes notes, photos, or anything not covered by Public Profile above — just that you added or rated a show.
        </p>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={shareActivity}
            onChange={handleShareActivityToggle}
            disabled={shareActivityLoading}
            className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
          />
          <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
            Show my activity to friends
          </span>
        </label>
        {shareActivityLoading && <p className="text-muted text-xs mt-2">Saving...</p>}
      </Card>

      {/* Public Profile Preview Modal — exactly what the fields above claim: shows,
          artists, venues, years active, and a recent-shows list. Never notes,
          photos, wishlists, or friend lists. */}
      <Modal open={showPublicPreview} onClose={() => setShowPublicPreview(false)} title="Preview — what strangers would see" size="md">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-primary">{user?.displayName || 'Anonymous'}</h2>
            <p className="text-sm text-muted font-mono">mysetlists.net/u/{handle}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card padding="sm"><div className="text-xl font-bold text-primary">{publicPreview.showCount}</div><div className="text-xs text-muted">Shows</div></Card>
            <Card padding="sm"><div className="text-xl font-bold text-primary">{publicPreview.artistCount}</div><div className="text-xs text-muted">Artists</div></Card>
            <Card padding="sm"><div className="text-xl font-bold text-primary">{publicPreview.venueCount}</div><div className="text-xs text-muted">Venues</div></Card>
            <Card padding="sm"><div className="text-xl font-bold text-primary">{publicPreview.yearsActive}</div><div className="text-xs text-muted">Years</div></Card>
          </div>
          <div>
            <h3 className="text-sm font-bold text-primary mb-2">Recent shows</h3>
            <div className="space-y-1.5">
              {publicPreview.recentShows.map(s => (
                <div key={s.id} className="text-sm text-secondary">
                  <span className="text-primary font-medium">{s.artist}</span> — {formatShowDate(s.date)} · {s.venue}
                </div>
              ))}
              {publicPreview.recentShows.length === 0 && <p className="text-sm text-muted">No shows logged yet.</p>}
            </div>
          </div>
          <p className="text-xs text-muted border-t border-subtle pt-3">
            This preview shows exactly what the public page includes — shows, dates, venues, artists, setlists, and your own ratings. It never includes notes, photos, venue notes, your home location, wishlist, or friend list.
          </p>
        </div>
      </Modal>

      {/* Email Preferences */}
      <Card padding="md">
        <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
          <MailX className="w-5 h-5 text-brand" />
          Email Preferences
        </h3>
        <div className="space-y-4">
          <label className={`flex items-start gap-3 group ${emailOptOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!emailOptOut && !announcementsOptOut}
              onChange={(e) => updateEmailPref('announcementsOptOut', !e.target.checked)}
              disabled={emailOptOutLoading || emailOptOut}
              className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div>
              <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
                Product news & announcements
              </span>
              <p className="text-secondary text-xs mt-0.5">
                {emailOptOut
                  ? 'Off because all emails are turned off.'
                  : 'New features, app releases and other news from MySetlists. Only occasionally.'}
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={!emailOptOut}
              onChange={(e) => updateEmailPref('emailOptOut', !e.target.checked)}
              disabled={emailOptOutLoading}
              className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
            />
            <div>
              <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
                All emails
              </span>
              <p className="text-secondary text-xs mt-0.5">
                Tags, invites, replies and other activity emails, plus announcements. Turn this off to stop every email from MySetlists. Essential account emails (password resets) will still be sent.
              </p>
            </div>
          </label>
        </div>
        {emailOptOutLoading && (
          <p className="text-muted text-xs mt-2">Saving...</p>
        )}
        {emailPrefsError && (
          <p className="text-danger text-xs mt-2">{emailPrefsError}</p>
        )}
      </Card>

      {/* Delete Account */}
      <Card padding="md" className="border-danger/20">
        <h3 className="text-lg font-semibold text-primary mb-2 flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-danger" />
          Delete Account
        </h3>
        <p className="text-secondary text-sm mb-4">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => setShowDeleteModal(true)}
        >
          Delete My Account
        </Button>
      </Card>

      {/* Delete Account Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteError('');
        }}
        title="Delete your account?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowDeleteModal(false);
                setDeleteError('');
              }}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={handleDeleteAccount}
              disabled={deleteLoading}
              loading={deleteLoading}
            >
              {deleteLoading ? 'Deleting...' : 'Yes, delete everything'}
            </Button>
          </>
        }
      >
        <p className="text-secondary text-sm mb-4">
          This permanently deletes the account for{' '}
          <strong className="text-primary">{user?.email}</strong> — every show,
          rating and note you have logged, your comments, photos and videos,
          your lists, and your username. It is not a deactivation and it cannot
          be undone.
        </p>
        <p className="text-secondary text-sm mb-4">
          You will be signed out immediately and will not be able to sign back
          in with this account.
        </p>
        {deleteError && (
          <p className="text-danger text-sm mb-4">{deleteError}</p>
        )}
      </Modal>

      {/* Tour Info Modal */}
      {tourInfoArtist && (
        <TourInfoModal
          artistName={tourInfoArtist.name}
          mbid={tourInfoArtist.mbid}
          onClose={() => setTourInfoArtist(null)}
        />
      )}

      {/* Artist AI Chat Modal */}
      {aiChatArtist && (
        <ArtistAIChat
          artistName={aiChatArtist.name}
          mbid={aiChatArtist.mbid}
          userShows={shows.filter(s => s.artist === aiChatArtist.name)}
          onClose={() => setAiChatArtist(null)}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, subtext, color }) {
  const colorClasses = {
    emerald: 'from-brand to-brand',
    teal: 'from-amber to-amber',
    amber: 'from-brand to-brand',
    cyan: 'from-amber to-amber',
    purple: 'from-amber to-brand',
  };

  return (
    <Card padding="sm" className="cursor-default">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center mb-3`}>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-primary">{value}</div>
      {subtext && <div className="text-sm text-muted">{subtext}</div>}
      <div className="text-sm text-secondary">{label}</div>
    </Card>
  );
}
