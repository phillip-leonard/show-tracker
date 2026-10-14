'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Music, ArrowLeft, Smartphone, ChevronRight } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { storage, STORAGE_KEYS } from '@/lib/storage';

// Bump this version string whenever you add new features to announce.
// Users who have seen this version won't see the modal again.
const CURRENT_WHATS_NEW_VERSION = '3.12';

const FEATURES = [
  {
    icon: Music,
    color: 'text-brand',
    bg: 'bg-brand-subtle',
    title: 'Goose and Phish Setlists, From The Source',
    description: 'Goose setlists now come from elgoose.net and Phish from phish.net \u2014 real segue marks, footnotes, jam-chart notes and official gap counts. Every other artist is unchanged.',
    cta: null,
  },
  {
    icon: ArrowLeft,
    color: 'text-amber',
    bg: 'bg-amber-subtle',
    title: 'A Way Back From Every Screen',
    description: 'Every screen now has a clear way back. Quite a few had none at all \u2014 in the app there is no browser back button to fall back on, so the only way off them was the menu.',
    cta: null,
  },
  {
    icon: Smartphone,
    color: 'text-brand',
    bg: 'bg-brand-subtle',
    title: 'A Better Fit On Your Phone',
    description: 'Nothing hidden behind the notch, the home indicator or the keyboard, and bigger tap targets throughout.',
    cta: null,
  },
];

function WhatsNewModal({ onClose, navigateTo }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in after mount
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setVisible(false);
    storage.set(STORAGE_KEYS.WHATS_NEW_VERSION, CURRENT_WHATS_NEW_VERSION);
    setTimeout(onClose, 200); // wait for animation
  };

  const handleCta = (view) => {
    storage.set(STORAGE_KEYS.WHATS_NEW_VERSION, CURRENT_WHATS_NEW_VERSION);
    onClose();
    if (navigateTo) navigateTo(view);
  };

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-all duration-200 ${visible ? 'bg-sidebar/50 backdrop-blur-sm' : 'bg-black/0'}`}
      onClick={handleClose}
    >
      <Card
        variant="elevated"
        padding="none"
        className={`w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl transition-all duration-200 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-5 pt-6 pb-4 text-center border-b border-subtle bg-gradient-to-b from-amber/10 to-transparent">
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={handleClose}
            className="absolute top-4 right-4"
          />
          <div className="w-12 h-12 rounded-full bg-amber-subtle flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-amber" />
          </div>
          <h2 className="text-lg font-bold text-primary">What&apos;s New</h2>
          <p className="text-xs text-muted mt-1">Recent features added to MySetlists</p>
        </div>

        {/* Feature list */}
        <div className="px-4 py-3 flex-1 overflow-y-auto">
          <div className="space-y-2">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-xl bg-hover/30 hover:bg-hover transition-colors"
                >
                  <div className={`w-9 h-9 rounded-lg ${feature.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Icon className={`w-4.5 h-4.5 ${feature.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-primary">{feature.title}</h3>
                    <p className="text-xs text-secondary mt-0.5 leading-relaxed">{feature.description}</p>
                    {feature.cta && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={ChevronRight}
                        iconPosition="right"
                        onClick={() => handleCta(feature.cta.view)}
                        className="mt-1.5 text-amber hover:text-amber p-0 h-auto"
                      >
                        {feature.cta.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-subtle">
          <Button variant="primary" full onClick={handleClose}>Got it</Button>
          <p className="text-center text-[10px] text-muted mt-2">
            See all updates in Release Notes
          </p>
        </div>
      </Card>
    </div>
  );
}

/**
 * Check whether the What's New modal should be shown.
 * Returns true for returning users who haven't seen this version yet.
 */
export function shouldShowWhatsNew() {
  const seen = storage.get(STORAGE_KEYS.WHATS_NEW_VERSION);
  return seen !== CURRENT_WHATS_NEW_VERSION;
}

export default WhatsNewModal;
