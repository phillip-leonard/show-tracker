'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { PageHeader, SectionHeader, Tag, Card, EmptyState } from '@/components/ui';
import TopList from '@/components/stats/TopList';
import StatsSubNav from '@/components/stats/StatsSubNav';
import { useStatsPeriod } from '@/lib/useStatsPeriod';

export default function TopArtistsPage() {
  const router = useRouter();
  const { period, setPeriod, periodShows, periodLabels } = useStatsPeriod();

  const topArtists = useMemo(() => {
    const map = {};
    periodShows.forEach(s => { map[s.artist] = (map[s.artist] || 0) + 1; });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count, meta: `${count} show${count !== 1 ? 's' : ''}` }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [periodShows]);

  return (
    <>
      <PageHeader eyebrow="Stats" title="Top Artists" />

      <StatsSubNav active="top-artists" />

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

      {topArtists.length > 0 ? (
        <Card padding="lg">
          <SectionHeader title="Top artists" />
          <TopList
            items={topArtists}
            onItemClick={(it) => router.push(`/shows/?artist=${encodeURIComponent(it.name)}${period !== 'all-time' ? `&year=${period}` : ''}`)}
          />
        </Card>
      ) : (
        <EmptyState icon={Users} title="No shows tracked yet" body="Add some shows to see your top artists." />
      )}
    </>
  );
}
