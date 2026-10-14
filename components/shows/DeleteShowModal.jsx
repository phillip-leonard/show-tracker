'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import Button from '@/components/ui/Button';

export default function DeleteShowModal({ show, isOpen, onClose, onConfirm }) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !show) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(show.id);
      onClose();
    } catch {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-elevated border border-danger/30 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-danger/10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-danger/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-5 h-5 text-danger" />
          </div>
          <h2 className="text-lg font-semibold text-primary">Delete Show?</h2>
        </div>

        <p className="text-secondary text-sm mb-4 leading-relaxed">
          Are you sure you want to remove this show from your collection? This cannot be undone.
        </p>

        <div className="bg-surface border border-subtle rounded-xl p-4 mb-6 space-y-0.5">
          {show.date && (
            <div className="text-xs text-muted font-medium uppercase tracking-wide">
              {formatDate(show.date)}
            </div>
          )}
          <div className="text-base font-bold text-primary">{show.artist}</div>
          <div className="text-sm text-secondary">{show.venue}</div>
          {show.city && <div className="text-xs text-muted">{show.city}</div>}
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isDeleting} full>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={handleDelete}
            loading={isDeleting}
            disabled={isDeleting}
            full
          >
            {isDeleting ? 'Deleting…' : 'Delete Show'}
          </Button>
        </div>
      </div>
    </div>
  );
}
