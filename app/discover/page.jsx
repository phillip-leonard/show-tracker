'use client';

// Discover (5.54.0). /discover/ is "Bands you might like";
// /discover/?band=<name> is "Fans of <name> also see…" for one band.
//
// A query parameter on a real pre-rendered route, like every other detail
// view in this static export (see CLAUDE.md's routing section):
// out/discover/index.html exists, and lib/navRoutes.js declares
// `detailParam: 'band'` so the mobile header's back control returns to the
// list rather than leaving it.

import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, Compass } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import DiscoverView from '@/components/discover/DiscoverView';
import FansAlsoSee from '@/components/discover/FansAlsoSee';
import FollowBandButton from '@/components/artists/FollowBandButton';

export default function DiscoverPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, guestMode, openAuthModal } = useApp();
  const band = (searchParams.get('band') || '').trim();

  if (guestMode || !user) {
    return (
      <>
        <PageHeader eyebrow="Discover" title="Bands you might like" />
        <EmptyState
          icon={Compass}
          tone="brand"
          title="Sign in to discover bands"
          body="Suggestions come from the bands you've seen and follow, so create a free account and add a few shows to get started."
          action={<Button onClick={() => openAuthModal('signup')}>Create account</Button>}
        />
      </>
    );
  }

  if (band) {
    return (
      <div className="max-w-3xl">
        <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex mb-4" onClick={() => router.push('/discover/')}>
          Bands you might like
        </Button>
        <PageHeader eyebrow="Discover" title={band} actions={<FollowBandButton artist={band} />} />
        <FansAlsoSee name={band} limit={20} />
      </div>
    );
  }

  return <DiscoverView />;
}
