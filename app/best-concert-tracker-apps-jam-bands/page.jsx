import ComparePage, { Section, ExternalLink, compareMetadata } from '@/components/compare/ComparePage';

const PATH = '/best-concert-tracker-apps-jam-bands/';

export const metadata = compareMetadata({
  path: PATH,
  title: 'Best Concert Tracker Apps for Jam Band Fans (2026)',
  description: 'The best ways to track Phish, Goose, Billy Strings, and Widespread Panic shows in 2026, from band-specific archives to all-in-one concert trackers.',
});

const FAQ = [
  {
    q: "What's the best app to track Phish shows?",
    a: 'Phish.net has the deepest Phish data. MySetlists is a good choice if you also follow other jam bands and want them all in one place; its Phish setlists come from phish.net.',
  },
  {
    q: 'Is there a concert tracker for Goose?',
    a: 'Yes. elgoose.net is the fan archive, and MySetlists uses elgoose.net data for Goose shows.',
  },
  {
    q: 'Are these apps free?',
    a: 'All of them are free to use. Concert Archives also offers a paid Pro tier.',
  },
];

// [name, tagline, link, description, best for]
const PICKS = [
  [
    'MySetlists',
    'best all-in-one tracker for jam fans',
    null,
    'Log every show, rate songs and jams, see your personal gaps, and tag the friends you went with. Uses phish.net and elgoose.net for Phish and Goose setlists, and setlist.fm for every other band. Free on web and iPhone.',
    'fans who follow several jam bands and want one place for all of it.',
  ],
  [
    'Phish.net',
    'best for Phish',
    'https://phish.net/',
    'The definitive Phish encyclopedia, run by volunteers under the non-profit Mockingbird Foundation. Jam charts, show ratings, song histories, and personal stats for shows you’ve attended.',
    'Phish fans who want the deepest Phish data anywhere.',
  ],
  [
    'elgoose.net',
    'best for Goose',
    'https://elgoose.net/',
    'The fan-run Goose archive: setlists, jam charts, debut and tease charts, and attendance stats.',
    'Goose fans.',
  ],
  [
    'BillyBase',
    'best for Billy Strings',
    null,
    'A free, fan-powered Billy Strings archive with teases, guests, gaps, and personal show stats.',
    'Billy Strings fans.',
  ],
  [
    'Everyday Companion',
    'best for Widespread Panic',
    'https://www.everydaycompanion.com/',
    'The long-running Widespread Panic archive, with setlists back to the 1980s, teases, guests, and song stats.',
    'Panic fans who want the full history.',
  ],
  [
    'setlist.fm',
    'best setlist reference for every band',
    'https://www.setlist.fm/',
    'The largest setlist archive on the web, edited by fans. Mark shows you attended and see basic song stats.',
    'looking up any band’s setlist, and contributing to the archive.',
  ],
  [
    'Concert Archives',
    'best general concert diary',
    'https://www.concertarchives.org/',
    'A long-running concert diary and social network with photos, videos, bucket lists, and anniversary emails.',
    'fans who go to shows across every genre.',
  ],
  [
    'What I’ve Heard',
    'best one-off “songs I’ve heard” poster',
    'https://whativeheard.com/',
    'Pick a band, tick the shows you were at, and get a printable poster of every song you’ve heard live. No account needed.',
    'a fun one-time record or gift.',
  ],
];

export default function BestConcertTrackerApps() {
  return (
    <ComparePage path={PATH} title="The best concert tracker apps for jam band fans (2026)" faq={FAQ}>
      <p className="italic text-muted">
        Disclosure: MySetlists makes this list and this page. We&apos;ve tried to be fair to everyone here, including the
        sites we&apos;d send you to instead.
      </p>
      <p className="mt-4">
        Jam band fans track shows differently. You don&apos;t just want to remember you were there; you want to know which
        songs you&apos;ve caught, how long since you heard one, and whether you saw the bust-out. Here are the best tools
        for that in 2026.
      </p>

      <ol className="mt-6">
        {PICKS.map(([name, tagline, href, description, bestFor], i) => (
          <li key={name} className="mt-10">
            <h2 className="text-xl sm:text-2xl font-bold text-primary mb-3">
              {i + 1}. {href ? <ExternalLink href={href}>{name}</ExternalLink> : name}: {tagline}
            </h2>
            <p>{description}</p>
            <p className="mt-2"><strong className="text-primary">Best for:</strong> {bestFor}</p>
          </li>
        ))}
      </ol>

      <Section title="How to choose">
        <ul className="space-y-3 list-disc pl-5 marker:text-brand">
          <li><strong className="text-primary">One band, maximum depth:</strong> use that band&apos;s archive (Phish.net, elgoose.net, BillyBase, Everyday Companion).</li>
          <li><strong className="text-primary">Several bands, one place, with friends:</strong> MySetlists.</li>
          <li><strong className="text-primary">Every genre plus photos:</strong> Concert Archives.</li>
          <li><strong className="text-primary">Just looking up setlists:</strong> setlist.fm.</li>
        </ul>
      </Section>
    </ComparePage>
  );
}
