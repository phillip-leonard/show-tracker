'use client';

// Add or edit an upcoming show: the user types it in. The Ticketmaster and
// SeatGeek date search was removed in 5.60.31 along with its functions; a
// show saved from it earlier keeps its source and ticket link when edited.

import React, { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Modal, Button, Input, Textarea } from '@/components/ui';
import {
  todayIso, normalizeUpcomingInput, validateUpcomingInput,
} from '@/lib/upcomingShows';

const EMPTY = { artist: '', venue: '', city: '', date: '', time: '', notes: '' };

export default function UpcomingShowForm({ open, onClose, onSave, initial = null }) {
  const editing = !!initial;
  const [fields, setFields] = useState(() => (initial ? { ...EMPTY, ...normalizeUpcomingInput(initial), time: initial.time || '' } : EMPTY));
  const [sourceMeta] = useState(() => (initial
    ? { source: initial.source, sourceEventId: initial.sourceEventId, ticketUrl: initial.ticketUrl }
    : { source: 'manual', sourceEventId: null, ticketUrl: null }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const today = todayIso();
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }));

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

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={handleSave} loading={saving}>
        {editing ? 'Save changes' : 'Add upcoming show'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={editing ? 'Edit upcoming show' : 'Add an upcoming show'}
      subtitle={editing ? null : 'A show you’re going to. It won’t count in your stats until you’ve been.'}
      size="md"
      footer={footer}
    >
      <form onSubmit={handleSave} className="space-y-3">
        <Input label="Artist" value={fields.artist} onChange={set('artist')} placeholder="Artist or band" required autoFocus={!editing} />
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
        {/* Submit on Enter from any field; the visible buttons are in the footer. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      {error && <p className="text-danger text-sm mt-3" role="alert">{error}</p>}
    </Modal>
  );
}
