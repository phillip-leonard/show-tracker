// components/comments/CommentsSection.jsx
//
// Comment thread for a concert, shown at the bottom of ShowDetailView.
// Threaded one level deep (top-level comments + replies), real-time via
// Firestore listener, sortable, likeable, and moderated (author or admin
// can delete). See lib/comments.js for the data model and why this is
// keyed by concert identity rather than any one user's private show doc.
//
// Moderation (Guideline 1.2): every comment carries a report affordance
// except your own, comments from blocked users never reach the list, and
// the text is filtered before it is posted — client-side here so the
// writer gets an inline error, and again in the Netlify function that is
// now the only write path, so the check cannot be skipped.

'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MessageSquare, Heart, Trash2, CornerDownRight, Send } from 'lucide-react';
import { Card, Avatar, Button, Textarea, Tabs, Spinner } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { subscribeComments, postComment, toggleCommentLike, deleteComment } from '@/lib/comments';
import { getLastViewed, markViewed } from '@/lib/commentViews';
import { contentProblem } from '@/lib/contentFilter';
import { withoutBlocked } from '@/lib/moderation';
import ReportButton from '@/components/moderation/ReportButton';
import UserLink from '@/components/moderation/UserLink';
import { timeAgo } from '@/lib/utils';

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'liked', label: 'Most Liked' },
];

// Matches an "@" that starts a mention-in-progress right at the cursor —
// either at the very start of the text or preceded by whitespace, so
// "email@x.com" doesn't trigger a mention halfway through a word.
const MENTION_PATTERN = /(?:^|\s)@(\w*)$/;

