'use client';

import React from 'react';
import { Music, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/Footer';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-dscreen bg-gradient-to-br from-base via-surface to-base text-primary">
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
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-secondary mb-8">Last Updated: February 7, 2026</p>

          <div className="prose-legal space-y-8 text-secondary leading-relaxed">
            <p>
              MySetlists ("we," "us," or "our") operates mysetlists.net (the "Service"). This Privacy Policy explains how we collect, use, disclose, and protect your information when you use our Service.
            </p>
            <p>
              By using the Service, you agree to the collection and use of information in accordance with this policy.
            </p>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Information We Collect</h2>

              <h3 className="text-lg font-medium text-primary mb-3">Information You Provide</h3>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">Account Information:</strong> When you create an account, we collect your email address and password, or authentication credentials through Google sign-in.</li>
                <li><strong className="text-primary">User Content:</strong> Setlists you create, shows you mark as attended, personal notes, ratings, and any content you choose to share publicly through the Service.</li>
                <li><strong className="text-primary">Communications:</strong> If you contact us directly, we may receive additional information about you, such as your name and the contents of your message.</li>
              </ul>

              <h3 className="text-lg font-medium text-primary mt-6 mb-3">Information Collected Automatically</h3>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">Usage Data:</strong> We may collect information about how you access and use the Service, including your browser type, device information, pages visited, and the date and time of your visit.</li>
                <li><strong className="text-primary">Cookies and Similar Technologies:</strong> We use cookies and similar tracking technologies to maintain your session and remember your preferences. Firebase may set cookies or use local storage as part of the authentication process.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">How We Use Your Information</h2>
              <p className="mb-3">We use the information we collect to:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Provide, maintain, and improve the Service</li>
                <li>Create and manage your account</li>
                <li>Enable you to create, save, and share setlists and concert data</li>
                <li>Authenticate your identity when you sign in</li>
                <li>Respond to your inquiries and provide support</li>
                <li>Monitor usage patterns and improve user experience</li>
                <li>Protect against unauthorized access, fraud, and abuse</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Third-Party Services</h2>
              <p className="mb-3">We use the following third-party services to operate the Service:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">Firebase (Google):</strong> We use Firebase for authentication, data storage, and hosting. Firebase may collect certain technical data as described in <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Google's Privacy Policy</a>.</li>
                <li><strong className="text-primary">Setlist.fm API:</strong> We retrieve setlist data from the Setlist.fm API. When you search for or view setlists, queries are made to their service. Please refer to <a href="https://www.setlist.fm/help/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand underline">Setlist.fm's Privacy Policy</a> for information about their data practices.</li>
              </ul>
              <p className="mt-3">We do not sell your personal information to third parties.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Data Sharing</h2>
              <p className="mb-3">We may share your information in the following circumstances:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">Public Content:</strong> Setlists and concert data you choose to share socially will be visible to other users and may be publicly accessible.</li>
                <li><strong className="text-primary">Legal Compliance:</strong> We may disclose your information if required by law, regulation, or legal process, or if we believe disclosure is necessary to protect our rights, your safety, or the safety of others.</li>
                <li><strong className="text-primary">Service Providers:</strong> We may share information with third-party service providers who assist us in operating the Service, subject to confidentiality obligations.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Data Retention</h2>
              <p>We retain your personal information for as long as your account is active or as needed to provide the Service. If you delete your account, we will delete or anonymize your personal information within a reasonable timeframe, except where we are required to retain it for legal or legitimate business purposes.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Data Security</h2>
              <p>We implement reasonable technical and organizational measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Your Rights and Choices</h2>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><strong className="text-primary">Access and Update:</strong> You can access and update your account information at any time by logging into your account.</li>
                <li><strong className="text-primary">Delete Your Account:</strong> You may request deletion of your account and associated data by contacting us at the email address below.</li>
                <li><strong className="text-primary">Opt Out of Communications:</strong> You may opt out of non-essential communications at any time.</li>
              </ul>

              <h3 className="text-lg font-medium text-primary mt-6 mb-3">California Residents (CCPA/CPRA)</h3>
              <p className="mb-3">If you are a California resident, you have the right to:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Know what personal information we collect, use, and disclose</li>
                <li>Request deletion of your personal information</li>
                <li>Opt out of the sale or sharing of your personal information (we do not sell your data)</li>
                <li>Non-discrimination for exercising your privacy rights</li>
              </ul>
              <p className="mt-3">To exercise these rights, contact us at the email address below.</p>

              <h3 className="text-lg font-medium text-primary mt-6 mb-3">European Users (GDPR)</h3>
              <p>If you are located in the European Economic Area, you have additional rights including the right to access, rectify, port, and erase your data, as well as the right to restrict and object to certain processing of your data. To exercise these rights, contact us at the email address below.</p>
              <p className="mt-3">Our legal basis for processing your data includes: your consent, performance of a contract (providing the Service), and our legitimate interests in operating and improving the Service.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Children's Privacy</h2>
              <p>The Service is not directed to anyone under the age of 13. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us and we will take steps to delete such information.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Changes to This Policy</h2>
              <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page and updating the "Last Updated" date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised policy.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">Contact Us</h2>
              <p>If you have questions about this Privacy Policy, please contact us at:</p>
              <p className="mt-2"><strong className="text-primary">Email:</strong> <a href="mailto:support@mysetlists.net" className="text-brand hover:text-brand underline">support@mysetlists.net</a></p>
            </section>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
