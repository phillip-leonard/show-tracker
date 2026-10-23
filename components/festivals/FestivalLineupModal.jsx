// components/festivals/FestivalLineupModal.jsx
//
// "Search for the festival itself" — looks the festival up on setlist.fm by
// name (+ the festival's own date window), shows every band that played it
// as a bulk-selectable list, and adds every checked one to the user's shows
// *and* to this festival in a single action.
//
// setlist.fm has no festival entity, so the lookup reconstructs one from
// the festival's own city and dates — see
// netlify/functions/search-festival-lineup.js for exactly what's queried
// and why. Both come straight off the festival, so the whole-lineup search
// needs no input at all, and the by-artist search needs only a name.
//
// Two modes, because no single query covers every festival: the lineup
// search finds everyone logged in that city on those days, and the
// by-artist search looks up one band inside the same window for festivals
// setlist.fm covers thinly. Either coming back empty says so and points
// back at AttachShowsModal's "pick from my own shows" flow rather than
// blocking anything.
//
// The write half is importShowsToFestival in context/AppContext.jsx, which
// reuses the app's existing artist+venue+date dedup so a set the user
// already logged is attached rather than duplicated.

'use client';

import { useMemo, useState } from 'react';
import { Search, Check, AlertCircle, Music, MapPin, CalendarDays } from 'lucide-react';
import { Modal, Button, Input, Spinner, Badge } from '@/components/ui';
import { SetlistfmCredit } from '@/components/shows/SetlistfmAttribution';
import { useApp } from '@/context/AppContext';
import { apiUrl } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { extractSongsFromSetlist } from '@/lib/setlistParser';

