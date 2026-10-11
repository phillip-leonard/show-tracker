'use client';

import FeedbackView from '@/components/FeedbackView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function FeedbackPage() {
  const { user, navigateTo, unreadNotifications, markNotificationsRead, openAuthModal } = useApp();

  return (
    <>
      <PageHeader
        eyebrow="Feedback"
        title="Send Feedback"
        subtitle="We'd love to hear your thoughts, suggestions, or bug reports."
      />
      <FeedbackView
        user={user}
        onNavigate={navigateTo}
        unreadNotifications={unreadNotifications}
        onMarkRead={markNotificationsRead}
        onCreateAccount={() => openAuthModal('signup')}
      />
    </>
  );
}
