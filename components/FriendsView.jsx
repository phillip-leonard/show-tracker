'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Music, Calendar, MapPin, Check, Users, ChevronLeft, User, Send, Mail, UserPlus, UserCheck, UserX, Tag, RefreshCw, X, Clock } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { Button, Card, Badge, Tabs, EmptyState, Modal } from '@/components/ui';
import Input from '@/components/ui/Input';
import Tip from '@/components/ui/Tip';
import FriendCard from '@/components/friends/FriendCard';
import ShowsTogetherView from '@/components/ShowsTogetherView';
import { useApp } from '@/context/AppContext';

function FriendsView({
  user, friends, pendingFriendRequests, sentFriendRequests, pendingShowTags,
  onSendFriendRequestByEmail, onSendFriendRequest, onAcceptFriendRequest,
  onDeclineFriendRequest, onRemoveFriend, onAcceptShowTag, onDeclineShowTag,
  initialTab, getShowsTogether, showSuggestions, respondToSuggestion,
  pendingInvites, sentPendingEmailTags, inviteStats, onResendInvite, onCancelInvite,
  onBulkAcceptAll, onBulkAcceptFromFriend,
  // Show interaction handlers for ShowsTogetherView
  onAddSong, onRateSong, onCommentSong, onDeleteSong, onRateShow, onCommentShow, onBatchRate,
  onTagFriends, onRateVenue,
  allShows
}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'friends');
  const [searchEmail, setSearchEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [showingTogetherWith, setShowingTogetherWith] = useState(null); // null | { uid, name }
  const [resendingIds, setResendingIds] = useState(new Set()); // invite IDs currently being resent
  const [bulkConfirm, setBulkConfirm] = useState(null); // null | { type: 'all' } | { type: 'friend', friendUid, friendName }
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [sharedCounts, setSharedCounts] = useState({}); // friendUid -> together count
  const [blockConfirm, setBlockConfirm] = useState(null); // null | { uid, name }
  const [blocking, setBlocking] = useState(false);

  // Pulled from context rather than threaded through this component's
  // already long prop list — blocking is not part of the friends feature
  // it would otherwise belong to.
  const { blockUser } = useApp();

  const handleBlock = async () => {
    if (!blockConfirm) return;
    setBlocking(true);
    try {
      await blockUser(blockConfirm.uid);
      setBlockConfirm(null);
    } catch {
      // AppContext has already shown the toast.
    } finally {
      setBlocking(false);
    }
  };

  const inviteList = pendingInvites || [];

  const isExpired = (invite) => {
    const lastSent = invite.lastSentAt?.toMillis?.() ?? invite.createdAt?.toMillis?.() ?? 0;
    return Date.now() - lastSent > 30 * 24 * 60 * 60 * 1000;
  };

  const timeAgo = (ts) => {
    if (!ts) return '';
    const ms = Date.now() - (ts.toMillis?.() ?? ts);
    const d = Math.floor(ms / 86400000);
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7) return `${d} days ago`;
    if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) > 1 ? 's' : ''} ago`;
    return `${Math.floor(d / 30)} month${Math.floor(d / 30) > 1 ? 's' : ''} ago`;
  };

  const handleResend = async (invite) => {
    setResendingIds(prev => new Set(prev).add(invite.id));
    await onResendInvite(invite);
    setResendingIds(prev => { const s = new Set(prev); s.delete(invite.id); return s; });
  };

  // Navigate to initialTab when it changes (e.g., from notification banner)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Load "together" counts for each friend card (getShowsTogether is async)
  useEffect(() => {
    if (!getShowsTogether || friends.length === 0) return;
    let cancelled = false;
    Promise.all(
      friends.map(f => getShowsTogether(f.friendUid).then(shows => [f.friendUid, shows?.length ?? 0]))
    ).then(entries => {
      if (!cancelled) setSharedCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [friends, getShowsTogether]);

  const handleSendRequest = async () => {
    if (!searchEmail.trim()) return;
    setSending(true);
    await onSendFriendRequestByEmail(searchEmail);
    setSending(false);
    setSearchEmail('');
  };

  const pendingSuggestions = (showSuggestions || []).filter(
    s => s.responses?.[user?.uid] === 'pending' && s.overallStatus !== 'declined'
  );
  const partialSuggestions = (showSuggestions || []).filter(
    s => s.responses?.[user?.uid] === 'confirmed' && s.overallStatus === 'partially_confirmed'
  );

  // Group pending items by friend for bulk accept
  const friendGroups = useMemo(() => {
    const groups = {};
    pendingShowTags.forEach(tag => {
      const uid = tag.fromUid;
      if (!groups[uid]) groups[uid] = { name: tag.fromName, tags: [], suggestions: [] };
      groups[uid].tags.push(tag);
    });
    pendingSuggestions.forEach(s => {
      const otherUid = s.participants?.find(p => p !== user?.uid);
      if (otherUid) {
        if (!groups[otherUid]) groups[otherUid] = { name: s.names?.[otherUid] || 'A friend', tags: [], suggestions: [] };
        groups[otherUid].suggestions.push(s);
      }
    });
    return groups;
  }, [pendingShowTags, pendingSuggestions, user?.uid]);

  const totalPendingItems = pendingShowTags.length + pendingSuggestions.length;
  const friendGroupKeys = Object.keys(friendGroups);

  const handleBulkConfirm = async () => {
    setBulkProcessing(true);
    try {
      if (bulkConfirm.type === 'all') {
        await onBulkAcceptAll(pendingShowTags, pendingSuggestions);
      } else {
        await onBulkAcceptFromFriend(bulkConfirm.friendUid, pendingShowTags, pendingSuggestions);
      }
    } finally {
      setBulkProcessing(false);
      setBulkConfirm(null);
    }
  };

  const requestCount = pendingFriendRequests.length + pendingShowTags.length + pendingSuggestions.length;

  if (showingTogetherWith) {
    return (
      <ShowsTogetherView
        friend={showingTogetherWith}
        getShowsTogether={getShowsTogether}
        onBack={() => setShowingTogetherWith(null)}
        onAddSong={onAddSong}
        onRateSong={onRateSong}
        onCommentSong={onCommentSong}
        onDeleteSong={onDeleteSong}
        onRateShow={onRateShow}
        onCommentShow={onCommentShow}
        onBatchRate={onBatchRate}
        onTagFriends={onTagFriends}
        onRateVenue={onRateVenue}
        allShows={allShows}
      />
    );
  }

  return (
    <div>
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        className="mb-6"
        tabs={[
          { id: 'friends', label: 'All', count: friends.length },
          { id: 'requests', label: 'Requests', count: requestCount, badge: requestCount },
          { id: 'find', label: 'Find Friends' },
          { id: 'invites', label: 'Invites', count: inviteList.length + (sentPendingEmailTags || []).length, badge: inviteList.length + (sentPendingEmailTags || []).length },
        ]}
      />

      {/* My Friends Tab — card grid */}
      {activeTab === 'friends' && (
        <div>
          {friends.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No friends yet"
              body="Search by email or add from the Community leaderboard!"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {friends.map(friend => {
                const sharedCount = sharedCounts[friend.friendUid] ?? 0;
                return (
                  <FriendCard
                    key={friend.friendUid}
                    name={friend.friendName || 'Anonymous'}
                    handle={friend.friendEmail?.split('@')[0]}
                    avatarSrc={friend.photoURL}
                    sharedShows={sharedCount}
                    theirShows={friend.showCount ?? null}
                    theirShowsLabel="Their shows"
                    onMessage={() => {}}
                    onView={() => setShowingTogetherWith({ uid: friend.friendUid, name: friend.friendName || 'Friend' })}
                    onBlock={() => setBlockConfirm({ uid: friend.friendUid, name: friend.friendName || 'this person' })}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          {/* Bulk Accept Bar */}
          {totalPendingItems > 0 && (
            <Card padding="none" className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-secondary">
                  {totalPendingItems} pending show{totalPendingItems !== 1 ? 's' : ''} to review
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Check}
                  onClick={() => setBulkConfirm({ type: 'all' })}
                  className="bg-brand-subtle text-brand hover:bg-brand/30"
                >
                  Accept All ({totalPendingItems})
                </Button>
              </div>
              {friendGroupKeys.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {friendGroupKeys.map(uid => {
                    const g = friendGroups[uid];
                    const count = g.tags.length + g.suggestions.length;
                    return (
                      <Button
                        key={uid}
                        size="sm"
                        variant="secondary"
                        onClick={() => setBulkConfirm({ type: 'friend', friendUid: uid, friendName: g.name })}
                      >
                        {g.name} ({count})
                      </Button>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Incoming Friend Requests */}
          {pendingFriendRequests.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Friend Requests</h3>
              <div className="space-y-3">
                {pendingFriendRequests.map(req => (
                  <Card key={req.id} padding="none" className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber to-amber flex items-center justify-center">
                        <UserPlus className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-primary">{req.fromName || 'Someone'}</div>
                        <div className="text-sm text-muted">{req.fromEmail}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" icon={UserCheck} onClick={() => onAcceptFriendRequest(req.id)} className="bg-brand-subtle text-brand hover:bg-brand/30">Accept</Button>
                      <Button variant="ghost" size="sm" onClick={() => onDeclineFriendRequest(req.id)}>Decline</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Pending Show Tags */}
          {pendingShowTags.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Show Tags</h3>
              <div className="space-y-3">
                {pendingShowTags.map(tag => (
                  <Card key={tag.id} padding="none" className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Tag className="w-4 h-4 text-brand" />
                      <span className="text-secondary text-sm">
                        <span className="font-medium text-primary">{tag.fromName}</span>{' '}
                        {tag.showData?.upcoming ? 'tagged you as going to an upcoming show' : 'tagged you at a show'}
                      </span>
                    </div>
                    <div className="bg-hover rounded-xl p-3 mb-3">
                      <div className="font-medium" style={{ color: '#f59e0b' }}>{tag.showData?.artist}</div>
                      <div className="flex items-center gap-2 text-sm text-secondary mt-1">
                        <Calendar className="w-3.5 h-3.5 text-muted" />
                        <span>{formatDate(tag.showData?.date)}</span>
                        <span className="text-muted">&middot;</span>
                        <MapPin className="w-3.5 h-3.5 text-muted" />
                        <span>{tag.showData?.venue}{tag.showData?.city ? `, ${tag.showData.city}` : ''}</span>
                      </div>
                      {tag.showData?.setlist?.length > 0 && (
                        <div className="text-xs text-muted mt-2">
                          <Music className="w-3 h-3 inline mr-1" />
                          {tag.showData.setlist.length} songs in setlist
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" icon={Check} onClick={() => onAcceptShowTag(tag.id)}>
                        {tag.showData?.upcoming ? 'I\u2019m Going' : 'Add to My Shows'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDeclineShowTag(tag.id)}>Decline</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Show Suggestions */}
          {pendingSuggestions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Were You There Together?</h3>
              <div className="space-y-3">
                {pendingSuggestions.map(s => {
                  const otherUid = s.participants?.find(p => p !== user?.uid);
                  const otherName = otherUid ? s.names?.[otherUid] : 'A friend';
                  return (
                    <Card key={s.id} padding="none" className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-4 h-4 text-amber" />
                        <span className="text-secondary text-sm">
                          <span className="font-medium text-primary">{otherName}</span> may have been at this show with you
                        </span>
                      </div>
                      <div className="bg-hover rounded-xl p-3 mb-3">
                        <div className="font-medium" style={{ color: '#f59e0b' }}>{s.showData?.artist}</div>
                        <div className="flex items-center gap-2 text-sm text-secondary mt-1">
                          <Calendar className="w-3.5 h-3.5 text-muted" />
                          <span>{formatDate(s.showData?.date)}</span>
                          {s.showData?.venue && (
                            <>
                              <span className="text-muted">&middot;</span>
                              <MapPin className="w-3.5 h-3.5 text-muted" />
                              <span>{s.showData.venue}{s.showData?.city ? `, ${s.showData.city}` : ''}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" icon={Check} onClick={() => respondToSuggestion && respondToSuggestion(s, 'confirmed')} className="bg-amber-subtle text-amber hover:bg-amber/20">Yes, I was there!</Button>
                        <Button variant="ghost" size="sm" onClick={() => respondToSuggestion && respondToSuggestion(s, 'declined')}>No</Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Waiting for friend to confirm */}
          {partialSuggestions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Waiting for Confirmation</h3>
              <div className="space-y-3">
                {partialSuggestions.map(s => {
                  const otherUid = s.participants?.find(p => p !== user?.uid);
                  const otherName = otherUid ? s.names?.[otherUid] : 'Your friend';
                  return (
                    <div key={s.id} className="bg-hover rounded-2xl p-4 border border-brand/10">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="w-4 h-4 text-brand" />
                        <span className="text-secondary text-sm">
                          Waiting for <span className="font-medium text-primary">{otherName}</span> to confirm
                        </span>
                      </div>
                      <div className="bg-hover rounded-xl p-3">
                        <div className="font-medium" style={{ color: '#f59e0b' }}>{s.showData?.artist}</div>
                        <div className="flex items-center gap-2 text-sm text-secondary mt-1">
                          <Calendar className="w-3.5 h-3.5 text-muted" />
                          <span>{formatDate(s.showData?.date)}</span>
                          {s.showData?.venue && (
                            <>
                              <span className="text-muted">&middot;</span>
                              <MapPin className="w-3.5 h-3.5 text-muted" />
                              <span>{s.showData.venue}{s.showData?.city ? `, ${s.showData.city}` : ''}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sent Requests */}
          {sentFriendRequests.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Sent Requests</h3>
              <div className="space-y-3">
                {sentFriendRequests.map(req => (
                  <Card key={req.id} padding="none" className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-hover flex items-center justify-center">
                        <Send className="w-4 h-4 text-muted" />
                      </div>
                      <div>
                        <div className="font-medium text-secondary">{req.toName || req.toEmail || 'Unknown'}</div>
                        <div className="text-sm text-muted">Pending</div>
                      </div>
                    </div>
                    <Badge tone="green" size="sm">Awaiting response</Badge>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {pendingFriendRequests.length === 0 && pendingShowTags.length === 0 && sentFriendRequests.length === 0 && pendingSuggestions.length === 0 && partialSuggestions.length === 0 && (
            <div className="text-center py-12 text-muted">
              <Check className="w-12 h-12 text-muted mx-auto mb-4" />
              <p>No pending requests or tags</p>
            </div>
          )}
        </div>
      )}

      {/* Find Friends Tab */}
      {activeTab === 'find' && (
        <div>
          <Card padding="md">
            <h3 className="text-primary font-medium mb-4">Search by email</h3>
            <div className="flex gap-3">
              <Input
                type="email"
                placeholder="Enter your friend's email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
                icon={Mail}
                className="flex-1"
              />
              <Button
                variant="primary"
                onClick={handleSendRequest}
                disabled={sending || !searchEmail.trim()}
                loading={sending}
              >
                {sending ? 'Sending...' : 'Send Request'}
              </Button>
            </div>
            <p className="text-muted text-sm mt-3">
              You can also add friends from the <span className="text-brand">Community</span> leaderboard
            </p>
          </Card>
        </div>
      )}

      {/* Invites Tab */}
      {activeTab === 'invites' && (
        <div className="space-y-4">
          {/* Summary stat */}
          {inviteStats && (
            <div className="flex items-center gap-2 text-sm text-secondary bg-hover rounded-xl px-4 py-3 border border-subtle">
              <Mail className="w-4 h-4 text-muted flex-shrink-0" />
              <span>
                You've invited <span className="text-secondary font-medium">{inviteStats.total}</span> {inviteStats.total === 1 ? 'person' : 'people'} —{' '}
                <span className="text-brand font-medium">{inviteStats.accepted}</span> {inviteStats.accepted === 1 ? 'has' : 'have'} joined
              </span>
            </div>
          )}

          {inviteList.length === 0 ? (
            <div className="text-center py-12">
              <Send className="w-12 h-12 text-muted mx-auto mb-4" />
              <p className="text-muted mb-1">No pending invites</p>
              <p className="text-muted text-sm">Invite your friends from the <span className="text-brand">Invite</span> page!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inviteList
                .slice()
                .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
                .map(invite => {
                  const expired = isExpired(invite);
                  const isResending = resendingIds.has(invite.id);
                  const sentTs = invite.lastSentAt || invite.createdAt;
                  const originalTs = invite.createdAt;
                  const wasResent = !!invite.lastSentAt;
                  return (
                    <Card
                      key={invite.id}
                      padding="none"
                      className={`p-4 transition-all ${expired ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="font-medium text-primary truncate">{invite.inviteeEmail}</div>
                          <div className="text-xs text-muted mt-0.5">
                            {wasResent ? (
                              <>Last resent {timeAgo(sentTs)} &middot; Originally sent {timeAgo(originalTs)}</>
                            ) : (
                              <>Sent {timeAgo(originalTs)}</>
                            )}
                          </div>
                        </div>
                        <Badge tone="neutral" size="sm">{expired ? 'Expired' : 'Pending'}</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={isResending ? RefreshCw : Send}
                          onClick={() => handleResend(invite)}
                          disabled={isResending}
                          loading={isResending}
                          className="bg-brand-subtle text-brand hover:bg-brand/25 border border-brand/20"
                        >
                          {isResending ? 'Sending...' : 'Resend Invite'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={X}
                          onClick={() => onCancelInvite && onCancelInvite(invite.id)}
                          className="text-muted hover:text-danger hover:bg-danger/10 hover:border-danger/20"
                        >
                          Cancel
                        </Button>
                      </div>
                    </Card>
                  );
                })}
            </div>
          )}

          {/* Pending Email Tags (shows tagged to non-members) */}
          {(sentPendingEmailTags || []).length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wider mb-3">
                <Tag className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Tagged Shows — Waiting to Join
              </h3>
              <div className="space-y-3">
                {Object.entries(
                  (sentPendingEmailTags || []).reduce((acc, tag) => {
                    const email = tag.toEmail || 'unknown';
                    if (!acc[email]) acc[email] = { name: tag.toName || email, tags: [] };
                    acc[email].tags.push(tag);
                    return acc;
                  }, {})
                ).map(([email, { name, tags }]) => (
                  <Card key={email} padding="none" className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-primary truncate">{name}</div>
                        <div className="text-xs text-muted">{email}</div>
                      </div>
                      <Badge tone="amber" size="sm">Awaiting Signup</Badge>
                    </div>
                    <div className="space-y-1.5 mt-3">
                      {tags.map(tag => (
                        <div key={tag.id} className="flex items-center gap-2 text-sm text-secondary">
                          <Music className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                          <span className="truncate">
                            {tag.showData?.artist}
                            {tag.showData?.venue && <span className="text-muted"> — {tag.showData.venue}</span>}
                          </span>
                          {tag.showData?.date && (
                            <span className="text-xs text-muted flex-shrink-0">{formatDate(tag.showData.date)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted mt-2">
                      {tags.length} show{tags.length !== 1 ? 's' : ''} tagged — invitation sent
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Bulk Accept Confirmation Modal */}
      <Modal
        open={!!bulkConfirm}
        onClose={() => !bulkProcessing && setBulkConfirm(null)}
        title="Accept Shows"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setBulkConfirm(null)}
              disabled={bulkProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleBulkConfirm}
              disabled={bulkProcessing}
              loading={bulkProcessing}
            >
              {bulkProcessing ? 'Accepting...' : 'Accept All'}
            </Button>
          </>
        }
      >
        {bulkConfirm && (
          <p className="text-secondary text-sm">
            {bulkConfirm.type === 'all'
              ? `Accept all ${totalPendingItems} pending show${totalPendingItems !== 1 ? 's' : ''}? They'll be added to your collection.`
              : `Accept all ${(friendGroups[bulkConfirm.friendUid]?.tags.length || 0) + (friendGroups[bulkConfirm.friendUid]?.suggestions.length || 0)} pending show${((friendGroups[bulkConfirm.friendUid]?.tags.length || 0) + (friendGroups[bulkConfirm.friendUid]?.suggestions.length || 0)) !== 1 ? 's' : ''} from ${bulkConfirm.friendName}?`
            }
          </p>
        )}
      </Modal>

      {/* Block confirmation. Blocking removes the friendship in both
          directions, so it is worth one deliberate step rather than a
          single stray tap on a small icon. */}
      <Modal
        open={!!blockConfirm}
        onClose={() => !blocking && setBlockConfirm(null)}
        title={blockConfirm ? `Block ${blockConfirm.name}?` : 'Block'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlockConfirm(null)} disabled={blocking}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleBlock} loading={blocking}>
              Block
            </Button>
          </>
        }
      >
        {blockConfirm && (
          <p className="text-secondary text-sm">
            You won’t see {blockConfirm.name}’s comments, photos, meetup messages or
            activity, and you’ll be removed from each other’s friends list. Shows you’ve
            already logged together are kept. You can undo this in Profile → Blocked
            accounts.
          </p>
        )}
      </Modal>
    </div>
  );
}

export default FriendsView;
