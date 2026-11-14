// components/moderation/UserProfileSheet.jsx
//
// Another user's profile, and the two Guideline 1.2 controls that have to
// live on it: Report and Block.
//
// ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────
//
// Until now the app had no screen for another user's profile. There is a
// public, crawler-facing one served by netlify/functions/public-profile.js
// at /u/{handle}, but that is HTML for search engines, outside the app
// shell, with no controls on it. Inside the app you could see someone's
// name on a comment and have nowhere to go.
//
// That left two promises unkept. Apple asks for "a mechanism for users to
// block abusive users", and blocking was reachable only from the friends
// grid — so you could not block someone who had commented on a show
// unless you happened to be friends with them. And §4 of the Terms
// already told users they could report a profile and block someone "from
// their profile", neither of which was true. A reviewer who reads the
// Terms and tries it finds it missing.
//
// ── WHY A SHEET RATHER THAN A ROUTE ─────────────────────────────────────
//
// /u/{handle} is taken by the redirect above, and this is a static export,
// so a new dynamic route means a prerendered fallback and a client-side
// fetch on every open. A sheet costs none of that and reaches further:
// every surface that shows a name — a comment, a photo, a meetup message,
// an activity row, a friend card — opens the same one, so "can I block
// this person?" has the same answer everywhere. The public page remains
// the linkable representation; this is the actionable one.

'use client';

import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ShieldOff, UserCheck, CalendarDays, MapPin } from 'lucide-react';
import { db } from '@/lib/firebase';
import { Modal, Button, Avatar, Spinner, Badge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import ReportButton from './ReportButton';

export default function UserProfileSheet({ open, onClose, uid, fallbackName = '' }) {
  const { user, blockedUserIds, blockUser, unblockUser, visibleFriends } = useApp();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelf = !!user && uid === user.uid;
  const isBlocked = blockedUserIds.includes(uid);
  const isFriend = visibleFriends.some((f) => f.friendUid === uid);

  useEffect(() => {
    if (!open || !uid) return undefined;
    let cancelled = false;
    setLoading(true);
    setConfirmingBlock(false);
    // The counts come from the server's publicUserStats (5.59.15), not the
    // numbers the person's own app wrote to their profile.
    Promise.all([
      getDoc(doc(db, 'userProfiles', uid)),
      getDoc(doc(db, 'publicUserStats', uid)).catch(() => null),
    ])
      .then(([snap, statsSnap]) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : {};
        const counts = statsSnap && statsSnap.exists() ? statsSnap.data() : {};
        setProfile({ ...data, showCount: counts.showCount ?? null, venueCount: counts.venueCount ?? null });
      })
      .catch((err) => {
        console.error('[moderation] Could not load profile:', err);
        // An empty object rather than an error state: the point of this
        // sheet is the Block button, and failing to read someone's show
        // count must never be what stops you blocking them.
        if (!cancelled) setProfile({});
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, uid]);

  const name = profile?.displayName || fallbackName || 'This person';

  // Counts are the owner's to share. A friend has already accepted them,
  // and a public profile is public by definition; anyone else sees the
  // name and the controls, which is all this sheet is for.
  const showsStats = !!profile && (isFriend || profile.publicProfile);

  const handleBlock = async () => {
    setBusy(true);
    try {
      await blockUser(uid);
      onClose();
    } catch {
      // AppContext has already shown the toast.
      setConfirmingBlock(false);
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async () => {
    setBusy(true);
    try {
      await unblockUser(uid);
    } catch {
      // AppContext has already shown the toast.
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <Modal open={open} onClose={onClose} title={name} subtitle={profile?.handle ? `@${profile.handle}` : undefined} size="sm">
      {loading ? (
        <div className="py-8"><Spinner size="sm" label="Loading…" /></div>
      ) : (
        <div className="space-y-5" data-testid="user-profile-sheet">
          <div className="flex items-center gap-4">
            <Avatar src={profile?.photoURL} name={name} size="lg" />
            <div className="min-w-0">
              <div className="text-[17px] font-bold text-primary truncate">{name}</div>
              {profile?.handle && (
                <div className="text-sm text-muted truncate">@{profile.handle}</div>
              )}
              {isBlocked && <Badge tone="red" size="sm" className="mt-1">Blocked</Badge>}
              {!isBlocked && isFriend && <Badge tone="neutral" size="sm" className="mt-1">Friend</Badge>}
            </div>
          </div>

          {showsStats && (
            <div className="flex gap-5 text-sm">
              <span className="flex items-center gap-1.5 text-secondary">
                <CalendarDays size={14} className="text-brand" />
                {profile.showCount ?? '—'} shows
              </span>
              <span className="flex items-center gap-1.5 text-secondary">
                <MapPin size={14} className="text-brand" />
                {profile.venueCount ?? '—'} venues
              </span>
            </div>
          )}

          {/* Nothing to report or block on your own profile. */}
          {!isSelf && (
            confirmingBlock ? (
              // One confirm step, and it says what blocking actually does
              // rather than "are you sure?" — Guideline 1.2 wants the user
              // to understand the control, and the friendship removal in
              // particular is not something they can guess.
              <div className="rounded-xl border border-subtle p-4 space-y-3" data-testid="block-confirm">
                <p className="text-sm text-primary font-semibold">Block {name}?</p>
                <p className="text-sm text-secondary">
                  Their comments, photos, meetup messages and activity disappear from
                  your app straight away, and you won’t appear to each other. If you’re
                  friends, that ends too. You can undo this in Profile → Blocked accounts.
                </p>
                <div className="flex gap-2.5">
                  <Button variant="danger" icon={ShieldOff} loading={busy}
                          onClick={handleBlock} data-testid="block-confirm-yes">
                    Block
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmingBlock(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {isBlocked ? (
                  <Button variant="secondary" icon={UserCheck} loading={busy} onClick={handleUnblock}>
                    Unblock
                  </Button>
                ) : (
                  // min-h-[44px] here and on the report control below: a
                  // reviewer on an iPad running this in iPhone
                  // compatibility mode is tapping at phone scale, and
                  // Apple's own minimum is 44pt.
                  <Button variant="secondary" icon={ShieldOff}
                          className="min-h-[44px]"
                          onClick={() => setConfirmingBlock(true)}
                          data-testid="block-user">
                    Block
                  </Button>
                )}

                <ReportButton
                  contentType="profile"
                  contentId={uid}
                  contentSnapshot={`${name}${profile?.handle ? ` (@${profile.handle})` : ''}`}
                  reportedUserId={uid}
                  reportedUserName={name}
                  label="Report"
                  className="min-h-[44px] px-3 rounded-xl border border-subtle"
                  size={16}
                />
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}
