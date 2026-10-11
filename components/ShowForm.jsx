'use client';

import React, { useState } from 'react';
import { Tag, ChevronDown, Check } from 'lucide-react';
import { Button, Card, Input, Badge } from '@/components/ui';

function ShowForm({ onSubmit, onCancel, friends = [], onTagFriends, initialData }) {
  const [formData, setFormData] = useState({
    artist: initialData?.artist || '',
    venue: initialData?.venue || '',
    date: initialData?.date || new Date().toISOString().split('T')[0]
  });
  const [tagOpen, setTagOpen] = useState(false);
  const [selectedTagFriends, setSelectedTagFriends] = useState(new Set());

  const toggleTagFriend = (uid) => {
    setSelectedTagFriends(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.artist && formData.venue && formData.date) {
      const result = await onSubmit(formData);
      // addShow returns the new show's id, or { id, duplicate } when the
      // show was already there. Tagging needs that id: without it the tags
      // went out but were never recorded on the show (the save targeted
      // users/{uid}/shows/undefined).
      const showId = typeof result === 'string' ? result : result?.id;
      if (showId && selectedTagFriends.size > 0 && onTagFriends) {
        await onTagFriends({ ...formData, id: showId }, [...selectedTagFriends]);
      }
    }
  };

  return (
    <Card variant="inset" padding="md" className="mb-4">
      <h3 className="text-lg font-semibold mb-4 text-primary">Add Show Manually</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          placeholder="Artist/Band"
          value={formData.artist}
          onChange={(e) => setFormData({...formData, artist: e.target.value})}
          required
        />
        <Input
          placeholder="Venue"
          value={formData.venue}
          onChange={(e) => setFormData({...formData, venue: e.target.value})}
          required
        />
        <input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({...formData, date: e.target.value})}
          className="w-full px-4 py-3 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary"
          required
        />
        {/* Tag Friends accordion (only for logged-in users with friends) */}
        {friends.length > 0 && (
          <div className="border border-subtle rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setTagOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-hover hover:bg-hover transition-colors text-sm"
            >
              <span className="flex items-center gap-2 text-secondary">
                <Tag className="w-4 h-4" />
                Tag friends at this show
                {selectedTagFriends.size > 0 && (
                  <Badge tone="green" size="sm">{selectedTagFriends.size} selected</Badge>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted transition-transform ${tagOpen ? 'rotate-180' : ''}`} />
            </button>
            {tagOpen && (
              <div className="p-4 space-y-2 max-h-48 overflow-y-auto">
                {friends.map(f => (
                  <label
                    key={f.friendUid}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                      selectedTagFriends.has(f.friendUid)
                        ? 'bg-brand-subtle border border-brand/30'
                        : 'bg-hover border border-subtle hover:bg-hover'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={selectedTagFriends.has(f.friendUid)} onChange={() => toggleTagFriend(f.friendUid)} />
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${selectedTagFriends.has(f.friendUid) ? 'bg-brand border-brand' : 'border-active'}`}>
                      {selectedTagFriends.has(f.friendUid) && <Check className="w-3 h-3 text-primary" />}
                    </div>
                    <span className="text-sm text-primary">{f.friendName || f.friendEmail}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" full>Add Show</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export default ShowForm;
