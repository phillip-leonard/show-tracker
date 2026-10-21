'use client';

// "How many Goose songs have you heard?" on the Stats page: a link into the
// Songs I've heard tool (lib/heardLinks.js) for each band the user has seen
// that the tool covers, with their own shows pre-ticked. The tool is a web
// page, so on iOS it opens in the browser (externalLinkClick).

import { useMemo } from 'react';
import { Sparkles, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui';
import { heardBandsFor, heardHref } from '@/lib/heardLinks';
import { externalLinkClick } from '@/lib/publicProfile';

export default function HeardToolCard({ shows }) {
  const bands = useMemo(() => heardBandsFor(shows).slice(0, 4), [shows]);
  if (!bands.length) return null;

  return (
    <Card variant="elevated" className="mb-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-amber-subtle rounded-xl flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-amber" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-primary">
            How many {bands[0].name} songs have you heard?
          </h3>
          <p className="text-sm text-secondary mt-0.5">
            Every song you&apos;ve heard live, your rarest catches and bust-outs, and a poster to share.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {bands.map((band) => {
              const href = heardHref(band.slug, band.dates);
              return (
                <a
                  key={band.slug}
                  href={href}
                  onClick={(e) => externalLinkClick(e, href)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-hover text-primary text-sm font-semibold hover:bg-brand-subtle transition-colors"
                >
                  {band.name}
                  <span className="text-muted font-medium">· {band.dates.length}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted" />
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
