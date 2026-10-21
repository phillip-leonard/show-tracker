import ComparePage, { CompareTable, Section, Bullets, ExternalLink, compareMetadata } from '@/components/compare/ComparePage';

const PATH = '/compare/setlist-fm/';

export const metadata = compareMetadata({
  path: PATH,
  title: "MySetlists vs setlist.fm: Tracking the Shows You've Seen",
  description: 'setlist.fm is the biggest setlist archive. MySetlists is a show tracker built on top of setlists for jam band fans. Here’s how they differ.',
});

const FAQ = [
  {
    q: 'Does MySetlists use setlist.fm data?',
    a: 'Yes. MySetlists finds shows through setlist.fm and uses its setlists for every band except Phish and Goose, whose setlists come from phish.net and elgoose.net. Show pages link back to setlist.fm.',
  },
  { q: 'Is MySetlists affiliated with setlist.fm?', a: "No. It's an independent project." },
];

export default function SetlistFmComparison() {
  return (
    <ComparePage path={PATH} title="MySetlists vs setlist.fm" faq={FAQ}>
      <p>
        <ExternalLink href="https://www.setlist.fm/">setlist.fm</ExternalLink> is the largest setlist archive on the
        internet, with millions of setlists added by fans since 2002. It&apos;s a reference. MySetlists is a personal show
        tracker for jam band fans: it uses setlists to tell you what <em>you</em> heard, and connects you with the friends
        you heard it with.
      </p>

      <Section title="At a glance">
        <CompareTable
          columns={['MySetlists', 'setlist.fm']}
          rows={[
            ['Main purpose', 'Your personal show history', 'Public archive of what was played'],
            ['Mark shows you attended', 'Yes', 'Yes (“I was there”)'],
            ["Stats on songs you've heard", 'Yes, with personal gaps', 'Yes (concert, song, and attendance stats)'],
            ['Rate songs and jams', 'Yes', 'No'],
            ['Jam-band data', 'Segues, gaps and jam charts from phish.net and elgoose.net, for Phish and Goose', 'General setlist data'],
            ['Tag friends at a show', 'Yes', 'No'],
            ['Add a show from a ticket photo', 'Yes', 'No'],
            ['Edit or contribute setlists', "You can edit the setlist on your own show; it doesn't change a public archive", "Yes, it's a fan-edited wiki"],
            ['Price', 'Free', 'Free'],
          ]}
        />
      </Section>

      <Section title="Where setlist.fm is stronger">
        <Bullets
          items={[
            ['Coverage.', 'Almost every artist and venue, worldwide.'],
            ['Contributing.', 'Anyone can add or correct a setlist.'],
            ['Reference.', 'The best place to look up what any band played on any night.'],
          ]}
        />
      </Section>

      <Section title="Where MySetlists is stronger">
        <Bullets
          items={[
            ["It's about your shows.", 'Your history, your song counts, your gaps.'],
            ['Built for jam bands.', 'For Phish and Goose, setlists come from phish.net and elgoose.net, so you get the segues and jam charts those communities track.'],
            ['Social.', "Tag friends, see the shows you've been to together, and share photos and comments with everyone who was there."],
            ['Ratings.', 'Rate individual songs and jams, not just whole shows.'],
          ]}
        />
      </Section>

      <Section title="Which should you use?">
        <p>
          They work together. setlist.fm is where setlists live; MySetlists is where your shows live. MySetlists finds
          shows through setlist.fm and uses its setlists for every band except Phish and Goose.
        </p>
      </Section>
    </ComparePage>
  );
}
