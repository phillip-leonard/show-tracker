'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { parseDate } from '@/lib/utils';
import { groupSongsBySet, getSetLabels, getSetOptions, moveSongToSet, reorderSongWithinSet } from '@/lib/setlistGrouping';
import { artistSlugFromName, songSlugFromTitle } from '@/lib/songIndex';
import { countSongsByShow } from '@/lib/songCounts';
import { buildRunIndex, buildTourIndex, tourKeyFor, tourHref } from '@/lib/runIndex';
import { festivalHref } from '@/lib/festivalGrouping';
import { venueKeyFor } from '@/lib/venues';
import { sourceLabel, sourceHomeUrl, resolveSource } from '@/lib/setlistSources';
import SetlistView from './SetlistView';
import { Avatar, Button } from '@/components/ui';
import EntityInfoPanel from '@/components/EntityInfoPanel';
import StreamingLinks from '@/components/StreamingLinks';
import ArchivalAudioSection from './ArchivalAudioSection';
import {
  UserPlus, Heart, Share2, ListMusic, Hash,
  Trash2, X, Tag, MessageSquare, ArrowLeft, Plus,
  Pencil, Check, ChevronUp, ChevronDown, Tent, RefreshCw,
} from 'lucide-react';
import DeleteShowModal from './DeleteShowModal';
import CommentsSection from '@/components/comments/CommentsSection';
import ShowMediaSection from '@/components/photos/ShowMediaSection';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatShowDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d || d.getFullYear() < 1900) return dateStr || '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ── What to say after a re-fetch ───────────────────────────────────────
//
// Every branch names the archive and says what it did or did not have. The
// outcomes that matter most here are the ones where nothing changed: the
// first version of this feature reported those as silence, which is
// indistinguishable from a broken button and cost a day of guessing.
function describeResync(result, sourceName, date) {
  if (!result) return '';

  if (result.ok) {
    const s = result.summary || {};
    const carried = Object.values(s.carriedOver || {}).reduce((a, b) => a + b, 0);
    const parts = [`${s.existingCount} → ${s.resultCount} songs`];
    if (s.added?.length) parts.push(`${s.added.length} added`);
    if (s.removed?.length) parts.push(`${s.removed.length} removed`);
    if (s.keptManual?.length) parts.push(`${s.keptManual.length} of yours kept`);
    if (carried) parts.push(`${carried} rating/note${carried === 1 ? '' : 's'} kept`);
    return `Updated from ${sourceName} — ${parts.join(', ')}.`;
  }

  switch (result.reason) {
    case 'no-show':
      return `${sourceName} has no show listed on ${date}. Your setlist is unchanged.`;
    case 'no-songs':
      // The one case that means this app has a bug rather than the archive
      // having a gap, so it says so instead of blaming the archive.
      return `${sourceName} lists a show on ${date} but returned no songs — that's a problem on our end, not theirs. Nothing was changed.`;
    case 'nothing-to-change':
      return `Already matches ${sourceName} — nothing to change.`;
    case 'bad-date':
      // The stored date could not be read at all, so nothing was asked for.
      return `This show's date (${result.detail || 'blank'}) isn't in a form the archive can be asked about. Nothing was changed.`;
    case 'http-error':
      return `The setlist service answered with ${result.detail || 'an error'}. Nothing was changed.`;
    case 'fetch-failed':
      return `Couldn't reach the setlist service${result.detail ? ` (${result.detail})` : ''}. Nothing was changed.`;
    default:
      return `Nothing was changed${result.reason ? ` (${result.reason})` : ''}.`;
  }
}

