'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { PageHeader, SectionHeader, Tag, Card, EmptyState } from '@/components/ui';
import TopList from '@/components/stats/TopList';
import StatsSubNav from '@/components/stats/StatsSubNav';
import { useStatsPeriod } from '@/lib/useStatsPeriod';

export default function TopVenuesPage() {
  const router = useRouter();
  const { period, setPeriod, periodShows, periodLabels } = useStatsPeriod();

  const topVenues = useMemo(() => {
    const map = {};
    periodShows.forEach(s => {
      const key = s.venue + (s.city ? `, ${s.city}` : '');
      if (!map[key]) map[key] = { venue: s.venue, count: 0 };
      map[key].count += 1;
    });
    return Object.entries(map)
      .map(([name, { venue, count }]) => ({ name, venue, count, meta: `${count} show${count !== 1 ? 's' : ''}` }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [periodShows]);

  return (
    <>
      <PageHeader eyebrow="Stats" title="Top Venues" />

      <StatsSubNav active="top-venues" />

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-none">
        {periodLabels.map((p) => (
          <Tag
            key={p}
            selected={p === period}
            onClick={() => setPeriod(p)}
            className="flex-shrink-0"
          >
            {p === 'all-time' ? 'All-time' : p}
          </Tag>
        ))}
      </div>

      {topVenues.length > 0 ? (
        <Card padding="lg">
          <SectionHeader title="Top venues" />
          <TopList
            items={topVenues}
            onItemClick={(it) => router.push(`/shows/?venue=${encodeURIComponent(it.venue)}${period !== 'all-time' ? `&year=${period}` : ''}`)}
          />
        </Card>
      ) : (
        <EmptyState icon={Building2} title="No shows tracked yet" body="Add some shows to see your top venues." />
      )}
    </>
  );
}
