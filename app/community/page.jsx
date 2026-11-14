'use client';

import CommunityStatsView from '@/components/CommunityStatsView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function CommunityPage() {
  const { communityStats, sendFriendRequest, user, guestMode, friendUids, blockedUserIds, openAuthModal } = useApp();

  // Guests can look (5.60.1); adding a friend needs an account, so for
  // them "Add" opens sign-up. Names are plain text for guests (UserLink).
  const onAddFriend = guestMode ? () => openAuthModal('signup') : sendFriendRequest;

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Community Stats"
        subtitle="See how you compare with other show-goers."
      />
      <CommunityStatsView
        communityStats={communityStats}
        onAddFriend={onAddFriend}
        currentUserUid={user?.uid}
        currentFriendUids={friendUids}
        blockedUserIds={blockedUserIds}
      />
    </>
  );
}
