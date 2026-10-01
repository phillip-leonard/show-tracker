'use client';

import React, { useState } from 'react';
import { Calendar, MapPin, Check, Search, ChevronLeft, Users, Send, RefreshCw, X } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { Button, Card, Input } from '@/components/ui';
import { useDismissable } from '@/context/DismissStackContext';

function TagFriendsModal({ show, friends, onTag, onInviteByEmail, onClose }) {
  useDismissable(true, onClose, { id: 'tag-friends' });
  const [selectedFriends, setSelectedFriends] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState('');
  // invite sub-form state
  const [inviteMode, setInviteMode] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null); // null | 'success' | 'error'

  const normalizedQuery = query.trim().toLowerCase();
  const filteredFriends = normalizedQuery
    ? friends.filter(f =>
        (f.friendName || '').toLowerCase().includes(normalizedQuery) ||
        (f.friendEmail || '').toLowerCase().includes(normalizedQuery)
      )
    : friends;

  const showInvitePrompt = normalizedQuery.length > 0 && filteredFriends.length === 0;

  const toggleFriend = (uid) => {
    setSelectedFriends(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleTag = async () => {
    setSending(true);
    await onTag([...selectedFriends]);
    setSending(false);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteStatus(null);
    try {
      await onInviteByEmail({ name: query.trim(), email: inviteEmail.trim(), message: inviteMessage.trim(), show });
      setInviteStatus('success');
      setInviteEmail('');
      setInviteMessage('');
    } catch {
      setInviteStatus('error');
    } finally {
      setInviteSending(false);
    }
  };

  return (
    <div className="fixed inset-0 md:left-64 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <Card variant="elevated" padding="none" className="w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-subtle">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-primary">Tag Friends</h2>
            <Button variant="ghost" icon={X} onClick={onClose} />
          </div>
          <Card variant="inset" padding="none" className="rounded-xl p-3">
            <div className="font-medium text-brand">{show.artist}</div>
            <div className="flex items-center gap-2 text-sm text-secondary mt-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>{formatDate(show.date)}</span>
              <span className="text-muted">&middot;</span>
              <MapPin className="w-3.5 h-3.5" />
              <span>{show.venue}</span>
            </div>
          </Card>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Search input */}
          {!inviteMode && (
            <div className="mb-4">
              <Input
                icon={Search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends by name or email..."
              />
            </div>
          )}

          {/* Invite sub-form */}
          {inviteMode && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                icon={ChevronLeft}
                onClick={() => { setInviteMode(false); setInviteStatus(null); }}
                className="mb-4"
              >
                Back to friend list
              </Button>
              <p className="text-secondary text-sm mb-3">
                Send <span className="text-primary font-medium">{query.trim()}</span> an invite to join mysetlists.net, with this show included.
              </p>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="friend@example.com"
                className="mb-3"
              />
              <textarea
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                placeholder="Add a personal note... (optional)"
                rows={3}
                className="w-full px-4 py-2.5 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary text-sm placeholder-muted resize-none mb-3"
              />
              {inviteStatus === 'success' && (
                <div className="flex items-center gap-2 text-brand text-sm font-medium mb-3">
                  <Check className="w-4 h-4" /> Invite sent! They&apos;ll get an email with the show details.
                </div>
              )}
              {inviteStatus === 'error' && (
                <div className="text-danger text-sm mb-3">Something went wrong. Please try again.</div>
              )}
              <Button
                variant="primary"
                icon={Send}
                full
                onClick={handleSendInvite}
                disabled={!inviteEmail.trim() || inviteSending}
                loading={inviteSending}
              >
                {inviteSending ? 'Sending...' : 'Send Invite'}
              </Button>
            </div>
          )}

          {/* Selected friend chips */}
          {!inviteMode && selectedFriends.size > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {[...selectedFriends].map(uid => {
                const f = friends.find(fr => fr.friendUid === uid);
                return f ? (
                  <span key={uid} className="flex items-center gap-1.5 px-3 py-1 bg-brand-subtle border border-brand/30 rounded-full text-brand text-xs font-medium">
                    {f.friendName || 'Friend'}
                    <button onClick={() => toggleFriend(uid)} className="text-brand/60 hover:text-brand">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          )}

          {/* Friend list / invite prompt */}
          {!inviteMode && (
            <>
              {friends.length === 0 && !normalizedQuery ? (
                <div className="text-center py-8">
                  <Users className="w-10 h-10 text-muted mx-auto mb-3" />
                  <p className="text-muted text-sm">Add friends first from the Friends page!</p>
                </div>
              ) : showInvitePrompt ? (
                <div className="text-center py-6">
                  <p className="text-secondary text-sm mb-3">
                    <span className="text-primary font-medium">{query.trim()}</span> isn't on mysetlists.net yet.
                  </p>
                  <Button
                    variant="ghost"
                    icon={Send}
                    onClick={() => { setInviteMode(true); setInviteStatus(null); }}
                    className="mx-auto bg-brand-subtle text-brand hover:bg-brand/30 border border-brand/30"
                  >
                    Invite {query.trim()}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-secondary mb-3">Select friends who were at this show:</p>
                  {filteredFriends.map(friend => (
                    <label
                      key={friend.friendUid}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                        selectedFriends.has(friend.friendUid)
                          ? 'bg-brand-subtle border border-brand/30'
                          : 'bg-hover border border-subtle hover:bg-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFriends.has(friend.friendUid)}
                        onChange={() => toggleFriend(friend.friendUid)}
                        className="sr-only"
                      />
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                        selectedFriends.has(friend.friendUid)
                          ? 'bg-brand border-brand'
                          : 'border-active'
                      }`}>
                        {selectedFriends.has(friend.friendUid) && <Check className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <div>
                        <div className="font-medium text-primary text-sm">{friend.friendName || 'Anonymous'}</div>
                        <div className="text-xs text-muted">{friend.friendEmail}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer -- tag button (only shown in list mode with selections) */}
        {!inviteMode && selectedFriends.size > 0 && (
          <div className="p-6 border-t border-subtle flex gap-3">
            <Button variant="ghost" full onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              full
              onClick={handleTag}
              disabled={sending}
              loading={sending}
            >
              {sending
                ? 'Tagging...'
                : `Tag ${selectedFriends.size} Friend${selectedFriends.size !== 1 ? 's' : ''} at This Show →`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export default TagFriendsModal;
