'use client';

import React from 'react';
import { Music, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/Footer';

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-base via-surface to-base text-primary">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-xl border-b border-subtle">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-11 h-11 bg-gradient-to-br from-brand to-amber rounded-2xl flex items-center justify-center shadow-lg shadow-brand/20">
                <Music className="w-6 h-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">MySetlists</h1>
            </Link>
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-3xl p-8 sm:p-12">
          <h1 className="text-3xl font-bold mb-2">Cookie Policy</h1>
          <p className="text-secondary mb-8">Last Updated: February 7, 2026</p>

          <div className="prose-legal space-y-8 text-secondary leading-relaxed">
            <p>
              MySetlists ("we," "us," or "our") uses cookies and similar technologies on mysetlists.net (the "Service"). This Cookie Policy explains what cookies are, how we use them, and your choices regarding their use.
            </p>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">What Are Cookies?</h2>
              <p>Cookies are small text files stored on your device when you visit a website. They are widely used to make websites work efficiently and to provide information to website operators.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Cookies We Use</h2>

              <h3 className="text-lg font-medium text-primary mb-4">Strictly Necessary Cookies</h3>
              <p className="mb-4">These cookies are essential for the Service to function and cannot be disabled. They include:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-subtle rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-hover">
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Cookie</th>
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Purpose</th>
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-subtle">
                      <td className="px-4 py-3">Firebase Auth tokens</td>
                      <td className="px-4 py-3">Maintain your logged-in session and authenticate your identity</td>
                      <td className="px-4 py-3">Session / Persistent</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3">Session cookies</td>
                      <td className="px-4 py-3">Remember your preferences and keep you signed in</td>
                      <td className="px-4 py-3">Session</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-lg font-medium text-primary mt-8 mb-4">Functional Cookies</h3>
              <p className="mb-4">These cookies enable enhanced functionality and personalization:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-subtle rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-hover">
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Cookie</th>
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Purpose</th>
                      <th className="text-left px-4 py-3 font-semibold text-primary border-b border-subtle">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-4 py-3">User preferences</td>
                      <td className="px-4 py-3">Remember your display and notification settings</td>
                      <td className="px-4 py-3">Persistent</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Third-Party Cookies</h2>
              <p>Firebase (operated by Google) may set cookies or use local storage as part of the authentication and hosting services. For more information, see <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Google's Privacy Policy</a> and <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Google's Cookie Policy</a>.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Your Choices</h2>
              <p className="mb-3">Most web browsers allow you to control cookies through their settings. You can typically:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">View cookies</strong> stored on your device</li>
                <li><strong className="text-primary">Delete cookies</strong> individually or in bulk</li>
                <li><strong className="text-primary">Block cookies</strong> from specific or all websites</li>
                <li><strong className="text-primary">Set preferences</strong> for first-party vs. third-party cookies</li>
              </ul>
              <p className="mt-3">Please note that disabling strictly necessary cookies may prevent you from using certain features of the Service, including signing in to your account.</p>

              <h3 className="text-lg font-medium text-primary mt-6 mb-3">Browser-Specific Instructions</h3>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Chrome</a></li>
                <li><a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Firefox</a></li>
                <li><a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Safari</a></li>
                <li><a href="https://support.microsoft.com/en-us/microsoft-edge/manage-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Edge</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Do Not Track</h2>
              <p>We honor Do Not Track (DNT) browser signals. When a DNT signal is detected, we do not engage in any additional tracking beyond what is strictly necessary for the Service to function.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Changes to This Policy</h2>
              <p>We may update this Cookie Policy from time to time. We will notify you of material changes by updating the "Last Updated" date on this page.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Contact Us</h2>
              <p>If you have questions about this Cookie Policy, please contact us at:</p>
              <p className="mt-2"><strong className="text-primary">Email:</strong> <a href="mailto:support@mysetlists.net" className="text-brand hover:text-brand underline">support@mysetlists.net</a></p>
            </section>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
