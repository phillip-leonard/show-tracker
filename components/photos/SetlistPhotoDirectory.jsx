// components/photos/SetlistPhotoDirectory.jsx
//
// /setlist-photos page body — a searchable directory of setlist photos
// across every concert (not just one show), so a photo of a written
// setlist can be found and used as reference even if you didn't log that
// exact show yourself. Browse-only: no upload here — setlist photos are
// added from a show's own Setlist Photos gallery (ShowMediaSection), tied
// to that concert. See lib/photos.js's listAllSetlistPhotos() for why
// this is a one-time fetch (capped at 300, filtered client-side) rather
// than a real-time listener — Firestore has no free-text search, and a
// global cross-concert feed doesn't need to be live the way one show's
// gallery does.
//
// Moderation (Guideline 1.2): this page is a cross-concert feed of other
// people's uploads, so it carries the same report affordance and the same
// blocked-uploader filtering as a show's own gallery.

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, ScrollText, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, EmptyState, Spinner, Input, Avatar, Modal } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { listAllSetlistPhotos, togglePhotoLike } from '@/lib/photos';
import { notifyEngagement } from '@/lib/notifications';
import { timeAgo } from '@/lib/utils';
import { withoutBlocked } from '@/lib/moderation';
import ReportButton from '@/components/moderation/ReportButton';
import UserLink from '@/components/moderation/UserLink';

function Lightbox({ items, index, onIndexChange, onClose, currentUid, onLike, onReported }) {
  const item = items[index];
  const [zoomed, setZoomed] = useState(false);

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft') onIndexChange((index - 1 + items.length) % items.length);
    if (e.key === 'ArrowRight') onIndexChange((index + 1) % items.length);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  useEffect(() => { setZoomed(false); }, [index]);

  if (!item) return null;
  const liked = currentUid ? (item.likedBy || []).includes(currentUid) : false;

  return (
    <Modal open onClose={onClose} size="xl" showClose={false}>
      <div className="flex flex-col gap-3">
        <div className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center" style={{ minHeight: '50vh' }}>
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => onIndexChange((index - 1 + items.length) % items.length)} aria-label="Previous" className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
                <ChevronLeft size={20} />
              </button>
              <button type="button" onClick={() => onIndexChange((index + 1) % items.length)} aria-label="Next" className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
                <ChevronRight size={20} />
              </button>
            </>
          )}
          <img
            src={item.url}
            alt={item.caption || 'Setlist photo'}
            onClick={() => setZoomed((z) => !z)}
            className={`transition-transform cursor-zoom-in ${zoomed ? 'max-w-none max-h-none scale-150 cursor-zoom-out' : 'max-w-full max-h-[70vh] object-contain'}`}
          />
        </div>
        <p className="text-xs text-muted text-center -mt-1">Click the image to zoom in</p>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-primary">{item.artist}</div>
            <div className="text-xs text-muted">{[item.venue, item.date].filter(Boolean).join(' · ')}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <Avatar name={item.uploaderName} size="sm" />
              <UserLink uid={item.uploadedBy} name={item.uploaderName}
                        className="text-sm text-secondary">
                {item.uploaderName}
              </UserLink>
              <span className="text-xs text-muted">{timeAgo(item.createdAt)}</span>
            </div>
            {item.caption && <p className="text-sm text-secondary mt-1.5">{item.caption}</p>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => onLike(item)}
              disabled={!currentUid}
              className={`flex items-center gap-1 text-sm font-medium transition-colors ${liked ? 'text-danger' : 'text-muted hover:text-primary'} disabled:opacity-50`}
            >
              <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              {(item.likedBy || []).length > 0 && (item.likedBy || []).length}
            </button>
            <ReportButton
              contentType="showMedia"
              contentId={item.id}
              contentSnapshot={item.caption || item.url}
              reportedUserId={item.uploadedBy}
              reportedUserName={item.uploaderName}
              onReported={() => onReported?.(item)}
              showLabel={false}
              size={16}
            />
            <button type="button" onClick={onClose} className="text-muted hover:text-primary text-sm font-medium">Close</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function SetlistPhotoDirectory() {
  const { user, setToast, blockedUserIds } = useApp();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [reportedIds, setReportedIds] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listAllSetlistPhotos();
        if (!cancelled) setPhotos(list);
      } catch (err) {
        console.error('[setlist-photos] Failed to load:', err);
        if (!cancelled) setToast?.("Couldn't load setlist photos. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setToast]);

  const filtered = useMemo(() => {
    // Blocked uploaders and anything reported this session come out
    // before the search runs, so a blocked user's photo cannot be
    // surfaced by searching for the artist.
    const visible = withoutBlocked(photos, blockedUserIds, 'uploadedBy')
      .filter((p) => !reportedIds.includes(p.id));
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((p) =>
      (p.artist || '').toLowerCase().includes(q) ||
      (p.date || '').includes(q) ||
      (p.venue || '').toLowerCase().includes(q)
    );
  }, [photos, search, blockedUserIds, reportedIds]);

  const handleLike = async (item) => {
    if (!user) return;
    const alreadyLiked = (item.likedBy || []).includes(user.uid);
    try {
      await togglePhotoLike(item.id, user.uid, alreadyLiked);
      setPhotos((prev) => prev.map((p) => p.id !== item.id ? p : {
        ...p,
        likedBy: alreadyLiked ? p.likedBy.filter((u) => u !== user.uid) : [...(p.likedBy || []), user.uid],
      }));
      // The server checks the like is stored and notifies the uploader.
      if (!alreadyLiked) notifyEngagement('photo_like', item.id);
    } catch (err) {
      setToast?.("Couldn't update your like. Please try again.");
    }
  };

  if (loading) {
    return <div className="py-12"><Spinner size="md" label="Loading setlist photos…" /></div>;
  }

  return (
    <div className="space-y-4">
      <Input
        icon={Search}
        placeholder="Search by artist, venue, or date…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={ScrollText}
            tone="brand"
            title={photos.length === 0 ? 'No setlist photos yet' : 'No matches'}
            body={photos.length === 0
              ? 'Setlist photos uploaded from any show will show up here, searchable by artist or venue.'
              : 'Try a different search.'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="text-left rounded-xl overflow-hidden hover:opacity-90 transition-opacity"
            >
              <div className="aspect-square overflow-hidden">
                <img src={item.url} alt={item.caption || 'Setlist photo'} className="w-full h-full object-cover" />
              </div>
              <div className="mt-1.5">
                <div className="text-sm font-semibold text-primary truncate">{item.artist}</div>
                <div className="text-xs text-muted truncate">{[item.venue, item.date].filter(Boolean).join(' · ')}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={filtered}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          currentUid={user?.uid}
          onLike={handleLike}
          onReported={(item) => {
            setReportedIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
            setLightboxIndex(null);
          }}
        />
      )}
    </div>
  );
}
