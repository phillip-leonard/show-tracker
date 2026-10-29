import Link from 'next/link';
import ComparePage, { Section, Bullets, compareMetadata } from '@/components/compare/ComparePage';
import { IMPORT_HREF } from '@/lib/comparePages';

// A guide for people moving their concert history from Concert Archives.
// Concert Archives is named because that's where the reader is coming from;
// MySetlists has no connection to it, never reads its site or API, and the
// page says so. The only data that moves is a file the reader makes.

const PATH = '/switch/concert-archives/';

export const metadata = compareMetadata({
  path: PATH,
  title: 'Switching from Concert Archives to MySetlists: Bring Your Concert History',
  description: 'Move the shows you logged in Concert Archives to MySetlists with a spreadsheet: what carries over, how to import it step by step, and what you get on top, like song ratings and setlists.',
});

const FAQ = [
  {
    q: 'Is MySetlists connected to Concert Archives?',
    a: "No. MySetlists isn't affiliated with Concert Archives and never signs in to it or reads it. The import only reads the spreadsheet you choose.",
  },
  {
    q: 'What file do I need?',
    a: 'A CSV or Excel (.xlsx) file with one show per row and at least an artist and a date column. Column names and order don’t matter: you match them up during the import.',
  },
  {
    q: 'Will importing create duplicate shows?',
    a: 'No. A row with the same artist and date as a show you already have is skipped and listed, and so is a repeat of an earlier row in the same file. You can import the same file again safely.',
  },
  {
    q: 'What happens to festival rows with several bands?',
    a: 'The preview offers to split a row that lists several artists into one show per band, so each gets its own setlist.',
  },
  {
    q: 'What if some rows don’t match?',
    a: 'The preview shows why (an unreadable date, an artist name setlist.fm doesn’t know). After the import you can download those rows as a CSV, fix them and import that file.',
  },
  {
    q: 'Is MySetlists free?',
    a: 'Yes, on the web and iPhone.',
  },
];

export default function SwitchFromConcertArchives() {
  return (
    <ComparePage
      path={PATH}
      title="Switching from Concert Archives"
      faq={FAQ}
      cta={{ label: 'Sign in and import', href: IMPORT_HREF, note: 'Free on the web and iPhone. Sign in, and you land on the import.' }}
    >
      <p>
        If you&apos;ve been logging shows in Concert Archives and want to try MySetlists, you don&apos;t have to start
        over. Put your concerts in a spreadsheet and import it: MySetlists matches each show, adds the setlist where
        one exists, and skips anything you&apos;ve already logged. (MySetlists isn&apos;t affiliated with Concert
        Archives.)
      </p>

      <Section title="What carries over">
        <Bullets
          items={[
            ['Every show:', 'artist, date, venue, city, state and country.'],
            ['Your ratings and notes.', 'Ratings out of 5 or as stars become MySetlists’ 1–10.'],
            ['Festivals and bills.', 'A row listing several bands can become one show per band.'],
            ['Setlists, added for you.', 'From the band’s own archive where there is one (phish.net, elgoose.net), fan recordings on the Internet Archive for bands like the Grateful Dead and Keller Williams, then setlist.fm.'],
          ]}
        />
        <p className="mt-4">
          Photos, videos, friends and comments stay where they are: the import only reads the rows of your file.
        </p>
      </Section>

      <Section title="How to switch, step by step">
        <ol className="space-y-3 list-decimal pl-5 marker:text-brand">
          <li>
            <strong className="text-primary">Get your concerts into a spreadsheet.</strong> If your account offers a
            download or export of your concerts, save it as CSV or Excel. If not, copy your concert list into Google
            Sheets or Excel, one show per row, with columns for at least the artist and the date.
          </li>
          <li>
            <strong className="text-primary">Open the import.</strong> Sign in to MySetlists (or create a free account)
            and go to Scan / Import, then Import File. The button below takes you straight there.
          </li>
          <li>
            <strong className="text-primary">Match your columns.</strong> MySetlists recognises common headings like
            Artist, Band, Date, Venue, City, State, Country, Rating and Notes. Fix any it got wrong from the dropdowns.
          </li>
          <li>
            <strong className="text-primary">Check the preview.</strong> Each row shows the show it matched and whether
            a setlist was found. If dates like 03/04/2019 could be read two ways, say which way your file writes them.
            Split festival rows, and untick anything you don&apos;t want.
          </li>
          <li>
            <strong className="text-primary">Import.</strong> You can stop at any point and keep what&apos;s saved. At
            the end you get a summary, and the rows that didn&apos;t match as a CSV to fix and import again.
          </li>
        </ol>
      </Section>

      <Section title="What MySetlists adds">
        <Bullets
          items={[
            ['Song ratings.', 'Rate the songs and jams you heard, not just the night.'],
            ['Your personal gaps.', 'See how many of your shows by a band it’s been since you last caught a song.'],
            ['Setlists for jam bands.', 'Phish from phish.net, Goose from elgoose.net, and tape setlists from the Internet Archive, each linked to its source.'],
            ['Posters.', 'Turn your history into a poster of every show you’ve been to.'],
          ]}
        />
        <p className="mt-4">
          Want the full comparison first? <Link href="/compare/concert-archives/" className="text-brand hover:underline">MySetlists vs Concert Archives</Link>.
        </p>
      </Section>
    </ComparePage>
  );
}
