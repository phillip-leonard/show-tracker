// components/meetups/MeetupDetailView.jsx
//
// Full meetup page: show details, attendee list, an organizer-pinned
// description (where/when to meet), and a flat discussion thread. See
// lib/meetups.js for the data model.
//
// Moderation (Guideline 1.2): the discussion is user-generated text on a
// page other attendees see, so messages carry a report affordance,
// messages from blocked users never render, and both the message box and
// the organizer's pinned description are filtered before they are saved.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, MapPin, Pin, Send, Trash2, Users } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  leaveMeetup, updateMeetupDescription,
  subscribeMeetupComments, postMeetupComment, deleteMeetupComment,
} from '@/lib/meetups';
import { Card, Button, Textarea, Avatar, Spinner, EmptyState } from '@/components/ui';
import { formatDate, timeAgo } from '@/lib/utils';
import { contentProblem } from '@/lib/contentFilter';
import { withoutBlocked } from '@/lib/moderation';
import ReportButton from '@/components/moderation/ReportButton';
import UserLink from '@/components/moderation/UserLink';

function DiscussionThread({ meetupId }) {
  const { user, blockedUserIds } = useApp();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [reportedIds, setReportedIds] = useState([]);

  const visibleComments = withoutBlocked(comments, blockedUserIds, 'authorUid')
    .filter((c) => !reportedIds.includes(c.id));

  useEffect(() => {
    setLoading(true);
    return subscribeMeetupComments(meetupId, (list) => {
      setComments(list);
      setLoading(false);
    });
  }, [meetupId]);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!text.trim() || !user) return;

    const problem = contentProblem(text);
    if (problem) {
      setError(problem);
      return;
    }

    setPosting(true);
    setError('');
    try {
      await postMeetupComment(meetupId, user.uid, user.displayName || 'Someone', text);
      setText('');
    } catch (err) {
      console.error('[meetups] Failed to post comment:', err);
      // The write path can reject the text on its own terms — say so
      // under the box rather than failing silently, which is what this
      // did before.
      setError(err.message || "Couldn't post that. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card padding="md">
      <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">Discussion</h3>

      {loading ? (
        <Spinner size="sm" label="Loading discussion…" />
      ) : visibleComments.length === 0 ? (
        <p className="text-sm text-muted mb-4">No messages yet — say hello to whoever else is going.</p>
      ) : (
        <ul className="list-none p-0 m-0 space-y-4 mb-5">
          {visibleComments.map((c) => (
            <li key={c.id} className="flex items-start gap-3">
              <Avatar name={c.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <UserLink uid={c.authorUid} name={c.authorName}
                            className="text-sm font-semibold text-primary">
                    {c.authorName}
                  </UserLink>
                  <span className="text-xs text-muted">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="text-sm text-secondary mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
              </div>
              {user?.uid === c.authorUid ? (
                <button
                  type="button"
                  onClick={() => deleteMeetupComment(c.id)}
                  className="p-1 text-muted hover:text-danger flex-shrink-0"
                  aria-label="Delete message"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <ReportButton
                  contentType="meetupComment"
                  contentId={c.id}
                  contentSnapshot={c.text}
                  reportedUserId={c.authorUid}
                  reportedUserName={c.authorName}
                  onReported={() => setReportedIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]))}
                  showLabel={false}
                  className="p-1 flex-shrink-0"
                  size={14}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {user && (
        <form onSubmit={handlePost} className="flex items-end gap-2">
          <Textarea
            rows={2}
            containerClassName="flex-1"
            placeholder="Where should we meet? What time?"
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
            error={error}
          />
          <Button type="submit" icon={Send} loading={posting} disabled={!text.trim()}>Send</Button>
        </form>
      )}
    </Card>
  );
}

export default function MeetupDetailView({ meetup }) {
  const { user, navigateTo, setToast } = useApp();
  const [description, setDescription] = useState(meetup.description || '');
  const [editingDescription, setEditingDescription] = useState(false);
  const [saving, setSaving] = useState(false);
  const [descriptionError, setDescriptionError] = useState('');

  useEffect(() => setDescription(meetup.description || ''), [meetup.description]);

  const isOrganizer = user?.uid === meetup.createdBy;
  const isAttending = (meetup.attendeeUids || []).includes(user?.uid);
  const attendeeUids = meetup.attendeeUids || [];

  const handleSaveDescription = async () => {
    // The pinned description is shown to everyone who joins, so it goes
    // through the same filter as a message — and, since v5.36.2, through
    // the same server path. The meetups rule restricts this field to the
    // organizer, but a rule decides who may write, never what: the
    // organizer could publish a slur to every attendee with the filter
    // below skipped. This check is for the inline error; the server's is
    // the gate.
    const problem = contentProblem(description);
    if (problem) {
      setDescriptionError(problem);
      return;
    }
    setDescriptionError('');
    setSaving(true);
    try {
      await updateMeetupDescription(meetup.concertKey, description);
      setEditingDescription(false);
    } catch (err) {
      console.error('[meetups] Failed to save description:', err);
      // The server runs the same filter, so a rejection here is most
      // often "that text isn't allowed" — inline under the field, where
      // the client-side rejection already goes, rather than a toast that
      // reads like the save merely failed.
      setDescriptionError(err.message || "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleLeave = async () => {
    try {
      await leaveMeetup(meetup.id);
      navigateTo('bucket-list');
    } catch (err) {
      console.error('[meetups] Failed to leave:', err);
      setToast?.("Couldn't leave the meetup. Please try again.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Link
        href="/bucket-list/"
        // Hidden below md:: components/layout/MobileHeader.jsx now carries
        // the back control on this screen, and two back affordances stacked
        // on one screen is the doubled-header problem this work removes.
        // Desktop keeps it, with a real vertical hit area.
        className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary py-2 -my-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Bucket list
      </Link>

      <Card padding="md">
        <h1 className="text-2xl font-bold text-primary mb-1">{meetup.artist}</h1>
        <div className="flex items-center gap-1.5 text-sm text-secondary mt-1">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          {formatDate(meetup.date)}
        </div>
        {(meetup.venue || meetup.city) && (
          <div className="flex items-center gap-1.5 text-sm text-muted mt-1">
            <MapPin className="w-4 h-4 flex-shrink-0" />
            {[meetup.venue, meetup.city].filter(Boolean).join(', ')}
          </div>
        )}

        {isAttending && (
          <div className="mt-4">
            <Button size="sm" variant="ghost" className="text-danger hover:bg-[#fdecec]" onClick={handleLeave}>
              Leave meetup
            </Button>
          </div>
        )}
      </Card>

      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide flex items-center gap-1.5">
            <Pin className="w-3.5 h-3.5" /> Meetup details
          </h3>
          {isOrganizer && !editingDescription && (
            <Button size="sm" variant="ghost" onClick={() => setEditingDescription(true)}>Edit</Button>
          )}
        </div>

        {editingDescription ? (
          <div className="space-y-2">
            <Textarea
              rows={3}
              placeholder="Where and when should the group meet? (e.g. 'Meeting at the merch tent 1hr before doors')"
              value={description}
              onChange={(e) => { setDescription(e.target.value); if (descriptionError) setDescriptionError(''); }}
              error={descriptionError}
            />
            <div className="flex gap-2">
              <Button size="sm" loading={saving} onClick={handleSaveDescription}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingDescription(false); setDescription(meetup.description || ''); setDescriptionError(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-secondary whitespace-pre-wrap">
            {meetup.description || (isOrganizer ? 'Add details on where and when to meet up.' : 'No details pinned yet.')}
          </p>
        )}
      </Card>

      <Card padding="md">
        <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> {attendeeUids.length} going
        </h3>
        {attendeeUids.length === 0 ? (
          <EmptyState icon={Users} title="Nobody yet" body="Be the first to say you're going." />
        ) : (
          <div className="flex flex-wrap gap-3">
            {attendeeUids.map((uid) => (
              <div key={uid} className="flex items-center gap-2">
                <Avatar name={meetup.attendeeNames?.[uid] || 'Fan'} size="sm" />
                <span className="text-sm text-primary">
                  {meetup.attendeeNames?.[uid] || 'Fan'}
                  {uid === meetup.createdBy && <span className="text-xs text-muted ml-1">(organizer)</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <DiscussionThread meetupId={meetup.id} />
    </div>
  );
}
