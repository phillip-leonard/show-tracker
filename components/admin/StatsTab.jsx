// components/admin/StatsTab.jsx
//
// Admin → Stats (v5.44.0). The site-wide totals that used to sit at the
// top of the Users tab. Every figure is a sum of the counters each
// userProfiles doc already stores (showCount, songCount, ratedSongCount),
// so leaving test users out is a filter on the profiles, not another
// query. See computeTotals in lib/adminUsers.js.

'use client';

import React, { useMemo, useState } from 'react';
import { computeTotals } from '@/lib/adminUsers';

export default function StatsTab({ profiles, loading }) {
  const [includeTestUsers, setIncludeTestUsers] = useState(false);
  const totals = useMemo(() => computeTotals(profiles, { includeTestUsers }), [profiles, includeTestUsers]);

  const tiles = [
    { label: 'Total Users', value: totals.totalUsers, color: 'from-amber to-amber' },
    { label: 'Total Shows', value: totals.totalShows, color: 'from-brand to-amber' },
    { label: 'Total Songs', value: totals.totalSongs, color: 'from-brand to-brand' },
    { label: 'Songs Rated', value: totals.totalRated, color: 'from-amber to-danger' },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Full accounts only. {includeTestUsers ? 'Including' : 'Excluding'} {totals.testUsers.toLocaleString()} test {totals.testUsers === 1 ? 'user' : 'users'}.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeTestUsers}
            onChange={(e) => setIncludeTestUsers(e.target.checked)}
            className="w-4 h-4 accent-[var(--green-primary)]"
          />
          Include test users
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map((stat) => (
          <div key={stat.label} className="bg-hover backdrop-blur-xl rounded-2xl p-5 border border-subtle">
            <div className={`text-3xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
              {loading ? '…' : stat.value.toLocaleString()}
            </div>
            <div className="text-sm font-medium text-secondary mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}
