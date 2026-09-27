'use client';

import React, { useState } from 'react';
import { Search, BarChart3, Users, Music, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { PageHeader, Card, SectionHeader } from '@/components/ui';

const sections = [
  {
    id: 'adding-shows',
    icon: Search,
    title: 'Adding Shows',
    description: 'Two ways to build your show history',
    steps: [
      {
        heading: 'Search for a Show',
        body: 'Click "Search for a Show" in the sidebar or the button on the Shows page. Enter an artist name and optional year, venue, or city. Select the show from the results — the setlist is imported automatically from Setlist.fm.',
      },
      {
        heading: 'Scan / Import',
        body: 'Have ticket stubs or a spreadsheet? Use Scan / Import. Take a photo of your ticket stubs and AI will extract the show details. Or upload a CSV/Excel file to add dozens of shows at once.',
      },
    ],
  },
  {
    id: 'setlists-ratings',
    icon: Music,
    title: 'Setlists & Ratings',
    description: 'Rate shows and individual songs',
    steps: [
      {
        heading: 'View a Setlist',
        body: 'Click any show in your list to open it. If a setlist was imported from Setlist.fm you\'ll see every song played. Toggle play counts to see how many times you\'ve heard each song across all your shows.',
      },
      {
        heading: 'Rate Songs & Shows',
        body: 'Tap the star next to any song to rate it. Rate the overall show from the show detail view. Your ratings feed into your Stats page, showing your top songs, artists, and venues.',
      },
      {
        heading: 'Find Missing Setlists',
        body: 'If a show is missing its setlist, the "Find Setlists" banner will appear on your Shows page. Click it to automatically fetch setlists for all your shows that are missing one.',
      },
    ],
  },
  {
    id: 'stats',
    icon: BarChart3,
    title: 'Stats',
    description: 'Discover patterns in your concert history',
    steps: [
      {
        heading: 'Your Stats Dashboard',
        body: 'The Stats page shows your most-seen artists, top venues, songs heard most often, and show frequency by year. Click any stat to drill into the details.',
      },
      {
        heading: 'Leaderboard',
        body: 'See how your show count ranks among all MySetlists users. Your rank appears in the summary bar at the top of the Shows page.',
      },
    ],
  },
  {
    id: 'friends',
    icon: Users,
    title: 'Friends & Tagging',
    description: 'Share shows with people you went with',
    steps: [
      {
        heading: 'Add Friends',
        body: 'Go to Friends and search by username or email. Send a friend request — once accepted, you can tag each other in shows.',
      },
      {
        heading: 'Tag Friends in Shows',
        body: 'Open a show and tap the Tag Friends button to mark who was there with you. Friends will receive a notification and the show will appear in their history too.',
      },
      {
        heading: 'Bulk Tagging',
        body: 'Use "Select Multiple Shows" on the Shows page to tag a friend in several shows at once — great for when you just added a bunch of past shows.',
      },
    ],
  },
  {
    id: 'profile',
    icon: Star,
    title: 'Profile & Sharing',
    description: 'Customize your profile and share your history',
    steps: [
      {
        heading: 'Public Profile',
        body: 'Your Profile page has a shareable link. Friends and non-members can view your show history, stats, and setlists without needing an account.',
      },
      {
        heading: 'Favorite Artists',
        body: 'Star artists from within any show to mark them as favorites. Favorited artists are highlighted on your Shows page.',
      },
    ],
  },
];

const faqs = [
  {
    q: 'Where does the setlist data come from?',
    a: 'Setlists are pulled from Setlist.fm, the largest community-driven setlist database. If a setlist isn\'t available yet, check back after a few days — the community usually adds them quickly.',
  },
  {
    q: 'Can I edit a setlist if it\'s wrong?',
    a: 'Currently setlists are imported as-is from Setlist.fm. To fix an incorrect setlist, update it on Setlist.fm directly. Then use Find Setlists to re-fetch it.',
  },
  {
    q: 'Is my data private?',
    a: 'Your shows are private by default. Only you can see your full history. If you share your profile link, visitors can see your shows — but nothing you haven\'t chosen to share.',
  },
  {
    q: 'What file formats does import support?',
    a: 'CSV and Excel (.xlsx) files are supported. Download the template from the Scan / Import page for the correct column format.',
  },
  {
    q: 'Can people without an account view shows they\'re tagged in?',
    a: 'Yes — tagged guests receive an email with a link to view the show without creating an account.',
  },
];

function Section({ section }) {
  const Icon = section.icon;
  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-brand-subtle flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h2 className="text-primary font-semibold text-base">{section.title}</h2>
          <p className="text-secondary text-xs mt-0.5">{section.description}</p>
        </div>
      </div>
      <div className="space-y-4">
        {section.steps.map((step) => (
          <div key={step.heading}>
            <h3 className="text-brand text-sm font-semibold mb-1">{step.heading}</h3>
            <p className="text-secondary text-sm leading-relaxed">{step.body}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FaqItem({ faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-subtle last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-primary text-sm font-medium">{faq.q}</span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted flex-shrink-0" />
        }
      </button>
      {open && (
        <p className="text-secondary text-sm leading-relaxed pb-4">{faq.a}</p>
      )}
    </div>
  );
}

export default function HowToUsePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Help"
        title="How to Use MySetlists"
        subtitle="Everything you need to track your concert history, rate setlists, and share shows with friends."
      />

      <div className="grid gap-4 sm:grid-cols-2 mb-10">
        {sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
      </div>

      <Card padding="md" className="mb-8">
        <SectionHeader title="Frequently Asked Questions" />
        <div>
          {faqs.map((faq) => (
            <FaqItem key={faq.q} faq={faq} />
          ))}
        </div>
      </Card>

      <Card padding="md" className="bg-brand-subtle border-brand/20 text-center">
        <p className="text-primary text-sm font-medium mb-1">Still have questions?</p>
        <p className="text-secondary text-sm">
          Use the{' '}
          <a href="/feedback" className="text-brand hover:underline font-medium">
            Feedback
          </a>{' '}
          link in the sidebar to send us a message.
        </p>
      </Card>
    </div>
  );
}
