import Link from 'next/link';
import ComparePage, { CompareTable, Section, Bullets, ExternalLink, compareMetadata } from '@/components/compare/ComparePage';

const PATH = '/compare/concert-archives/';

export const metadata = compareMetadata({
  path: PATH,
  title: 'MySetlists vs Concert Archives: Concert Tracker Comparison for Jam Fans',
  description: "Comparing MySetlists and Concert Archives for tracking the shows you've seen. Where each one is stronger, and which fits jam band fans.",
});

const FAQ = [
  { q: 'Is MySetlists free?', a: 'Yes. MySetlists is free on the web and iPhone.' },
  {
    q: 'Can I move my history from Concert Archives?',
    a: 'Yes, with a spreadsheet: put your concerts in a CSV or Excel file and import it. MySetlists matches each show, adds setlists and skips duplicates. The guide at mysetlists.net/switch/concert-archives/ walks through it.',
  },
  {
    q: "Does MySetlists work for bands that aren't jam bands?",
    a: 'Yes. Any artist with setlists on setlist.fm can be logged. Phish and Goose get extra depth from phish.net and elgoose.net.',
  },
];

export default function ConcertArchivesComparison() {
  return (
    <ComparePage path={PATH} title="MySetlists vs Concert Archives" faq={FAQ}>
      <p>
        <ExternalLink href="https://www.concertarchives.org/">Concert Archives</ExternalLink> has been around since 2013
        and is one of the best-known concert diaries on the web. MySetlists is newer and built specifically for jam band
        fans, who care about what was played as much as who played. Here&apos;s how they compare.
      </p>

      <Section title="At a glance">
        <CompareTable
          columns={['MySetlists', 'Concert Archives']}
          rows={[
            ['Built for', 'Jam band fans (Phish, Goose, Widespread Panic, Dead & Co)', 'All concert-goers'],
            ["Log shows you've attended", 'Yes', 'Yes'],
            ['Setlists', 'Yes, from setlist.fm, and from phish.net and elgoose.net for Phish and Goose', 'Yes'],
            ['Rate individual songs and jams', 'Yes', 'No'],
            ['Personal song gaps (shows since you last heard it)', 'Yes', 'No'],
            ['Tours and festivals', 'Yes', 'Festivals'],
            ['Tag friends at a show', 'Yes, and each friend you tag gets an email', 'Follow friends; tag friends'],
            ['Photos and videos', 'Yes, shared with everyone who logged the show', 'Yes'],
            ['Add a show from a ticket photo', 'Yes (AI ticket scanning)', 'No'],
            ['iPhone app', 'Yes', 'Yes (iOS and Android)'],
            ['Price', 'Free', 'Free, with a Pro tier'],
          ]}
        />
      </Section>

      <Section title="Where Concert Archives is stronger">
        <Bullets
          items={[
            ['Breadth and history.', 'Over a decade of community-added concerts across every genre.'],
            ['Photos and videos.', 'A much bigger library of fan photos and videos, built up over more than a decade.'],
            ['Android.', 'MySetlists is web and iPhone only for now.'],
            ['Imports.', 'Built-in importers for setlist.fm and Songkick histories.'],
          ]}
        />
      </Section>

      <Section title="Where MySetlists is stronger">
        <Bullets
          items={[
            ['Song-level depth.', 'Rate the “Tweezer” or “Arcadia” you heard, not just the show.'],
            ['Gaps for your own history.', "See how many of your shows by a band it's been since you last caught a song."],
            ['Jam-band data.', 'Phish setlists come from phish.net and Goose setlists from elgoose.net, the archives those fans trust, with segues and jam charts.'],
            ['Going with friends.', 'Tag the people you went with; they get an email and can add the show to their own history in one tap.'],
          ]}
        />
      </Section>

      <Section title="Moving your history">
        <p>
          You can bring the shows you&apos;ve logged with you in a spreadsheet. See{' '}
          <Link href="/switch/concert-archives/" className="text-brand hover:underline">Switching from Concert Archives</Link>{' '}
          for what carries over and how to import it.
        </p>
      </Section>

      <Section title="Which should you use?">
        <p>
          If you go to shows across every genre and want a big community, Concert Archives is a great fit. If you follow
          jam bands and care which songs you&apos;ve caught, MySetlists is built for you. You can use both.
        </p>
      </Section>
    </ComparePage>
  );
}