function buildSets(setlist = []) {
  return groupSongsBySet(setlist).map(({ label, songs }) => ({
    label,
    tracks: songs.map(song => {
      const title = song.song || song.name || song.title || '';
      return {
        title,
        cover: song.cover || null,
        debut: !!(song.debut || song.tags?.includes('debut')),
        duration: song.duration || null,
        tape: song.tape || false,
        manual: !!song.manuallyAdded,
        // Band-source extras (El Goose, Phish.net). Undefined on a
        // setlist.fm-sourced show, which is what SetlistView expects — it
        // falls back to the generic segue indicator and renders no
        // footnote or jam-chart affordance at all.
        transitionMark: song.transitionMark || null,
        footnote: song.footnote || null,
        jamchart: !!song.jamchart,
        jamchartNote: song.jamchartNote || null,
      };
    }),
  }));
}

// ── Micro-components ───────────────────────────────────────────────────────────

function IconBtn({ onClick, children, active, activeClass = 'text-brand bg-brand/10', danger, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors ${
        active
          ? activeClass
          : danger
            ? 'text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
            : 'text-muted hover:text-primary hover:bg-hover'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function SidebarLabel({ children }) {
  return (
    <p className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted mb-3">
      {children}
    </p>
  );
}

function SidebarCard({ children, className = '' }) {
  return (
    <div className={`bg-surface border border-subtle rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  );
}

// Owner-only editor for moving a song between sets/encore and reordering
// within a set — operates directly on the raw `setlist` array (with stable
// song.id) rather than the display-only `sets`/`tracks` shape from buildSets().
function SetlistEditControls({ setlist, onMoveSet, onReorder, onRequestDelete, pendingDeleteId }) {
  const groups = groupSongsBySet(setlist);
  const setOptions = getSetOptions(setlist);

  return (
    <div>
      {groups.map(group => (
        <section key={group.label} className="mb-2">
          <div className="flex items-center gap-3 mt-6 mb-3 first:mt-0">
            <hr className="flex-1 border-t border-subtle m-0" />
            <span className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted">
              {group.label}
            </span>
            <hr className="flex-1 border-t border-subtle m-0" />
          </div>
          <ol className="list-none p-0 m-0 space-y-1.5">
            {group.songs.map((song, i) => (
              <li
                key={song.id}
                className="grid grid-cols-[28px_1fr_auto] gap-3 items-center px-2.5 py-2 rounded-lg bg-hover"
              >
                <span className="font-mono text-xs text-muted font-bold text-right">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[15px] font-medium text-primary leading-snug truncate">
                  {song.song || song.name || song.title || ''}
                  {song.manuallyAdded && (
                    <span className="ml-2 inline-block text-[9px] font-extrabold tracking-[0.1em] uppercase text-secondary bg-surface px-1.5 py-0.5 rounded">
                      added by you
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onReorder(group.label, i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${song.name || song.song || 'song'} up`}
                    className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorder(group.label, i, 1)}
                    disabled={i === group.songs.length - 1}
                    aria-label={`Move ${song.name || song.song || 'song'} down`}
                    className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <select
                    value={song.set || group.label}
                    onChange={e => onMoveSet(song.id, e.target.value)}
                    aria-label={`Move ${song.name || song.song || 'song'} to a different set`}
                    className="border border-subtle rounded-lg px-2 py-2 text-xs text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 cursor-pointer"
                  >
                    {setOptions.map(label => (
                      <option key={label} value={label}>{label}</option>
                    ))}
                  </select>
                  {onRequestDelete && (
                    /* Two taps, because a deleted song takes its rating and
                       its comment with it. The second tap is a wider, red,
                       explicitly-labelled button rather than the same icon
                       again, so confirming is a deliberate act and not a
                       double-tap that happened to land twice. */
                    pendingDeleteId === song.id ? (
                      <button
                        type="button"
                        onClick={() => onRequestDelete(song)}
                        aria-label={`Confirm delete ${song.name || song.song || 'song'}`}
                        className="px-2.5 py-2 rounded-lg text-[11px] font-semibold text-on-dark bg-danger hover:opacity-90 transition-opacity whitespace-nowrap"
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequestDelete(song)}
                        aria-label={`Delete ${song.name || song.song || 'song'}`}
                        className="p-2 rounded-lg text-muted hover:text-danger hover:bg-surface transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function StatRow({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[13px] text-secondary shrink-0">{label}</dt>
      <dd className={`text-[13px] font-bold text-right ${
        tone === 'brand' ? 'text-brand' : tone === 'amber' ? 'text-amber' : 'text-primary'
      }`}>
        {value}
      </dd>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ShowDetailView({
  show,
  friends = [],
  onClose,
  onUpdateRating,
  onUpdateVenueRating,
  onUpdateComment,
  onTagFriends,
  onCreatePlaylist,
  onDeleteShow,
  onAddSong,
  onReorderSetlist,
  // Removes one song from this show's setlist, and puts it back. Two
  // callbacks rather than one, because the undo has to restore the song at
  // the index it came from — see deleteSongFromShow in AppContext.
  onDeleteSong,
  onRestoreSong,
  // Re-fetches this show's setlist from its band source (El Goose,
  // phish.net) and returns a result object saying what happened. Undefined
  // for a guest session, and never rendered for an artist setlist.fm owns.
  onResyncSetlist,
  toggleFavoriteArtist,
  isArtistFavorite,
  allShows = [],
  user,
  // The explicit, user-created Festival this show is attached to (or null)
  // — resolved by the caller from `show.festivalId` against useApp()'s
  // `festivals` array (see app/shows/page.jsx / ShowDetailClient.jsx),
  // since this component takes shows as a prop rather than calling
  // useApp() itself. Replaces the old isFestival/festivalName tagging UI.
  festival = null,
}) {
  const [showPlayCounts, setShowPlayCounts] = useState(true);
  const [toast, setToast] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [newSongName, setNewSongName] = useState('');
  const [newSongSet, setNewSongSet] = useState('');
  const [editMode, setEditMode] = useState(false);
  // { loading } | { result } from onResyncSetlist. Held here rather than in
  // a toast because the interesting outcomes are the ones where nothing
  // changed, and those deserve to stay on screen next to the setlist they
  // are about.
  const [resyncState, setResyncState] = useState(null);
  // The song whose delete button has been tapped once. Cleared on a second
  // tap, on a tap elsewhere, or after a few seconds — an armed delete
  // button that stays armed is a trap.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  // The last deleted song, held only long enough to offer an undo.
  const [lastDeleted, setLastDeleted] = useState(null);
  const pendingTimer = useRef(null);
  const undoTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(pendingTimer.current);
    clearTimeout(undoTimer.current);
  }, []);

  const artistShowCount = useMemo(
    () => allShows.filter(s => s.artist === show?.artist).length,
    [allShows, show?.artist]
  );
  const venueShowCount = useMemo(
    () => allShows.filter(s => s.venue === show?.venue).length,
    [allShows, show?.venue]
  );
  // Shows seen per song title — a song played twice in one show counts
  // once (lib/songCounts.js).
  const playCounts = useMemo(() => countSongsByShow(
    allShows.filter(s => s.artist === show?.artist),
    song => song.song || song.title || song.name || ''
  ), [allShows, show?.artist]);
  // Reuses lib/runIndex.js's pure builder directly off the `allShows` prop
  // (which every caller already passes as the full context `shows` array)
  // rather than the useRunIndex hook, since this component takes shows as a
  // prop, not via useApp().
  const runForThisShow = useMemo(() => {
    if (!show?.id) return null;
    const index = buildRunIndex(allShows);
    const run = Object.values(index).find(r => r.nights.some(n => n.showId === show.id));
    if (!run) return null;
    const nightNumber = run.nights.findIndex(n => n.showId === show.id) + 1;
    return { runKey: run.key, nightNumber, nightCount: run.nightCount };
  }, [allShows, show?.id]);
  // Tour link — only when this show's tour name actually resolves to a
  // tour in the user's own history (buildTourIndex only keeps artist+tour
  // groupings drawn from their logged shows), so a tour name setlist.fm
  // supplied for a one-off show renders as plain text rather than a link
  // to an empty page. Same index and route the Tours page reads.
  const tourLinkHref = useMemo(() => {
    const name = show?.tour || show?.tourName;
    if (!name || !show?.artist) return null;
    const key = tourKeyFor(show.artist, name);
    if (!key) return null;
    return buildTourIndex(allShows)[key] ? tourHref(key) : null;
  }, [allShows, show?.artist, show?.tour, show?.tourName]);

  const artistSlug = show?.artist ? artistSlugFromName(show.artist) : null;
  const getSongHref = (title) => {
    if (!artistSlug) return null;
    const songSlug = songSlugFromTitle(title);
    return songSlug ? `/songs/?artist=${artistSlug}&song=${songSlug}` : null;
  };
  const totalDuration = useMemo(() => {
    let secs = 0;
    (show?.setlist || []).forEach(s => {
      const parts = (s.duration || '').split(':').map(Number);
      if (parts.length === 2) secs += parts[0] * 60 + parts[1];
    });
    if (!secs) return null;
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [show?.setlist]);

  if (!show) return null;

  const sets              = buildSets(show.setlist);
  const existingSetLabels = getSetLabels(show.setlist);
  const totalSongs        = show.setlist?.length || 0;
  const debuts            = (show.setlist || []).filter(s => s.debut || s.tags?.includes('debut')).length;
  // Whether this show's setlist came from a band source rather than from
  // setlist.fm or the user. An absent `setlistSource` means setlist.fm —
  // every show document written before v5.33.0 has no such field, and the
  // default is what they'd say anyway.
  const isBandSourced     = !!show.setlistSource && show.setlistSource !== 'setlistfm';
  // Where this artist's setlists SHOULD come from, which is not the same
  // question as where this show's setlist DID come from. A Goose show
  // logged before 5.33.0 has a setlist.fm setlist and a band source that
  // has never been asked — that gap is what the re-fetch below closes.
  const artistSource      = resolveSource({ name: show.artist, mbid: show.artistMbid });
  const taggedFriendIds   = new Set(show.taggedFriendUids || []);
  const taggedFriends     = friends.filter(f => taggedFriendIds.has(f.friendUid));
  const isFavorite        = isArtistFavorite?.(show.artist) || false;

  const handleShare = async () => {
    try { await navigator.clipboard.writeText(`https://mysetlists.net/shows/${show.id}`); } catch {}
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  };

  const saveNote = () => {
    onUpdateComment?.(show.id, noteText.trim());
    setEditingNote(false);
  };

  // First tap arms, second tap deletes. The armed state disarms itself
  // after a few seconds so a button left armed on screen cannot be hit by
  // a later, unrelated tap.
  const handleRequestDelete = async (song) => {
    clearTimeout(pendingTimer.current);

    if (pendingDeleteId !== song.id) {
      setPendingDeleteId(song.id);
      pendingTimer.current = setTimeout(() => setPendingDeleteId(null), 5000);
      return;
    }

    setPendingDeleteId(null);
    const removed = await onDeleteSong?.(show.id, song.id);
    if (!removed) return;

    // Held briefly, then dropped. An undo that stays on screen forever
    // reads as an unfinished action.
    setLastDeleted({ ...removed, name: song.name || song.song || song.title || 'That song' });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastDeleted(null), 12000);
  };

  const handleUndoDelete = async () => {
    if (!lastDeleted) return;
    clearTimeout(undoTimer.current);
    const { song, index } = lastDeleted;
    setLastDeleted(null);
    await onRestoreSong?.(show.id, song, index);
  };

  const handleResync = async () => {
    setResyncState({ loading: true });
    try {
      const result = await onResyncSetlist(show.id);
      setResyncState({ result });
    } catch (err) {
      setResyncState({ result: { ok: false, reason: 'fetch-failed', detail: err?.message || String(err) } });
    }
  };

  const handleAddSong = (e) => {
    e.preventDefault();
    if (!newSongName.trim()) return;
    const set = newSongSet || existingSetLabels[existingSetLabels.length - 1] || 'Set I';
    onAddSong?.(show.id, { name: newSongName.trim(), set });
    setNewSongName('');
  };

  return (
    <div className="max-w-5xl mx-auto">

      {/* ── Back button ────────────────────────────────────────────────────── */}
      {/* Hidden below md:, where components/layout/MobileHeader.jsx already
          provides the back control — two back affordances stacked on one
          screen is exactly the doubled-header problem this work set out to
          remove. Desktop keeps it, and it keeps its own hit area. */}
      <button
        onClick={onClose}
        className="hidden md:flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-5 transition-colors py-2 -my-2"
      >
        <ArrowLeft className="w-4 h-4" />
        All shows
      </button>

      {/* ── Header card ────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-subtle rounded-2xl p-6 mb-6">

        {/* Artist name + action icons */}
        <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b border-subtle">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1 className="text-2xl font-bold text-amber">{show.artist}</h1>
            {show.url && (
              <a
                href={show.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-subtle text-muted hover:bg-hover transition-colors"
              >
                setlist.fm
              </a>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0 -mr-1">
            {toggleFavoriteArtist && (
              <IconBtn
                onClick={() => toggleFavoriteArtist(show.artist)}
                active={isFavorite}
                activeClass="text-red-500"
              >
                <Heart className={`w-5 h-5 ${isFavorite ? 'fill-red-500' : ''}`} />
              </IconBtn>
            )}
            {onTagFriends && user && (
              <IconBtn onClick={() => onTagFriends(show)}>
                <Tag className="w-5 h-5" />
              </IconBtn>
            )}
            <IconBtn onClick={handleShare}>
              <Share2 className="w-5 h-5" />
            </IconBtn>
            {onCreatePlaylist && totalSongs > 0 && (
              <IconBtn onClick={() => onCreatePlaylist(show)}>
                <ListMusic className="w-5 h-5" />
              </IconBtn>
            )}
            <IconBtn
              onClick={() => setShowPlayCounts(v => !v)}
              active={showPlayCounts}
              activeClass="text-brand bg-brand/10"
            >
              <Hash className="w-5 h-5" />
            </IconBtn>
            {onDeleteShow && user && (
              <IconBtn onClick={() => setShowDeleteModal(true)} danger>
                <Trash2 className="w-5 h-5" />
              </IconBtn>
            )}
            <IconBtn onClick={onClose}>
              <X className="w-5 h-5" />
            </IconBtn>
          </div>
        </div>

        {/* Date · Venue, City */}
        <p className="text-sm text-secondary mb-1">
          {formatShowDate(show.date)}
          {show.venue && ` · ${show.venue}${show.city ? `, ${show.city}` : ''}`}
        </p>

        {/* Tour — links to the tour's own page when the app knows that tour.
            This sits below the header's own click targets (artist/venue), so
            there's no nested-interactive conflict to worry about. */}
        {(show.tour || show.tourName) && (
          <p className="text-sm font-medium text-brand mb-3">
            Tour:{' '}
            {tourLinkHref ? (
              <Link
                href={tourLinkHref}
                className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
              >
                {show.tourName || show.tour}
              </Link>
            ) : (
              show.tourName || show.tour
            )}
          </p>
        )}

        {/* Run + festival badges — both can be true for the same show
            (e.g. one night of a multi-night run that was also part of a
            festival weekend), so these render side by side, not either/or. */}
        {(runForThisShow || festival) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {runForThisShow && (
              <Link
                href={`/runs/?run=${encodeURIComponent(runForThisShow.runKey)}`}
                className="inline-block text-sm font-semibold text-amber bg-amber-subtle px-2.5 py-1 rounded-lg hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Night {runForThisShow.nightNumber} of {runForThisShow.nightCount} — view the full run
              </Link>
            )}
            {festival && (
              <Link
                href={festivalHref(festival.id)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber bg-amber-subtle px-2.5 py-1 rounded-lg hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <Tent className="w-3.5 h-3.5" />
                {festival.name} — view festival
              </Link>
            )}
          </div>
        )}

        {/* Show + venue ratings */}
        <div className="flex items-center gap-x-6 gap-y-2 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary">Show rating:</span>
            <select
              value={show.rating || ''}
              onChange={e => onUpdateRating?.(show.id, Number(e.target.value) || 0)}
              className="border border-subtle rounded-lg px-2 py-1 text-sm text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 cursor-pointer"
            >
              <option value="">—</option>
              {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {(show.rating || 0) > 0 && (
              <span className="text-sm font-semibold text-brand">{show.rating}/10</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary">Venue rating:</span>
            <select
              value={show.venueRating || ''}
              onChange={e => onUpdateVenueRating?.(show.id, Number(e.target.value) || 0)}
              className="border border-subtle rounded-lg px-2 py-1 text-sm text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 cursor-pointer"
            >
              <option value="">—</option>
              {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {(show.venueRating || 0) > 0 && (
              <span className="text-sm font-semibold text-amber">{show.venueRating}/10</span>
            )}
          </div>
        </div>

        {/* Show note */}
        {editingNote ? (
          <div className="mb-4 flex gap-2">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), saveNote())}
              placeholder="Add a note about this show..."
              rows={2}
              autoFocus
              className="flex-1 px-3 py-2 border border-subtle rounded-lg text-sm text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
            />
            <div className="flex flex-col gap-1">
              <button onClick={saveNote} className="px-3 py-1.5 bg-brand text-[#2a2a4e] rounded-lg text-xs font-medium">
                Save
              </button>
              <button onClick={() => setEditingNote(false)} className="px-3 py-1.5 bg-hover text-secondary rounded-lg text-xs font-medium">
                Cancel
              </button>
            </div>
          </div>
        ) : show.comment ? (
          <button
            onClick={() => { setEditingNote(true); setNoteText(show.comment); }}
            className="flex items-start gap-2 mb-4 text-sm text-secondary hover:text-primary transition-colors text-left w-full"
          >
            <MessageSquare className="w-4 h-4 shrink-0 mt-0.5 text-muted" />
            <span className="italic">{show.comment}</span>
          </button>
        ) : (
          <button
            onClick={() => { setEditingNote(true); setNoteText(''); }}
            className="flex items-center gap-2 mb-4 text-sm text-muted hover:text-primary transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Add show note
          </button>
        )}

        {/* About panels */}
        <div className="space-y-1">
          <EntityInfoPanel
            name={show.artist}
            type="artist"
            extraContent={
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-secondary">Shows seen</span>
                  <span className="font-semibold text-primary">{artistShowCount}</span>
                </div>
                <a href={`/stats?artist=${encodeURIComponent(show.artist)}`} className="text-xs text-brand hover:underline block">
                  View full artist stats →
                </a>
              </div>
            }
          />
          {show.venue && (
            <EntityInfoPanel
              name={show.venue}
              type="venue"
              city={show.city}
              extraContent={
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-secondary">Shows seen here</span>
                    <span className="font-semibold text-primary">{venueShowCount}</span>
                  </div>
                  {(show.city || show.state) && (
                    <div className="flex justify-between">
                      <span className="text-secondary">Location</span>
                      <span className="font-semibold text-primary">{[show.city, show.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  <Link href={`/shows/?venueKey=${encodeURIComponent(venueKeyFor(show.venue, show.city))}`} className="text-xs text-amber hover:underline block">
                    All shows at this venue →
                  </Link>
                </div>
              }
            />
          )}
        </div>
      </div>

      {/* ── Two-column: setlist + sidebar ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 items-start">

        <section>
          <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
            <h2 className="text-[22px] font-extrabold text-primary tracking-tight">Setlist</h2>
            <div className="flex items-center gap-2.5">
              {onReorderSetlist && totalSongs > 0 && (
                <button
                  onClick={() => setEditMode(v => !v)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 min-h-touch md:min-h-0 rounded-lg pressable transition-colors ${
                    editMode ? 'bg-brand text-[#2a2a4e]' : 'bg-hover text-primary'
                  }`}
                >
                  {editMode ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                  {editMode ? 'Done editing' : 'Edit setlist'}
                </button>
              )}
              {totalSongs > 0 && !editMode && (
                <button
                  onClick={() => setShowPlayCounts(v => !v)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 min-h-touch md:min-h-0 rounded-lg pressable transition-colors ${
                    showPlayCounts ? 'bg-elevated text-primary' : 'bg-hover text-primary'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5" />
                  {showPlayCounts ? 'Hide play counts' : 'Show play counts'}
                </button>
              )}
            </div>
          </div>

          {editMode ? (
            <>
              <SetlistEditControls
                setlist={show.setlist || []}
                onMoveSet={(songId, newLabel) => onReorderSetlist(show.id, moveSongToSet(show.setlist, songId, newLabel))}
                onReorder={(setLabel, index, direction) => onReorderSetlist(show.id, reorderSongWithinSet(show.setlist, setLabel, index, direction))}
                onRequestDelete={onDeleteSong ? handleRequestDelete : undefined}
                pendingDeleteId={pendingDeleteId}
              />

              {/* The undo. A rating and a comment live on the song that was
                  just removed, and there is no other way back to them. */}
              {lastDeleted && (
                <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 bg-hover border border-subtle rounded-xl">
                  <span className="text-xs text-secondary truncate">
                    Removed <span className="text-primary font-medium">{lastDeleted.name}</span>
                    {lastDeleted.song?.rating ? ` — its ${lastDeleted.song.rating}/10 rating went with it` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleUndoDelete}
                    className="text-xs font-semibold text-brand hover:underline shrink-0"
                  >
                    Undo
                  </button>
                </div>
              )}
            </>
          ) : sets.length > 0 ? (
            <SetlistView
              sets={sets}
              showPlayCounts={showPlayCounts}
              playCounts={playCounts}
              getSongHref={getSongHref}
            />
          ) : (
            <p className="text-muted text-sm py-10 text-center">No setlist recorded yet.</p>
          )}

          {/* Show-level prose from the source. phish.net keeps this
              ("setlistnotes"); setlist.fm has no equivalent, so this is
              absent for everyone else. */}
          {!editMode && show.setlistNotes && (
            <p className="mt-5 text-[13px] leading-relaxed text-secondary bg-hover rounded-lg px-3.5 py-3 whitespace-pre-line">
              {show.setlistNotes}
            </p>
          )}

          {/* Credit where it is due. These are volunteer-run archives and
              the link back to the show's own page on them is the least this
              app owes them. Rendered off the stored `setlistSource` rather
              than by sniffing for band-source fields, and only for a band
              source — setlist.fm attribution already lives elsewhere on
              this page, and a show predating this release has no
              setlistSource at all. */}
          {!editMode && sets.length > 0 && isBandSourced && (
            <p className="mt-3 text-[11px] text-muted">
              Setlist from{' '}
              <a
                href={show.sourcePermalink || sourceHomeUrl(show.setlistSource)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted underline decoration-dotted hover:text-brand transition-colors"
              >
                {sourceLabel(show.setlistSource)}
              </a>
            </p>
          )}

          {/* ── Re-fetch from the band source ──────────────────────────
              Rendered for any show whose ARTIST has a band source, not just
              for shows already sourced from one — a Goose show logged
              before 5.33.0 carries a setlist.fm setlist, and
              scanForMissingSetlists deliberately won't touch it because it
              only fills empty setlists. Without this there is no way, from
              the app, to ask for the swap on a show that already has
              something in it.

              The wording changes with the current source because the two
              cases are genuinely different: a swap away from setlist.fm,
              versus refreshing from the archive this setlist already came
              from (which is worth doing — these archives correct setlists
              after review, which is why the cache TTL is capped at 24h). */}
          {!editMode && onResyncSetlist && artistSource.isBandSource && (
            <div className="mt-3">
              <button
                onClick={handleResync}
                disabled={resyncState?.loading}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 min-h-touch md:min-h-0 rounded-lg pressable bg-hover text-primary hover:bg-elevated transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resyncState?.loading ? 'animate-spin' : ''}`} />
                {resyncState?.loading
                  ? `Asking ${artistSource.label}...`
                  : isBandSourced
                    ? `Re-fetch from ${artistSource.label}`
                    : `Get setlist from ${artistSource.label}`}
              </button>

              {!isBandSourced && !resyncState && (
                <p className="mt-1.5 text-[11px] text-muted">
                  This setlist came from setlist.fm. {artistSource.label} is the band&apos;s own archive — it has
                  segues, footnotes and jam charts. Your ratings and any songs you added are kept.
                </p>
              )}

              {resyncState?.result && (
                <p className={`mt-1.5 text-[11px] ${resyncState.result.ok ? 'text-success' : 'text-muted'}`}>
                  {describeResync(resyncState.result, artistSource.label, formatShowDate(show.date))}
                  {resyncState.result.ok && resyncState.result.ambiguous && resyncState.result.message
                    ? ` ${resyncState.result.message}`
                    : ''}
                </p>
              )}
            </div>
          )}

          {onAddSong && (
            <form onSubmit={handleAddSong} className="flex gap-2 mt-4">
              <input
                type="text"
                value={newSongName}
                onChange={e => setNewSongName(e.target.value)}
                placeholder="Add a song setlist.fm missed..."
                className="flex-1 px-3 py-2 border border-subtle rounded-lg text-sm text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 placeholder-muted"
              />
              <select
                value={newSongSet || existingSetLabels[existingSetLabels.length - 1] || 'Set I'}
                onChange={e => setNewSongSet(e.target.value)}
                className="border border-subtle rounded-lg px-2 py-2 text-sm text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40 cursor-pointer"
              >
                {getSetOptions(show.setlist).map(label => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
              <Button variant="secondary" type="submit" icon={Plus} disabled={!newSongName.trim()}>
                Add song
              </Button>
            </form>
          )}

          <StreamingLinks show={show} />
          <ArchivalAudioSection show={show} />
        </section>

        <aside className="space-y-3 lg:sticky lg:top-6">
          {totalSongs > 0 && (
            <SidebarCard>
              <SidebarLabel>Show Stats</SidebarLabel>
              <dl className="space-y-2.5">
                <StatRow label="Songs" value={totalSongs} />
                {totalDuration && <StatRow label="Duration" value={totalDuration} />}
                {show.tour && (
                  <StatRow
                    label="Tour"
                    tone={tourLinkHref ? 'brand' : undefined}
                    value={tourLinkHref ? (
                      <Link href={tourLinkHref} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded">
                        {show.tour}
                      </Link>
                    ) : show.tour}
                  />
                )}
                {debuts > 0 && <StatRow label="Debuts" value={`${debuts} song${debuts !== 1 ? 's' : ''}`} tone="brand" />}
              </dl>
            </SidebarCard>
          )}

          {taggedFriends.length > 0 && (
            <SidebarCard>
              <SidebarLabel>Friends Who Were There</SidebarLabel>
              <ul className="space-y-3">
                {taggedFriends.map(f => (
                  <li key={f.friendUid} className="flex items-center gap-3">
                    <Avatar name={f.friendName || ''} size="sm" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-primary leading-snug">{f.friendName || 'Friend'}</div>
                      {f.friendEmail && <div className="text-[11px] text-muted truncate">{f.friendEmail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </SidebarCard>
          )}

          {onTagFriends && (
            <Button variant="secondary" icon={UserPlus} className="w-full" onClick={() => onTagFriends(show)}>
              Tag friends
            </Button>
          )}
        </aside>
      </div>

      <ShowMediaSection show={show} />
      <CommentsSection show={show} />

      {/* Share toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-success text-white font-medium text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          Link copied to clipboard!
        </div>
      )}

      <DeleteShowModal
        show={show}
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={async (showId) => { await onDeleteShow(showId); onClose(); }}
      />
    </div>
  );
}
