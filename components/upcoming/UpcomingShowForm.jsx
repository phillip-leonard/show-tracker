'use client';

// Add or edit an upcoming show.
//
// Two ways in, one form: search an artist's dates on Ticketmaster/SeatGeek
// (lib/ticketEvents.js, the same lookup and cache as the per-artist
// "Upcoming Shows" panel) and pick one, or type the show in. Picking a date
// just fills the fields; everything stays editable before saving. Editing
// an existing show opens straight on the fields.

import React, { useState } from 'react';
import { Search, Calendar, MapPin, PenLine } from 'lucide-react';
import { Modal, Button, Input, Textarea, Spinner } from '@/components/ui';
import { fetchArtistEvents } from '@/lib/ticketEvents';
import { formatTicketDate } from '@/lib/utils';
import {
  todayIso, eventToUpcomingInput, normalizeUpcomingInput, validateUpcomingInput,
} from '@/lib/upcomingShows';

const EMPTY = { artist: '', venue: '', city: '', date: '', time: '', notes: '' };

export default function UpcomingShowForm({ open, onClose, onSave, initial = null }) {
  const editing = !!initial;
  const [mode, setMode] = useState(editing ? 'manual' : 'search'); // 'search' | 'manual'
  const [fields, setFields] = useState(() => (initial ? { ...EMPTY, ...normalizeUpcomingInput(initial), time: initial.time || '' } : EMPTY));
  const [sourceMeta, setSourceMeta] = useState(() => (initial
    ? { source: initial.source, sourceEventId: initial.sourceEventId, ticketUrl: initial.ticketUrl }
    : { source: 'manual', sourceEventId: null, ticketUrl: null }));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [events, setEvents] = useState(null); // null = not searched yet
  const [searchedArtist, setSearchedArtist] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const today = todayIso();
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }));

  const runSearch = async (e) => {
    e?.preventDefault?.();
    const artist = query.trim();
    if (!artist || searching) return;
    setSearching(true);
    setError('');
    try {
      const found = await fetchArtistEvents(artist);
      setEvents(found.filter(ev => ev.date && ev.date >= today));
      setSearchedArtist(artist);
    } finally {
      setSearching(false);
    }
  };

  const pickEvent = (event) => {
    const input = eventToUpcomingInput(event, searchedArtist);
    setFields(f => ({ ...f, ...input, time: input.time || '', notes: f.notes }));
    setSourceMeta({ source: input.source, sourceEventId: input.sourceEventId, ticketUrl: input.ticketUrl });
    setMode('manual');
  };

  const enterManually = () => {
    setFields(f => ({ ...f, artist: f.artist || query.trim() }));
    setSourceMeta({ source: 'manual', sourceEventId: null, ticketUrl: null });
    setMode('manual');
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    const input = { ...fields, ...sourceMeta };
    const problem = validateUpcomingInput(input, today);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(input);
      onClose();
    } catch (err) {
      setError(err?.message || 'Couldn’t save that show. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const footer = mode === 'manual' ? (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={handleSave} loading={saving}>
        {editing ? 'Save changes' : 'Add upcoming show'}
      </Button>
    </>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={editing ? 'Edit upcoming show' : 'Add an upcoming show'}
      subtitle={editing ? null : 'A show you’re going to. It won’t count in your stats until you’ve been.'}
      size="md"
      footer={footer}
    >
      {mode === 'search' && (
        <div className="space-y-4">
          <form onSubmit={runSearch} className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <Input
                label="Artist"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Who are you seeing?"
                autoFocus
                enterKeyHint="search"
              />
            </div>
            <Button type="submit" icon={Search} loading={searching} disabled={!query.trim()} className="flex-shrink-0">
              Search
            </Button>
          </form>

          {searching && (
            <div className="flex justify-center py-6"><Spinner /></div>
          )}

          {!searching && events && events.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-secondary">Upcoming dates for {searchedArtist}</p>
              {events.map(event => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => pickEvent(event)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 min-h-touch rounded-xl bg-hover border border-subtle hover:border-brand/50 transition-colors pressable"
                >
                  <Calendar className="w-4 h-4 text-amber flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary">{formatTicketDate(event.date)}</div>
                    <div className="text-xs text-secondary truncate">
                      {event.venue}{event.city ? ` · ${[event.city, event.state].filter(Boolean).join(', ')}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searching && events && events.length === 0 && (
            <p className="text-sm text-muted text-center py-4">
              No upcoming dates found for {searchedArtist}. You can add it yourself.
            </p>
          )}

          <button
            type="button"
            onClick={enterManually}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium text-brand hover:underline min-h-touch"
          >
            <PenLine className="w-4 h-4" />
            Enter the show yourself
          </button>
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleSave} className="space-y-3">
          <Input label="Artist" value={fields.artist} onChange={set('artist')} placeholder="Artist or band" required />
          <Input label="Venue" value={fields.venue} onChange={set('venue')} placeholder="Venue" required />
          <Input label="City" value={fields.city} onChange={set('city')} placeholder="City (optional)" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="upcoming-date" className="text-[13px] font-semibold text-secondary">Date</label>
            <input
              id="upcoming-date"
              type="date"
              min={today}
              value={fields.date}
              onChange={set('date')}
              required
              className="w-full px-4 py-3 min-h-touch bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary [color-scheme:dark]"
            />
          </div>
          <Textarea
            label="Notes"
            value={fields.notes}
            onChange={set('notes')}
            placeholder="Seats, who's driving, anything to remember (optional)"
            rows={3}
          />
          {sourceMeta.source !== 'manual' && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <MapPin className="w-3.5 h-3.5" />
              From {sourceMeta.source === 'ticketmaster' ? 'Ticketmaster' : 'SeatGeek'}
            </p>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => { setMode('search'); setError(''); }}
              className="text-sm text-secondary hover:text-primary min-h-touch"
            >
              &larr; Back to search
            </button>
          )}
          {/* Submit on Enter from any field; the visible buttons are in the footer. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      )}

      {error && <p className="text-danger text-sm mt-3" role="alert">{error}</p>}
    </Modal>
  );
}
