// components/layout/AppShell.jsx
//
// Top-level wrapper for every logged-in page. Puts the Sidebar on the left,
// MobileHeader on small screens, and a padded content column that hosts the
// page. Uses your existing <Sidebar> — just adds the layout grid + responsive
// toggle + mobile drawer state.
//
// Drop into app/(authed)/layout.jsx or wrap individual pages.
//
// NOT MOUNTED. Nothing imports this file. The live shell is the inline
// AppShell function in app/AppProviderWrapper.jsx; this is an earlier
// extraction of the same idea that was never adopted, and it is the only
// remaining importer of the stale components/MobileHeader.jsx duplicate.
// Left in place rather than deleted (removing it is unrelated to the
// navigation work), but it is not the file to edit.
//
//   <AppShell user={currentUser} isAdmin={isAdmin} isGuest={isGuest}>
//     <PageHeader title="My Shows" />
//     …page content…
//   </AppShell>

'use client';

import React, { useState } from 'react';
import Sidebar from './Sidebar';
import MobileHeader from './MobileHeader';

export default function AppShell({
  user,
  isAdmin = false,
  isGuest = false,
  pendingNotificationCount = 0,
  onLogout,
  onCreateAccount,
  children,
  contentClassName = '',
  // When true, remove the default content-column padding — use for pages that
  // need bleeding hero sections (show detail, stats year-grid, etc.)
  bleed = false,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-base">
      <Sidebar
        isAdmin={isAdmin}
        isGuest={isGuest}
        userName={user?.displayName}
        onLogout={onLogout}
        onCreateAccount={onCreateAccount}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pendingNotificationCount={pendingNotificationCount}
      />

      <MobileHeader onMenuClick={() => setDrawerOpen(true)} />

      <main
        className={[
          'md:pl-64 min-h-screen flex flex-col',
          // Account for fixed mobile header (≈56px + safe-area)
          'pt-[calc(env(safe-area-inset-top)+56px)] md:pt-0',
          contentClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={bleed ? '' : 'flex-1 w-full max-w-[1200px] mx-auto px-4 md:px-8 py-6 md:py-10'}>
          {children}
        </div>
      </main>
    </div>
  );
}
