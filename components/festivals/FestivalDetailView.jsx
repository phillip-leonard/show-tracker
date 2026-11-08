// components/festivals/FestivalDetailView.jsx
//
// One festival: header (name/date range/location), a stat row (same
// Card/StatFigure convention as components/runs/TourDetailView.jsx), shows
// grouped by calendar day (see lib/festivalGrouping.js — via
// hooks/useFestivalShows.js), the artist list linking out to each artist's
// shows, editable notes, and the add/remove-shows entry points.
//
// The header reads the SHARED canonical festival (name, dates, location);
// everything below it — the attached shows, the notes, the rating — reads
// the user's own attendance record. Two people at the same festival see
// the same header and completely separate shows and notes.
//
// The destructive action here is "leave", not "delete". A client can never
// delete a canonical festival, not even its creator's; leaving removes
// only this user's attendance and keeps their shows.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Star, Pencil, LogOut, UserPlus, X, Search, Users } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import useFestivalShows from '@/hooks/useFestivalShows';
import { Card, StatFigure, Button, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import FestivalFormModal from './FestivalFormModal';
import LeaveFestivalModal from './LeaveFestivalModal';
import AttachShowsModal from './AttachShowsModal';
import FestivalLineupModal from './FestivalLineupModal';
import FestivalPicks from './FestivalPicks';
import { showHref } from '@/lib/showRouting';

export default function FestivalDetailView({ festival }) {
  const router = useRouter();
  const {
    shows, festivals,
    updateFestivalData, leaveFestival, attachShowsToFestival, detachShowsFromFestival,
    importShowsToFestival,
  } = useApp();

  const stats = useFestivalShows(festival.id);

  const [showEdit, setShowEdit] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showLineup, setShowLineup] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(festival.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  const goToShow = (showId) => {
    router.push(showHref(showId));
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateFestivalData(festival.id, { notes: notesDraft.trim() });
      setEditingNotes(false);
    } finally {
      setSavingNotes(false);
    }
  };

  const removeShow = (showId) => {
    detachShowsFromFestival([showId]);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/festivals/"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4" />
        All festivals
      </Link>

      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-primary mb-1">{festival.name}</h1>
            <p className="text-sm text-secondary">
              {formatDate(festival.startDate)}
              {festival.endDate !== festival.startDate ? ` – ${formatDate(festival.endDate)}` : ''}
              {festival.location ? ` · ${festival.location}` : ''}
            </p>
            {festival.festivalId && !festival.isCreator && (
              <p className="text-xs text-muted mt-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                Added by another user — its name, dates and location are theirs to change. Your
                shows and notes here are yours alone.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              aria-label={festival.isCreator || festival.unmigrated ? 'Edit festival' : 'Edit your notes for this festival'}
              className="p-2 rounded-lg text-muted hover:text-primary hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowLeave(true)}
              aria-label="Leave festival"
              className="p-2 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <Card padding="sm"><StatFigure value={stats.showCount} label="Shows Attended" /></Card>
          <Card padding="sm"><StatFigure value={stats.artistCount} label="Artists" /></Card>
          <Card padding="sm"><StatFigure value={stats.dayCount} label="Days" /></Card>
          <Card padding="sm">
            <StatFigure value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'} label="Avg Rating" />
          </Card>
        </div>

        {/* Notes — inline edit, explicit save (matches the show-note edit
            pattern on components/shows/ShowDetailView.jsx) */}
        <div className="mt-5">
          <p className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted mb-2">Notes</p>
          {editingNotes ? (
            <div className="flex flex-col gap-2">
              <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={3} autoFocus />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveNotes} loading={savingNotes}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditingNotes(false); setNotesDraft(festival.notes || ''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingNotes(true)}
              className="text-sm text-secondary text-left hover:text-primary transition-colors w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {festival.notes || <span className="text-muted italic">Add a note…</span>}
            </button>
          )}
        </div>

        {stats.artists.length > 0 && (
          <div className="mt-5">
            <p className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted mb-2">Artists</p>
            <div className="flex flex-wrap gap-1.5">
              {stats.artists.map(artist => (
                <Link
                  key={artist}
                  href={`/shows/?artist=${encodeURIComponent(artist)}`}
                  className="text-xs font-medium text-brand bg-brand-subtle px-2 py-1 rounded-lg hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {artist}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <FestivalPicks
        festival={festival}
        onSaveMyLineup={(names) => updateFestivalData(festival.id, { myLineup: names })}
      />

      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted">Shows</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={Search} onClick={() => setShowLineup(true)}>
            Search lineup
          </Button>
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setShowAttach(true)}>
            Add shows
          </Button>
        </div>
      </div>

      {stats.groupedByDay.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-secondary text-sm mb-4">No shows attached yet.</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button size="sm" icon={Search} onClick={() => setShowLineup(true)}>
              Search the lineup
            </Button>
            <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setShowAttach(true)}>
              Pick from my shows
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {stats.groupedByDay.map(day => (
            <div key={day.date}>
              <p className="text-xs font-semibold text-secondary mb-2">{formatDate(day.date)}</p>
              <Card padding="none">
                <ul className="list-none p-0 m-0 divide-y divide-subtle">
                  {day.shows.map(show => (
                    <li key={show.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => goToShow(show.id)}
                        className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-primary truncate">{show.artist}</div>
                          <div className="text-xs text-secondary mt-0.5 truncate">
                            {show.venue}{show.city ? `, ${show.city}` : ''}
                          </div>
                        </div>
                        {typeof show.rating === 'number' && show.rating > 0 && (
                          <div className="flex items-center gap-1 text-sm font-semibold text-amber flex-shrink-0">
                            <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                            {show.rating}/10
                          </div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeShow(show.id)}
                        aria-label={`Remove ${show.artist} from this festival`}
                        title="Remove from festival"
                        className="p-2.5 mr-1.5 flex-shrink-0 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      )}

      <FestivalFormModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        festival={festival}
        onSubmit={(updates) => updateFestivalData(festival.id, updates)}
      />
      <LeaveFestivalModal
        festival={festival}
        isOpen={showLeave}
        onClose={() => setShowLeave(false)}
        onConfirm={async (id) => { await leaveFestival(id); router.push('/festivals/'); }}
      />
      <FestivalLineupModal
        open={showLineup}
        onClose={() => setShowLineup(false)}
        festival={festival}
        onImport={(candidates, opts) => importShowsToFestival(festival.id, candidates, opts)}
      />
      <AttachShowsModal
        open={showAttach}
        onClose={() => setShowAttach(false)}
        festival={festival}
        shows={shows}
        festivals={festivals}
        onAttach={(showIds, opts) => attachShowsToFestival(festival.id, showIds, opts)}
      />
    </div>
  );
}
