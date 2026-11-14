'use client';

import CommunityStatsView from '@/components/CommunityStatsView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function CommunityPage() {
  const { communityStats, sendFriendRequest, user, guestMode, friendUids, blockedUserIds } = useApp();

  if (guestMode) return null;

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Community Stats"
        subtitle="See how you compare with other show-goers."
      />
      <CommunityStatsView
        communityStats={communityStats}
        onAddFriend={sendFriendRequest}
        currentUserUid={user?.uid}
        currentFriendUids={friendUids}
        blockedUserIds={blockedUserIds}
      />
    </>
  );
}
