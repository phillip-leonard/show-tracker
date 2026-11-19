// components/photos/MediaGalleryView.jsx
//
// Presentational gallery: thumbnail grid + lightbox + upload button, for
// one category ('photo' | 'poster' | 'setlist') of a concert's media.
// Deliberately takes `items` as a prop rather than subscribing itself —
// see ShowMediaSection.jsx, which subscribes once for all three
// categories so a show page doesn't run three near-identical Firestore
// listeners against the same concertKey.
//
// Moderation (Guideline 1.2): the lightbox carries a report affordance
// alongside like and delete, and uploads from blocked users never reach
// the grid. Captions are filtered before upload — see UploadMediaModal.

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Heart, Trash2, ChevronLeft, ChevronRight, Play, Plus } from 'lucide-react';
import { Card, Avatar, Button, Modal, Spinner, Tabs } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { togglePhotoLike, deletePhoto, extractYoutubeId } from '@/lib/photos';
import { timeAgo } from '@/lib/utils';
import { withoutBlocked } from '@/lib/moderation';
import ReportButton from '@/components/moderation/ReportButton';
import UserLink from '@/components/moderation/UserLink';

import UploadMediaModal from './UploadMediaModal';

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'liked', label: 'Most Liked' },
];

function Thumbnail({ item, onClick }) {
  if (item.type === 'youtube') {
    const videoId = extractYoutubeId(item.url);
    return (
      <button type="button" onClick={onClick} className="relative aspect-square rounded-xl overflow-hidden group bg-hover">
        {videoId && (
          <img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt={item.caption || 'Video'} className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
          <Play size={28} className="text-white drop-shadow" fill="white" />
        </div>
      </button>
    );
  }

  if (item.type === 'video') {
    return (
      <button type="button" onClick={onClick} className="relative aspect-square rounded-xl overflow-hidden group bg-hover">
        <video src={item.url} className="w-full h-full object-cover" preload="metadata" muted />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
          <Play size={28} className="text-white drop-shadow" fill="white" />
        </div>
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} className="aspect-square rounded-xl overflow-hidden hover:opacity-90 transition-opacity">
      <img src={item.url} alt={item.caption || 'Concert photo'} className="w-full h-full object-cover" />
    </button>
  );
}

function Lightbox({ items, index, onIndexChange, onClose, currentUid, canModerate, onLike, onDelete, onReported, zoomable }) {
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
  const canDelete = currentUid && (item.uploadedBy === currentUid || canModerate);
  const videoId = item.type === 'youtube' ? extractYoutubeId(item.url) : null;

  return (
    <Modal open onClose={onClose} size="xl" showClose={false}>
      <div className="flex flex-col gap-3">
        <div className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center" style={{ minHeight: '50vh' }}>
          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => onIndexChange((index - 1 + items.length) % items.length)}
                aria-label="Previous"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => onIndexChange((index + 1) % items.length)}
                aria-label="Next"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}

          {item.type === 'youtube' ? (
            <iframe
              src={`https://www.youtube.com/embed/${videoId}`}
              title={item.caption || 'YouTube video'}
              className="w-full aspect-video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : item.type === 'video' ? (
            <video src={item.url} controls autoPlay className="max-w-full max-h-[70vh]" />
          ) : (
            <img
              src={item.url}
              alt={item.caption || 'Concert media'}
              onClick={zoomable ? () => setZoomed((z) => !z) : undefined}
              className={`transition-transform ${zoomable ? 'cursor-zoom-in' : ''} ${
                zoomed ? 'max-w-none max-h-none scale-150 cursor-zoom-out' : 'max-w-full max-h-[70vh] object-contain'
              }`}
            />
          )}
        </div>
        {zoomable && (
          <p className="text-xs text-muted text-center -mt-1">Click the image to zoom in</p>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Avatar name={item.uploaderName} size="sm" />
              <UserLink uid={item.uploadedBy} name={item.uploaderName}
                        className="text-sm font-semibold text-primary">
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
              className={`flex items-center gap-1 text-sm font-medium transition-colors ${
                liked ? 'text-danger' : 'text-muted hover:text-primary'
              } disabled:opacity-50`}
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
            {canDelete && (
              <button type="button" onClick={() => onDelete(item)} className="text-muted hover:text-danger">
                <Trash2 size={16} />
              </button>
            )}
            <button type="button" onClick={onClose} className="text-muted hover:text-primary text-sm font-medium">
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function MediaGalleryView({ show, concertKey, category, title, icon: Icon, emptyText, signInText, zoomable, items, allItems, loading }) {
  const { user, isAdmin, guestMode, setToast, blockedUserIds } = useApp();
  const [lightboxIndex, setLightboxIndex] = useState(null);
  // Reported this session — hidden for the reporter straight away, before
  // the third report auto-hides it for everyone. See ReportModal.
  const [reportedIds, setReportedIds] = useState([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sort, setSort] = useState('newest');

  // subscribePhotos already orders by createdAt desc — 'liked' is the
  // only case that needs a client-side re-sort.
  // Everything below reads visibleItems, not the `items` prop, so the
  // count in the header, the grid and the lightbox cannot disagree about
  // what is on screen.
  const visibleItems = useMemo(
    () => withoutBlocked(items, blockedUserIds, 'uploadedBy')
      .filter((item) => !reportedIds.includes(item.id)),
    [items, blockedUserIds, reportedIds],
  );

  const sortedItems = useMemo(() => {
    if (sort !== 'liked') return visibleItems;
    return [...visibleItems].sort((a, b) => (b.likedBy?.length || 0) - (a.likedBy?.length || 0));
  }, [visibleItems, sort]);

  const handleReported = (item) => {
    setReportedIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
    setLightboxIndex(null);
  };

  const handleLike = async (item) => {
    if (!user) return;
    const alreadyLiked = (item.likedBy || []).includes(user.uid);
    try {
      // The server writes the like and notifies the uploader (5.60.38).
      await togglePhotoLike(item.id, alreadyLiked);
    } catch (err) {
      setToast?.("Couldn't update your like. Please try again.");
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Delete this?')) return;
    try {
      await deletePhoto(item);
      setLightboxIndex(null);
    } catch (err) {
      setToast?.("Couldn't delete that. Please try again.");
    }
  };

  return (
    <Card padding="md" className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Icon size={18} className="text-brand" />
          {title} {visibleItems.length > 0 && <span className="text-muted font-normal text-sm">({visibleItems.length})</span>}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {visibleItems.length > 1 && <Tabs value={sort} onChange={setSort} tabs={SORTS} className="border-b-0" />}
          {user && !guestMode && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setUploadOpen(true)}>
              Add {category === 'photo' ? 'Photos' : title}
            </Button>
          )}
        </div>
      </div>

      {!user || guestMode ? (
        <p className="text-sm text-muted">{signInText}</p>
      ) : loading ? (
        <div className="py-8"><Spinner size="sm" label={`Loading ${title.toLowerCase()}…`} /></div>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-muted text-center py-8">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sortedItems.map((item, i) => (
            <Thumbnail key={item.id} item={item} onClick={() => setLightboxIndex(i)} />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          items={sortedItems}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          currentUid={user?.uid}
          canModerate={isAdmin}
          onLike={handleLike}
          onDelete={handleDelete}
          onReported={handleReported}
          zoomable={zoomable}
        />
      )}

      {user && !guestMode && (
        <UploadMediaModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          concertKey={concertKey}
          uid={user.uid}
          uploaderName={user.displayName || 'Anonymous'}
          show={show}
          category={category}
          title={`Add ${title}`}
          existingPhotos={allItems}
          // The server writes your friends' activity entry (5.60.38).
          onUploaded={() => setToast?.('Uploaded!')}
          onError={(msg) => setToast?.(msg)}
        />
      )}
    </Card>
  );
}