export default function FestivalLineupModal({ open, onClose, festival, onImport }) {
  const { shows, festivals } = useApp();

  const [mode, setMode] = useState('lineup'); // 'lineup' | 'artist'
  const [artistQuery, setArtistQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [conflicts, setConflicts] = useState(null); // [{showId, artist, date, festivalId}] | null
  const [saving, setSaving] = useState(false);

  const festivalNameFor = (festivalId) => festivals?.find(f => f.id === festivalId)?.name || 'another festival';

  // A lineup entry the user already has logged is still selectable — it just
  // gets attached to the festival instead of creating a second copy.
  const alreadyLogged = useMemo(() => {
    const byKey = new Set();
    (shows || []).forEach(s => {
      if (s.setlistfmId) byKey.add(`id:${s.setlistfmId}`);
      byKey.add(`avd:${(s.artist || '').toLowerCase().trim()}|${(s.venue || '').toLowerCase().trim()}|${s.date}`);
    });
    return byKey;
  }, [shows]);

  const isLogged = (r) =>
    alreadyLogged.has(`id:${r.setlistfmId}`) ||
    alreadyLogged.has(`avd:${r.artist.toLowerCase().trim()}|${r.venue.toLowerCase().trim()}|${r.date}`);

  // The festival already knows where and when it was — neither search
  // asks the user to retype either.
  const runSearch = async (searchMode = mode) => {
    if (searchMode === 'artist' && !artistQuery.trim()) return;
    setSearching(true);
    setError('');
    setResults([]);
    setSelected(new Set());
    setConflicts(null);
    try {
      const params = new URLSearchParams();
      if (festival?.name) params.set('name', festival.name);
      if (festival?.location) params.set('city', festival.location);
      if (festival?.startDate) params.set('from', festival.startDate);
      if (festival?.endDate) params.set('to', festival.endDate);
      if (searchMode === 'artist') params.set('artist', artistQuery.trim());

      const res = await fetch(`${apiUrl('/.netlify/functions/search-festival-lineup')}?${params}`);
      if (!res.ok) throw new Error('Search failed. Please try again.');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setResults([]);
    setSelected(new Set());
    setConflicts(null);
    setError('');
    setSearched(false);
  };

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = results.length > 0 && selected.size === results.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(results.map(r => r.setlistfmId)));
  };

  const handleClose = () => {
    setSelected(new Set());
    setConflicts(null);
    onClose();
  };

  const submit = async (force = false) => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      // Shape each pick the same way SearchView's setlist.fm import does, so
      // an imported festival set is indistinguishable from one added through
      // the normal search.
      const candidates = results
        .filter(r => selected.has(r.setlistfmId))
        .map(r => ({
          artist: r.artist,
          venue: r.venue,
          city: r.city,
          country: r.country,
          date: r.date,
          setlist: extractSongsFromSetlist({ sets: r.sets }),
          setlistfmId: r.setlistfmId,
          setlistfmUrl: r.url || null,
          tour: r.tour || null,
        }));
      const result = await onImport(candidates, { force });
      if (result?.success === false && result.conflicts?.length) {
        setConflicts(result.conflicts);
        return;
      }
      if (result?.success !== false) handleClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Search this festival's lineup" size="lg">
      <div className="flex flex-col gap-4">
        {/* What's being searched is the festival itself — shown, not asked
            for, since it's already on the record. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-primary">{festival?.name}</span>
          {festival?.location && (
            <span className="inline-flex items-center gap-1 text-secondary">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              {festival.location}
            </span>
          )}
          {festival?.startDate && (
            <span className="inline-flex items-center gap-1 text-secondary">
              <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDate(festival.startDate)}
              {festival.endDate !== festival.startDate ? ` – ${formatDate(festival.endDate)}` : ''}
            </span>
          )}
        </div>

        {!festival?.location && (
          <p className="text-xs text-muted -mt-2">
            Add a location to this festival (its city) and the lineup search gets a lot more
            accurate — without one it has to guess the venue from the name.
          </p>
        )}

        <div className="flex gap-2 border-b border-subtle -mb-1">
          {[['lineup', 'Whole lineup'], ['artist', 'By artist']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => switchMode(key)}
              aria-pressed={mode === key}
              className={[
                'px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-t',
                mode === key
                  ? 'border-brand text-primary'
                  : 'border-transparent text-secondary hover:text-primary',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'lineup' ? (
          <div className="flex items-center gap-3 flex-wrap">
            <Button icon={Search} onClick={() => runSearch('lineup')} loading={searching}>
              Find who played
            </Button>
            <span className="text-xs text-muted">
              Everyone logged on setlist.fm at this festival&apos;s city and dates.
            </span>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <Input
              icon={Search}
              label="Artist"
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch('artist'); }}
              placeholder="Just the band you saw — dates and city are already set"
              containerClassName="flex-1"
              autoFocus
            />
            <Button onClick={() => runSearch('artist')} loading={searching} disabled={!artistQuery.trim()}>
              Search
            </Button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm text-danger">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {conflicts && conflicts.length > 0 && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm">
            <p className="text-danger font-semibold mb-1">
              {conflicts.length} of these{conflicts.length !== 1 ? ' are' : ' is'} already in another festival:
            </p>
            <ul className="text-secondary mb-2 list-disc list-inside">
              {conflicts.map(c => (
                <li key={c.showId}>{c.artist} — {formatDate(c.date)} (currently in {festivalNameFor(c.festivalId)})</li>
              ))}
            </ul>
            <Button size="sm" variant="danger" onClick={() => submit(true)} loading={saving}>
              Move {conflicts.length !== 1 ? 'them' : 'it'} here anyway
            </Button>
          </div>
        )}

        {searching && <div className="py-8"><Spinner size="md" label="Searching setlist.fm…" /></div>}

        {!searching && searched && results.length === 0 && !error && (
          <div className="text-center py-8 px-4">
            <Music className="w-8 h-8 text-muted mx-auto mb-3" />
            <p className="text-sm text-primary font-semibold mb-1">
              {mode === 'artist' ? 'No set found for that artist' : 'No lineup found on setlist.fm'}
            </p>
            <p className="text-sm text-secondary">
              {mode === 'artist'
                ? 'Check the spelling, or that they really played inside these dates. Nobody may have logged their set yet.'
                : 'Not every festival is well covered there. Try looking up the bands one at a time under “By artist”, or close this and use “Add shows” to pick from the shows you’ve already logged.'}
            </p>
          </div>
        )}

        {!searching && results.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-secondary">
                {results.length} set{results.length !== 1 ? 's' : ''} found
              </p>
              <Button size="sm" variant="ghost" icon={Check} onClick={toggleAll}>
                {allSelected ? 'Clear all' : 'Select all'}
              </Button>
            </div>

            <div className="max-h-[45vh] overflow-y-auto border border-subtle rounded-xl divide-y divide-subtle">
              {results.map(r => (
                <label
                  key={r.setlistfmId}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.setlistfmId)}
                    onChange={() => toggle(r.setlistfmId)}
                    className="rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary truncate">{r.artist}</div>
                    <div className="text-xs text-secondary truncate">
                      {formatDate(r.date)}
                      {r.venue ? ` · ${r.venue}` : ''}
                      {r.songCount > 0 ? ` · ${r.songCount} song${r.songCount !== 1 ? 's' : ''}` : ' · no setlist'}
                    </div>
                  </div>
                  {isLogged(r) && (
                    <Badge tone="green" size="sm">Already logged</Badge>
                  )}
                </label>
              ))}
            </div>
            <SetlistfmCredit label="Lineup and setlist data from setlist.fm" className="text-[11px] text-muted" />
          </>
        )}
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
