'use client';

// The compact "Upcoming" list on My Shows (5.43.0).
//
// Deliberately not a nav item: the old top-level Upcoming page was retired
// in 5.40.0, and these are a handful of dates, not a destination. Kept
// small because My Shows on a phone was tuned in 5.40.0 to show the latest
// past show without scrolling: with nothing upcoming this is one slim row,
// and it lists at most MAX_VISIBLE shows before "Show all".

import React, { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, ChevronRight, Users } from 'lucide-react';
import { Card } from '@/components/ui';
import { upcomingShowHref } from '@/lib/showRouting';
import { isUpcomingPast, todayIso } from '@/lib/upcomingShows';

const MAX_VISIBLE = 3;

function DateBadge({ date, past }) {
  const d = date ? new Date(`${date}T12:00:00`) : null;
  const month = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
  const day = d ? d.getDate() : '';
  return (
    <div className={`w-11 flex-shrink-0 rounded-lg text-center py-1 ${past ? 'bg-hover' : 'bg-amber-subtle'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${past ? 'text-muted' : 'text-amber'}`}>{month}</div>
      <div className="text-[17px] font-bold text-primary leading-tight">{day}</div>
    </div>
  );
}

export default function UpcomingShowsSection({ upcomingShows = [], onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const today = todayIso();

  if (upcomingShows.length === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="w-full mb-4 md:mb-6 flex items-center gap-2.5 px-4 py-2.5 min-h-touch rounded-xl border border-dashed border-subtle text-sm text-secondary hover:text-primary hover:border-brand/50 transition-colors pressable"
      >
        <CalendarPlus className="w-4 h-4 text-amber" />
        <span>Going to a show? <span className="font-semibold text-brand">Add an upcoming show</span></span>
      </button>
    );
  }

  const visible = expanded ? upcomingShows : upcomingShows.slice(0, MAX_VISIBLE);
  const hidden = upcomingShows.length - visible.length;

  return (
    <section className="mb-4 md:mb-6" aria-labelledby="upcoming-heading">
      <div className="flex items-center justify-between mb-2">
        <h2 id="upcoming-heading" className="text-[13px] font-bold uppercase tracking-[0.08em] text-secondary">
          Upcoming <span className="text-amber ml-1">{upcomingShows.length}</span>
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline min-h-touch md:min-h-0 px-1"
        >
          <CalendarPlus className="w-4 h-4" />
          Add
        </button>
      </div>
      <Card padding="none" className="divide-y divide-subtle overflow-hidden">
        {visible.map(show => {
          const past = isUpcomingPast(show, today);
          const going = show.taggedFriendUids?.length || 0;
          return (
            <Link
              key={show.id}
              href={upcomingShowHref(show.id)}
              className="flex items-center gap-3 px-3 py-2.5 min-h-touch hover:bg-hover transition-colors"
            >
              <DateBadge date={show.date} past={past} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-primary truncate">{show.artist}</div>
                <div className="text-xs text-secondary truncate">
                  {show.venue}{show.city ? ` · ${show.city}` : ''}
                </div>
              </div>
              {past ? (
                <span className="text-[11px] font-bold text-amber bg-amber-subtle px-2 py-0.5 rounded-full flex-shrink-0">Did you go?</span>
              ) : going > 0 ? (
                <span className="flex items-center gap-1 text-xs text-muted flex-shrink-0">
                  <Users className="w-3.5 h-3.5" />{going}
                </span>
              ) : null}
              <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
            </Link>
          );
        })}
      </Card>
      {(hidden > 0 || expanded) && upcomingShows.length > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 text-sm text-secondary hover:text-primary min-h-touch md:min-h-0"
        >
          {expanded ? 'Show fewer' : `Show all ${upcomingShows.length}`}
        </button>
      )}
    </section>
  );
}
