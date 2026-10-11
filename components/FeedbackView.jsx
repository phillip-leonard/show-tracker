'use client';

import React, { useState, useEffect } from 'react';
import { Check, Send, TrendingUp } from 'lucide-react';
import { collection, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, Button, Tag, Textarea } from '@/components/ui';

function FeedbackView({ user, onNavigate, unreadNotifications, onMarkRead, onCreateAccount }) {
  const [feedbackType, setFeedbackType] = useState('general'); // 'feature' | 'bug' | 'general'
  const [category, setCategory] = useState('other');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Mark notifications read on mount (clears roadmap_published banner from badge)
  useEffect(() => {
    if (onMarkRead) onMarkRead();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roadmapNotifications = (unreadNotifications || []).filter(n => n.type === 'roadmap_published');

  const handleSubmit = async () => {
    if (!message.trim() || !user) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Write to feedback collection
      const feedbackData = {
        type: feedbackType,
        category: feedbackType === 'feature' ? category : null,
        message: message.trim(),
        submitterUid: user.uid,
        submitterEmail: user.email || '',
        submitterName: (user.displayName || '').split(' ')[0] || 'Anonymous',
        status: 'linked',
        roadmapItemId: null,
        createdAt: serverTimestamp(),
      };
      const feedbackRef = await addDoc(collection(db, 'feedback'), feedbackData);

      // Auto-create a draft roadmap item for ALL feedback types
      const draftTitle = feedbackType === 'feature'
        ? message.trim().slice(0, 100)
        : `[${feedbackType === 'bug' ? 'Bug' : 'Feedback'}] ${message.trim().slice(0, 90)}`;
      const itemRef = await addDoc(collection(db, 'roadmapItems'), {
        title: draftTitle,
        description: message.trim(),
        status: 'draft',
        category: feedbackType === 'feature' ? category : 'other',
        voteCount: 0,
        sourceFeedbackId: feedbackRef.id,
        submitterUid: user.uid,
        submitterEmail: user.email || '',
        contributors: user.email ? [{ email: user.email, votedAt: new Date().toISOString(), notified: false }] : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        publishedAt: null,
        completedAt: null,
        notificationsSent: false,
        notificationsSentAt: null,
      });
      await updateDoc(feedbackRef, { roadmapItemId: itemRef.id, status: 'linked' });
      setSubmitted(true);
    } catch (err) {
      setSubmitError('Failed to submit. Please try again.');
      console.error('Feedback submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const FEEDBACK_TYPES = [
    { id: 'feature', label: 'Feature Request' },
    { id: 'bug',     label: 'Bug Report'      },
    { id: 'general', label: 'General Feedback' },
  ];

  const CATEGORIES = [
    { id: 'ui',     label: 'UI/Design'   },
    { id: 'social', label: 'Social'      },
    { id: 'data',   label: 'Data & Stats' },
    { id: 'search', label: 'Search'      },
    { id: 'other',  label: 'Other'       },
  ];

  // Guests have no account to attribute feedback to (and the feedback
  // collection only accepts signed-in writes), so Submit used to do nothing
  // at all for them. Say why, and offer the way in.
  if (!user) {
    return (
      <div className="max-w-xl mx-auto">
        <Card padding="lg" className="text-center">
          <h2 className="text-xl font-bold text-primary mb-2">Sign in to send feedback</h2>
          <p className="text-secondary mb-6">
            Feedback is tied to your account so we can follow up when your idea ships.
            You can also email <a href="mailto:support@mysetlists.net" className="text-brand underline">support@mysetlists.net</a>.
          </p>
          {onCreateAccount && (
            <Button variant="primary" onClick={onCreateAccount} className="mx-auto">
              Create an account
            </Button>
          )}
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto">
        <Card padding="lg" className="text-center">
          <div className="w-12 h-12 bg-brand-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-6 h-6 text-brand" />
          </div>
          <h2 className="text-xl font-bold text-primary mb-2">Thanks for your feedback!</h2>
          <p className="text-secondary mb-6">
            Your feedback has been added to our review queue. Check the roadmap to see what's coming!
          </p>
          <Button
            variant="primary"
            icon={TrendingUp}
            onClick={() => onNavigate && onNavigate('roadmap')}
            className="mx-auto mb-4"
          >
            View Roadmap
          </Button>
          <button
            onClick={() => { setSubmitted(false); setMessage(''); setFeedbackType('general'); setCategory('other'); }}
            className="text-muted hover:text-primary text-sm transition-colors"
          >
            Send more feedback
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Roadmap notification banner */}
      {roadmapNotifications.length > 0 && (
        <div className="mb-6 px-4 py-3 bg-brand-subtle border border-brand/30 rounded-2xl">
          <p className="text-brand text-sm font-medium mb-1">
            Your feature idea is on the roadmap!
          </p>
          <p className="text-secondary text-xs mb-2">
            "{roadmapNotifications[0].itemTitle}" -- check it out and see how the community votes on it.
          </p>
          <button
            onClick={() => onNavigate && onNavigate('roadmap')}
            className="text-xs text-brand hover:text-brand font-medium transition-colors"
          >
            View Roadmap &rarr;
          </button>
        </div>
      )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => onNavigate && onNavigate('roadmap')}
          className="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors"
        >
          <TrendingUp className="w-3 h-3" />
          View Roadmap
        </button>
      </div>

      <Card padding="md" className="space-y-5">

        {/* Feedback type selector */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-2">Type</label>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TYPES.map(t => (
              <Tag key={t.id} selected={feedbackType === t.id} onClick={() => setFeedbackType(t.id)}>
                {t.label}
              </Tag>
            ))}
          </div>
        </div>

        {/* Category selector -- only for feature requests */}
        {feedbackType === 'feature' && (
          <div>
            <label className="block text-sm font-medium text-secondary mb-2">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <Tag key={c.id} selected={category === c.id} onClick={() => setCategory(c.id)}>
                  {c.label}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* Message textarea */}
        <Textarea
          label={feedbackType === 'feature' ? 'Describe your idea' : feedbackType === 'bug' ? 'What went wrong?' : 'Your Feedback'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            feedbackType === 'feature' ? "What feature would make MySetlists better for you?" :
            feedbackType === 'bug' ? "What happened? What were you trying to do?" :
            "Tell us what you think..."
          }
          rows={6}
        />

        {submitError && (
          <p className="text-danger text-sm">{submitError}</p>
        )}

        <Button
          variant="primary"
          full
          icon={submitting ? undefined : Send}
          loading={submitting}
          onClick={handleSubmit}
          disabled={!message.trim() || submitting}
        >
          {submitting ? 'Sending...' : 'Send Feedback'}
        </Button>
      </Card>
    </div>
  );
}

export default FeedbackView;