function CommentComposer({ onSubmit, placeholder, autoFocus, onCancel, friends = [] }) {
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null); // null = no mention popup open
  const textareaRef = useRef(null);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return friends
      .filter((f) => (f.friendName || '').toLowerCase().includes(q))
      .slice(0, 5);
  }, [mentionQuery, friends]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    // Clear as they type rather than leaving a stale rejection under a
    // box they have already fixed.
    if (error) setError('');
    const cursor = e.target.selectionStart ?? val.length;
    const match = val.slice(0, cursor).match(MENTION_PATTERN);
    setMentionQuery(match ? match[1] : null);
  };

  const selectMention = (friend) => {
    const el = textareaRef.current;
    const cursor = el ? el.selectionStart ?? text.length : text.length;
    const before = text.slice(0, cursor).replace(MENTION_PATTERN, (m, _q, offset) =>
      (m.startsWith(' ') ? ' ' : '') + `@${friend.friendName} `
    );
    const newText = before + text.slice(cursor);
    setText(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || posting) return;

    // Checked here so the writer gets an inline error instead of a
    // round trip that ends in a rejected write. The same check runs
    // server-side; this one is for them, that one is the enforcement.
    const problem = contentProblem(text);
    if (problem) {
      setError(problem);
      return;
    }

    setPosting(true);
    setError('');
    try {
      await onSubmit(text);
      setText('');
      if (onCancel) onCancel();
    } catch (err) {
      // postComment now goes through a function that can reject the text
      // on its own — surface that here rather than letting the post
      // silently fail.
      setError(err.message || "Couldn't post that. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex gap-2 items-start relative">
      <div className="flex-1 relative">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          placeholder={placeholder}
          rows={2}
          autoFocus={autoFocus}
          error={error}
        />
        {mentionMatches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-surface border border-subtle rounded-xl shadow-theme-md overflow-hidden">
            {mentionMatches.map((f) => (
              <button
                key={f.friendUid}
                type="button"
                onClick={() => selectMention(f)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-hover transition-colors"
              >
                <Avatar name={f.friendName} size="sm" />
                {f.friendName}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button type="submit" size="sm" icon={Send} loading={posting} disabled={!text.trim()}>
          Post
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </form>
  );
}

function CommentRow({ comment, isReply, currentUid, canModerate, onReply, onLike, onDelete, onReported, replyOpen, onToggleReply, isNew, friends }) {
  const liked = currentUid ? (comment.likedBy || []).includes(currentUid) : false;
  const likeCount = (comment.likedBy || []).length;
  const canDelete = currentUid && (comment.authorUid === currentUid || canModerate);

  return (
    <div className={`flex gap-3 rounded-xl transition-colors ${isReply ? 'ml-10 mt-3' : 'py-4 border-b border-subtle last:border-0'} ${isNew ? 'bg-brand-subtle/40 -mx-2 px-2' : ''}`}>
      <Avatar name={comment.authorName} size={isReply ? 'sm' : 'md'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          {/* The name is the way to this person's profile — and so to the
              Block control — from a show page. Before this, blocking
              someone who had commented meant already being their friend. */}
          <UserLink uid={comment.authorUid} name={comment.authorName}
                    className="font-semibold text-sm text-primary">
            {comment.authorName}
          </UserLink>
          <span className="text-xs text-muted">{timeAgo(comment.createdAt)}</span>
          {isNew && <span className="text-[10px] font-bold uppercase tracking-wide text-brand">New</span>}
        </div>
        <p className="text-sm text-primary mt-0.5 whitespace-pre-wrap break-words">{comment.text}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            type="button"
            onClick={() => onLike(comment)}
            disabled={!currentUid}
            className={`flex items-center gap-1 text-xs font-medium transition-colors ${
              liked ? 'text-danger' : 'text-muted hover:text-primary'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
            {likeCount > 0 && likeCount}
          </button>
          {!isReply && currentUid && (
            <button
              type="button"
              onClick={onToggleReply}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-primary transition-colors"
            >
              <CornerDownRight size={13} /> Reply
            </button>
          )}
          {/* Report sits in the same control row as like/reply/delete,
              and hides itself on your own comment — see ReportButton. */}
          <ReportButton
            contentType="showComment"
            contentId={comment.id}
            contentSnapshot={comment.text}
            reportedUserId={comment.authorUid}
            reportedUserName={comment.authorName}
            onReported={() => onReported?.(comment)}
            className={canDelete ? '' : 'ml-auto'}
          />
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-danger transition-colors ml-auto"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
        {replyOpen && (
          <div className="mt-2">
            <CommentComposer
              placeholder={`Reply to ${comment.authorName}…`}
              autoFocus
              onCancel={onToggleReply}
              onSubmit={(text) => onReply(comment, text)}
              friends={friends}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommentsSection({ show }) {
  const { user, isAdmin, guestMode, visibleFriends: friends, blockedUserIds, setToast, normalizeShowKey } = useApp();
  const concertKey = useMemo(() => (show ? normalizeShowKey(show) : null), [show, normalizeShowKey]);

  const [comments, setComments] = useState([]);
  // Items this user has just reported. The report may take a moment to
  // reach the admin queue and three reports to auto-hide for everyone,
  // but the person who reported it should stop seeing it immediately —
  // held in state rather than written anywhere, since it only matters
  // for this session and the block list covers the durable case.
  const [reportedIds, setReportedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState('newest');
  const [replyOpenId, setReplyOpenId] = useState(null);
  // Captured once per mount, before markViewed() moves the high-water
  // mark forward — see lib/commentViews.js. Comments created after this
  // are highlighted "New"; re-opening the page later won't re-highlight
  // them, since by then lastViewedMs has advanced past them.
  const [lastViewedMs, setLastViewedMs] = useState(null);

  useEffect(() => {
    // Reading showComments requires Firestore auth (see firestore.rules) —
    // a guest has no Firebase auth user at all, so subscribing would just
    // fail with permission-denied and leave the spinner stuck forever.
    // Skip the listener entirely rather than let that happen.
    if (!concertKey || !user || guestMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const unsubscribe = subscribeComments(concertKey, (list, err) => {
      setComments(list);
      setLoading(false);
      setLoadError(!!err);
    });
    return unsubscribe;
  }, [concertKey, user, guestMode]);

  useEffect(() => {
    if (!concertKey || !user || guestMode) return;
    let cancelled = false;
    getLastViewed(user.uid, concertKey).then((ms) => {
      if (!cancelled) setLastViewedMs(ms);
    });
    markViewed(user.uid, concertKey);
    return () => { cancelled = true; };
  }, [concertKey, user, guestMode]);

  // Everything downstream — the thread, the replies, the count in the
  // header — reads this rather than `comments`, so a blocked or
  // just-reported comment cannot leak through one of them.
  const visibleComments = useMemo(
    () => withoutBlocked(comments, blockedUserIds, 'authorUid')
      .filter((c) => !reportedIds.includes(c.id)),
    [comments, blockedUserIds, reportedIds],
  );

  const topLevel = useMemo(() => {
    const roots = visibleComments.filter((c) => !c.parentId);
    const sorted = [...roots];
    if (sort === 'oldest') {
      sorted.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    } else if (sort === 'liked') {
      sorted.sort((a, b) => (b.likedBy?.length || 0) - (a.likedBy?.length || 0));
    } else {
      sorted.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    }
    return sorted;
  }, [visibleComments, sort]);

  const repliesFor = (commentId) =>
    visibleComments
      .filter((c) => c.parentId === commentId)
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

  // Replies and mentions are notified by the server when it creates the
  // comment (moderate-content, 5.60.29): the parent's author, and any of
  // your friends named as "@Name" in the text. `id` (your own show) links
  // the entry the server writes in your friends' activity (5.60.38).
  const showForComment = { id: show.id, artist: show.artist, venue: show.venue, date: show.date };

  const handlePost = async (text) => {
    const authorName = user.displayName || 'Anonymous';
    try {
      await postComment(concertKey, user.uid, authorName, text, null, showForComment);
    } catch (err) {
      // Rethrown rather than swallowed into a toast: postComment now
      // goes through a function that can reject the text on its own
      // terms, and "that word isn't allowed" belongs inline under the box
      // the writer is still looking at, not in a toast that slides away.
      throw err;
    }
  };

  const handleReply = async (parent, text) => {
    const authorName = user.displayName || 'Anonymous';
    try {
      await postComment(concertKey, user.uid, authorName, text, parent.id, showForComment);
    } catch (err) {
      throw err;
    }
  };

  const handleLike = async (comment) => {
    if (!user) return;
    const alreadyLiked = (comment.likedBy || []).includes(user.uid);
    try {
      // The server writes the like and notifies the author (5.60.38).
      await toggleCommentLike(comment.id, alreadyLiked, showForComment);
    } catch (err) {
      setToast?.("Couldn't update your like. Please try again.");
    }
  };

  const handleReported = (comment) => {
    setReportedIds((prev) => (prev.includes(comment.id) ? prev : [...prev, comment.id]));
  };

  const handleDelete = async (comment) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await deleteComment(comment.id);
    } catch (err) {
      setToast?.("Couldn't delete that comment. Please try again.");
    }
  };

  if (!concertKey) return null;

  return (
    <Card padding="md" className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
          <MessageSquare size={18} className="text-brand" />
          Comments {visibleComments.length > 0 && <span className="text-muted font-normal text-sm">({visibleComments.length})</span>}
        </h3>
        {topLevel.length > 1 && <Tabs value={sort} onChange={setSort} tabs={SORTS} className="border-b-0" />}
      </div>

      {user && !guestMode ? (
        <div className="mb-5">
          <CommentComposer placeholder="Share your thoughts on this show…" onSubmit={handlePost} friends={friends} />
        </div>
      ) : (
        <p className="text-sm text-muted mb-5">Sign in to see and join the discussion.</p>
      )}

      {!user || guestMode ? null : loading ? (
        <div className="py-8"><Spinner size="sm" label="Loading comments…" /></div>
      ) : loadError ? (
        <p className="text-sm text-muted text-center py-8">
          Couldn't load comments — try refreshing the page.
        </p>
      ) : topLevel.length === 0 ? (
        <p className="text-sm text-muted text-center py-8">
          No comments yet — be the first to say something about this show.
        </p>
      ) : (
        <div>
          {topLevel.map((comment) => (
            <div key={comment.id}>
              <CommentRow
                comment={comment}
                currentUid={user?.uid}
                canModerate={isAdmin}
                onLike={handleLike}
                onDelete={handleDelete}
                onReported={handleReported}
                onReply={handleReply}
                replyOpen={replyOpenId === comment.id}
                onToggleReply={() => setReplyOpenId(replyOpenId === comment.id ? null : comment.id)}
                isNew={lastViewedMs != null && comment.authorUid !== user.uid && (comment.createdAt?.toMillis?.() || 0) > lastViewedMs}
                friends={friends}
              />
              {repliesFor(comment.id).map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  isReply
                  currentUid={user?.uid}
                  canModerate={isAdmin}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onReported={handleReported}
                  isNew={lastViewedMs != null && reply.authorUid !== user.uid && (reply.createdAt?.toMillis?.() || 0) > lastViewedMs}
                  friends={friends}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
