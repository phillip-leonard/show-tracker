'use client';

// Festivals landing (no `?festival=` param) or a single festival's detail
// (?festival=<festivalId>).
//
// Routing note: this is deliberately a single static route with a query
// param rather than a `/festivals/[festivalId]` dynamic segment. With
// `output: 'export'`, a dynamic segment only ever renders the exact paths
// listed in generateStaticParams — everything else falls through
// netlify.toml's `/* -> /index.html` catch-all and boots the app on the
// My Shows page instead, which is exactly what made already-created
// festivals look like they'd vanished (see CHANGELOG 5.29.0). /songs,
// /runs and /tours all use this same query-param form for the same
// reason; netlify.toml 301-redirects the old /festivals/<id> URLs here.

import { useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tent, Heart, ArrowLeft } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import FestivalListView from '@/components/festivals/FestivalListView';
import FestivalDetailView from '@/components/festivals/FestivalDetailView';
import { Button, PageHeader, EmptyState } from '@/components/ui';
import SplitView from '@/components/layout/SplitView';
import useSplitView from '@/hooks/useSplitView';
import { formatDate } from '@/lib/utils';
import { festivalHref } from '@/lib/festivalGrouping';

export default function FestivalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, guestMode, openAuthModal, festivals, festivalsLoading } = useApp();
  const splitView = useSplitView();

  const festivalId = searchParams.get('festival') || '';
  const festival = useMemo(
    () => (festivals || []).find(f => f.id === festivalId) || null,
    [festivals, festivalId]
  );

  if (guestMode || !user) {
    return (
      <>
        <PageHeader eyebrow="Festivals" title="Festivals" />
        <EmptyState
          icon={Heart}
          tone="brand"
          title="Sign in to see your festivals"
          body="Festivals are yours to create and attach shows to, so create a free account to get started."
          action={<Button onClick={() => openAuthModal('signup')}>Create account</Button>}
        />
      </>
    );
  }

  if (festivalId) {
    // Don't flash "not found" while the first Firestore read is still in
    // flight — a direct link or a refresh lands here before `festivals` fills.
    if (!festival) {
      if (festivalsLoading) {
        return (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-secondary">Loading festival…</p>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Tent className="w-10 h-10 text-muted mb-4" />
          <p className="text-lg text-primary mb-4">Festival not found.</p>
          <Button variant="ghost" icon={ArrowLeft} className="hidden md:inline-flex" onClick={() => router.push('/festivals/')}>
            Back to festivals
          </Button>
        </div>
      );
    }
    // Keyed, so switching festivals in the split view can't carry one's
    // notes draft over to the next.
    const detail = <FestivalDetailView key={festival.id} festival={festival} />;
    if (!splitView) return detail;
    return (
      <SplitView
        label="Your festivals"
        items={festivals.slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1)).map(f => ({
          id: f.id,
          title: f.name,
          subtitle: `${formatDate(f.startDate)}${f.location ? ` · ${f.location}` : ''}`,
        }))}
        selectedId={festival.id}
        onSelect={(id) => {
          // Replace, not push, as on My Shows: back still leaves the detail
          // in one step.
          router.replace(festivalHref(id));
          window.scrollTo({ top: 0 });
        }}
      >
        {detail}
      </SplitView>
    );
  }

  return <FestivalListView />;
}
