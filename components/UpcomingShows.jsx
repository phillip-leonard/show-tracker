'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, ExternalLink } from 'lucide-react';
import { getFirebaseAnalytics } from '@/lib/firebase';
import { formatTicketDate } from '@/lib/utils';
import { fetchArtistEvents } from '@/lib/ticketEvents';
import AddToBucketListButton from '@/components/bucketlist/AddToBucketListButton';

function UpcomingShows({ artistName }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [hasNoShows, setHasNoShows] = useState(false);

  useEffect(() => {
    if (!artistName) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const merged = await fetchArtistEvents(artistName);
      if (cancelled) return;
      setEvents(merged);
      setHasNoShows(merged.length === 0);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [artistName]);

  async function handleTicketClick(platform) {
    try {
      const [analytics, { logEvent }] = await Promise.all([
        getFirebaseAnalytics(),
        import('firebase/analytics'),
      ]);
      if (analytics) logEvent(analytics, `ticket_click_${platform}`, { artist: artistName });
    } catch (_) {}
  }

  if (loading) {
    return (
      <div className="mt-4 bg-hover border border-subtle rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">Upcoming Shows</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-hover rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (hasNoShows) {
    const bandsintownUrl = `https://www.bandsintown.com/a/${encodeURIComponent(artistName)}?came_from=461&app_id=mysetlists`;
    return (
      <div className="mt-4 bg-hover border border-subtle rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-muted" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">Upcoming Shows</span>
        </div>
        <p className="text-sm text-muted mb-3">No upcoming shows found for {artistName}.</p>
        <a
          href={bandsintownUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-hover text-secondary hover:bg-hover hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Follow on Bandsintown for updates
        </a>
      </div>
    );
  }

  const hasBothPlatforms = events.some(e => e.tmUrl) && events.some(e => e.sgUrl);
  const tmSearchUrl = `https://www.ticketmaster.com/search?q=${encodeURIComponent(artistName)}`;
  const sgSearchUrl = `https://seatgeek.com/${encodeURIComponent(artistName.toLowerCase().replace(/\s+/g, '-'))}-tickets`;

  return (
    <div className="mt-4 bg-hover border border-subtle rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-brand" />
        <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Upcoming Shows</span>
      </div>

      <div className="space-y-0">
        {events.map((event) => {
          const priceLabel = event.minPrice
            ? event.maxPrice && event.maxPrice !== event.minPrice
              ? `$${Math.round(event.minPrice)} \u2013 $${Math.round(event.maxPrice)}`
              : `From $${Math.round(event.minPrice)}`
            : null;

          const locationParts = [event.venue, [event.city, event.state].filter(Boolean).join(', ')].filter(Boolean);

          return (
            <div key={event.id} className="py-3 border-b border-subtle last:border-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-secondary">{formatTicketDate(event.date)}</span>
                    {locationParts.length > 0 && (
                      <>
                        <span className="text-muted">&middot;</span>
                        <span className="text-sm text-secondary truncate">{locationParts.join(' \u00b7 ')}</span>
                      </>
                    )}
                  </div>
                  {priceLabel && (
                    <div className="text-xs text-muted mt-0.5">{priceLabel}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  <AddToBucketListButton
                    item={{
                      artist: artistName,
                      venue: event.venue,
                      city: event.city,
                      state: event.state,
                      date: event.date,
                      source: event.tmUrl ? 'ticketmaster' : 'seatgeek',
                      ticketUrl: event.tmUrl || event.sgUrl || null,
                    }}
                  />
                  {event.tmUrl && (
                    <a
                      href={event.tmUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleTicketClick('ticketmaster')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber/20 text-amber hover:bg-amber/30 border border-amber/30 transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {hasBothPlatforms ? 'Official' : 'Official Tickets'}
                    </a>
                  )}
                  {event.sgUrl && (
                    <a
                      href={event.sgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleTicketClick('seatgeek')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-subtle text-brand hover:bg-brand/30 border border-brand/30 transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {hasBothPlatforms ? 'Resale' : 'Resale Tickets'}
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-subtle">
        <span className="text-xs text-muted">See all on:</span>
        <a
          href={tmSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-amber/60 hover:text-amber transition-colors"
        >
          Ticketmaster ↗
        </a>
        <span className="text-muted">&middot;</span>
        <a
          href={sgSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand/60 hover:text-brand transition-colors"
        >
          SeatGeek ↗
        </a>
      </div>
    </div>
  );
}

export default UpcomingShows;
