// components/festivals/AttachShowsModal.jsx
//
// Picker for attaching existing shows to a festival — searchable by
// artist/venue, defaults to shows within the festival's date range but can
// search outside it, multi-select, single batch "Add N shows" write (see
// attachShowsToFestival in context/AppContext.jsx).
//
// A show already attached to a *different* festival comes back from
// attachShowsToFestival as a conflict rather than being silently
// double-attached — this shows those conflicts and lets the user confirm
// moving them over instead of failing silently.

'use client';

import { useMemo, useState } from 'react';
import { Search, Tent } from 'lucide-react';
import { Modal, Button, Input } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { festivalWhenLabel, festivalYear, showFitsFestival } from '@/lib/festivalDates';

export default function AttachShowsModal({ open, onClose, festival, shows, festivals, onAttach }) {
  const [query, setQuery] = useState('');
  const [includeOutsideRange, setIncludeOutsideRange] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [conflicts, setConflicts] = useState(null); // [{showId, artist, date, festivalId}] | null
  const [saving, setSaving] = useState(false);

  // Inside the festival's dates, or anywhere in its year when it was added
  // with only a year (lib/festivalDates.js).
  const inRange = (show) => showFitsFestival(show.date, festival);
  const hasWindow = !!(festival?.startDate || festivalYear(festival));

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (shows || [])
      .filter(s => s.festivalId !== festival?.id) // already attached here — nothing to do
      .filter(s => includeOutsideRange || !festival || inRange(s))
      .filter(s => !q || s.artist?.toLowerCase().includes(q) || s.venue?.toLowerCase().includes(q) || s.date?.includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [shows, query, includeOutsideRange, festival]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const festivalNameFor = (festivalId) => festivals?.find(f => f.id === festivalId)?.name || 'another festival';

  const reset = () => {
    setSelected(new Set());
    setConflicts(null);
    setQuery('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async (force = false) => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const result = await onAttach(Array.from(selected), { force });
      if (result && result.success === false) {
        setConflicts(result.conflicts);
      } else {
        reset();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add shows to festival" size="lg">
      <div className="flex flex-col gap-4">
        <Input
          icon={Search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by artist, venue, or date"
        />
        {hasWindow && (
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={includeOutsideRange}
              onChange={(e) => setIncludeOutsideRange(e.target.checked)}
              className="rounded"
            />
            Show shows outside {festivalWhenLabel(festival)}
          </label>
        )}

        {conflicts && conflicts.length > 0 && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm">
            <p className="text-danger font-semibold mb-1">
              {conflicts.length} show{conflicts.length !== 1 ? 's are' : ' is'} already in another festival:
            </p>
            <ul className="text-secondary mb-2 list-disc list-inside">
              {conflicts.map(c => (
                <li key={c.showId}>{c.artist} — {formatDate(c.date)} (currently in {festivalNameFor(c.festivalId)})</li>
              ))}
            </ul>
            <Button size="sm" variant="danger" onClick={() => submit(true)} loading={saving}>
              Move {conflicts.length !== selected.size ? 'all selected shows' : `${conflicts.length} show${conflicts.length !== 1 ? 's' : ''}`} here anyway
            </Button>
          </div>
        )}

        <div className="max-h-[45vh] overflow-y-auto border border-subtle rounded-xl divide-y divide-subtle">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No matching shows.</p>
          ) : candidates.map(show => (
            <label
              key={show.id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(show.id)}
                onChange={() => toggle(show.id)}
                className="rounded"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-primary truncate">{show.artist}</div>
                <div className="text-xs text-secondary truncate">
                  {formatDate(show.date)} · {show.venue}{show.city ? `, ${show.city}` : ''}
                </div>
              </div>
              {show.festivalId && (
                <span className="flex items-center gap-1 text-[11px] text-muted flex-shrink-0">
                  <Tent className="w-3 h-3" /> in {festivalNameFor(show.festivalId)}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2.5 mt-5">
        <Button variant="secondary" onClick={handleClose}>Cancel</Button>
        <Button onClick={() => submit(false)} disabled={selected.size === 0} loading={saving}>
          Add {selected.size} show{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}
