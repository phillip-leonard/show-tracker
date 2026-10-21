// components/compare/ComparePage.jsx
//
// Layout for the comparison pages (lib/comparePages.js): header, the page's
// own content, a CTA, the FAQ (also emitted as FAQPage JSON-LD), links to
// the other comparison pages, and the site footer.
//
// No 'use client' and no hooks: these pages are server components, so the
// whole article is in the exported HTML, not filled in after hydration.

import Link from 'next/link';
import Footer from '@/components/Footer';
import { COMPARE_PAGES, SIGNUP_HREF, APP_STORE_URL } from '@/lib/comparePages';

export const LAST_UPDATED = 'October 2026';

// Page metadata. `absolute` so the root layout's "%s — MySetlists" template
// isn't added to titles that already name MySetlists. openGraph is set in
// full because a page's openGraph replaces the layout's, image included.
export function compareMetadata({ path, title, description }) {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      siteName: 'MySetlists',
      url: path,
      title,
      description,
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og-image.png'] },
  };
}

export function ExternalLink({ href, children }) {
  return <a href={href} className="text-brand hover:underline">{children}</a>;
}

function faqJsonLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function CompareTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-subtle">
            <th className="text-left font-semibold text-muted py-3 pr-4 w-1/3" scope="col"><span className="sr-only">Feature</span></th>
            {columns.map((c) => (
              <th key={c} className="text-left font-semibold text-primary py-3 pr-4" scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([feature, ...cells]) => (
            <tr key={feature} className="border-b border-subtle align-top">
              <th className="text-left font-medium text-secondary py-3 pr-4" scope="row">{feature}</th>
              {cells.map((cell, i) => (
                <td key={i} className="py-3 pr-4 text-secondary">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl sm:text-2xl font-bold text-primary mb-4">{title}</h2>
      {children}
    </section>
  );
}

export function Bullets({ items }) {
  return (
    <ul className="space-y-3 list-disc pl-5 marker:text-brand">
      {items.map(([lead, rest]) => (
        <li key={lead}><strong className="text-primary">{lead}</strong> {rest}</li>
      ))}
    </ul>
  );
}

function Cta() {
  return (
    <div className="mt-10 rounded-2xl border border-brand/30 bg-brand-subtle p-6 text-center">
      <p className="text-primary font-semibold mb-4">Free on the web and iPhone.</p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={SIGNUP_HREF}
          className="inline-flex items-center justify-center min-h-touch px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-brand to-amber text-[#1f1f3a] shadow-lg shadow-brand/20 hover:opacity-90 transition-opacity"
        >
          Start tracking your shows
        </Link>
        {APP_STORE_URL && (
          <a
            href={APP_STORE_URL}
            className="inline-flex items-center justify-center min-h-touch px-6 py-3 rounded-xl font-semibold border border-subtle text-primary hover:bg-hover transition-colors"
          >
            Get the iPhone app
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * @param {{ path: string, title: string, faq: { q: string, a: string }[], children: React.ReactNode }} props
 *   `path` is this page's entry in COMPARE_PAGES, left out of the related links.
 */
export default function ComparePage({ path, title, faq, children }) {
  const related = COMPARE_PAGES.filter((p) => p.path !== path);
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-base via-surface to-base text-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(faq)) }}
      />

      <header className="bg-black/20 backdrop-blur-xl border-b border-subtle pt-safe-top">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-2xl font-extrabold tracking-tight hover:opacity-80 transition-opacity">
            <span className="font-light text-muted">my</span><span className="text-amber">setlists</span>
          </Link>
          <Link
            href={SIGNUP_HREF}
            className="inline-flex items-center min-h-touch px-4 py-2 rounded-xl text-sm font-semibold bg-brand text-[#1f1f3a] hover:opacity-90 transition-opacity"
          >
            Start tracking
          </Link>
        </div>
      </header>

      <main className="max-w-3xl w-full mx-auto px-4 py-10 sm:py-14 text-secondary leading-relaxed">
        <article>
          <h1 className="text-3xl sm:text-4xl font-bold text-primary tracking-tight">{title}</h1>
          <p className="text-muted text-sm mt-3 mb-8">Last updated: {LAST_UPDATED}</p>

          {children}

          <Cta />

          <Section title="FAQ">
            <dl className="space-y-6">
              {faq.map(({ q, a }) => (
                <div key={q}>
                  <dt className="font-semibold text-primary">{q}</dt>
                  <dd className="mt-1">{a}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </article>

        <nav aria-label="More comparisons" className="mt-12 pt-8 border-t border-subtle">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">More comparisons</h2>
          <ul className="space-y-2">
            {related.map((p) => (
              <li key={p.path}>
                <Link href={p.path} className="text-brand hover:underline">{p.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <Footer />
    </div>
  );
}
