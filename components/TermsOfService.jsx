'use client';

import React from 'react';
import { Music, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/Footer';
import { TERMS_VERSION } from '@/lib/terms';

export default function TermsOfService() {
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
          <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
          <p className="text-secondary mb-8">Last Updated: September 17, 2026 &middot; Agreement version {TERMS_VERSION}</p>

          <div className="prose-legal space-y-8 text-secondary leading-relaxed">
            <p>
              Please read these Terms of Service ("Terms") carefully before using mysetlists.net (the "Service") operated by MySetlists ("we," "us," or "our").
            </p>
            <p>
              By accessing or using the Service, you agree to be bound by these Terms. If you do not agree to these Terms, do not use the Service.
            </p>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">1. Eligibility</h2>
              <p>You must be at least 13 years old to use the Service. By using the Service, you represent and warrant that you meet this age requirement.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">2. Accounts</h2>
              <p className="mb-3">When you create an account, you are responsible for maintaining the security of your account credentials and for all activities that occur under your account. You agree to:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Provide accurate and complete information when creating your account</li>
                <li>Keep your login credentials secure and confidential</li>
                <li>Notify us immediately of any unauthorized access to your account</li>
              </ul>
              <p className="mt-3">We reserve the right to suspend or terminate accounts that violate these Terms.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">3. User Content</h2>
              <p className="mb-3">The Service allows you to create setlists, mark shows as attended, add personal notes and ratings, and share content with other users ("User Content").</p>

              <p className="mb-3"><strong className="text-primary">Ownership:</strong> You retain ownership of the User Content you create. By posting or sharing User Content through the Service, you grant us a non-exclusive, royalty-free, worldwide license to use, display, and distribute your User Content solely for the purpose of operating and providing the Service.</p>

              <p className="mb-3"><strong className="text-primary">Responsibility:</strong> You are solely responsible for your User Content. You represent and warrant that:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>You have the right to post your User Content</li>
                <li>Your User Content does not violate any third party's rights, including intellectual property or privacy rights</li>
                <li>Your User Content does not contain unlawful, defamatory, harassing, or otherwise objectionable material</li>
              </ul>
              <p className="mt-3">We reserve the right to remove any User Content that violates these Terms, at our sole discretion.</p>
            </section>

            <section id="community-guidelines">
              <h2 className="text-xl font-semibold text-primary mb-4">4. Community Guidelines</h2>
              <p className="mb-3"><strong className="text-primary">Zero tolerance.</strong> MySetlists is a place to talk about shows you went to. There is no version of that conversation which needs slurs, harassment, sexual content, threats of violence, or content that impersonates someone else or infringes their copyright. Post any of it and it will be removed.</p>

              <p className="mb-3"><strong className="text-primary">We filter before you post.</strong> Comments, captions, meetup messages, display names and handles are checked automatically before they are published. Content that fails the check is rejected outright rather than posted and removed later.</p>

              <p className="mb-3"><strong className="text-primary">You can report anything.</strong> Every comment, photo, video, meetup message and profile carries a report control (the flag icon). Reports are anonymous to the person you report. We commit to reviewing every report <strong className="text-primary">within 24 hours</strong> and removing anything that breaks these guidelines. Content reported by three or more people is hidden automatically while it waits for that review.</p>

              <p className="mb-3"><strong className="text-primary">You can block anyone.</strong> Blocking a user hides their comments, photos, meetup messages, tags and activity from you, and removes you from each other's friends list. You can block someone from the report dialog, from their card in your friends list, or from their profile, and you can undo it at any time under Profile → Blocked accounts.</p>

              <p className="mb-3"><strong className="text-primary">Offending accounts are removed from the Service.</strong> There is no tolerance for abusive users. When we find that an account has posted objectionable content or behaved abusively, we remove that content and we remove the account: it is suspended, signed out of every device, and cannot sign back in. Content posted by a removed account is taken down for everyone. We do this within the same 24-hour window, and we do not require a pattern of offences before acting.</p>

              <p className="mb-3"><strong className="text-primary">You agree to these rules before you use the Service.</strong> Everyone must accept these Terms and these Community Guidelines before registering or signing in, and again whenever we change them materially. Using MySetlists means you have accepted them. If you do not accept them, you cannot use the Service.</p>

              <p>To report something you cannot reach through the app — including content you have seen without being signed in — email <a href="mailto:support@mysetlists.net" className="text-brand hover:text-brand underline">support@mysetlists.net</a>. We answer moderation reports sent there on the same 24-hour commitment.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">5. Acceptable Use</h2>
              <p className="mb-3">You agree not to use the Service to:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Violate any applicable law or regulation</li>
                <li>Infringe on the intellectual property or other rights of any third party</li>
                <li>Upload or transmit malicious code, viruses, or other harmful content</li>
                <li>Attempt to gain unauthorized access to the Service or its systems</li>
                <li>Scrape, crawl, or use automated means to access the Service without our permission</li>
                <li>Interfere with or disrupt the Service or servers connected to the Service</li>
                <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity</li>
                <li>Harass, abuse, or threaten other users</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">6. Third-Party Services and Data</h2>
              <p>The Service integrates with third-party services including Firebase and the Setlist.fm API. Your use of these services is subject to their respective terms and policies. We are not responsible for the availability, accuracy, or content provided by third-party services.</p>
              <p className="mt-3">Setlist data displayed through the Service is sourced from Setlist.fm and is used in accordance with their API terms. We do not guarantee the accuracy or completeness of any setlist data.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">7. Intellectual Property</h2>
              <p>The Service and its original content (excluding User Content) are and shall remain our property. The Service is protected by copyright, trademark, and other applicable laws. Our trademarks and trade dress may not be used without our prior written consent.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">8. Disclaimer of Warranties</h2>
              <p className="uppercase text-sm">THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
              <p className="mt-3 uppercase text-sm">We do not warrant that the Service will be uninterrupted, error-free, or secure, or that any defects will be corrected. We make no warranties regarding the accuracy or reliability of any content obtained through the Service.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">9. Limitation of Liability</h2>
              <p className="uppercase text-sm">TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, USE, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), OR ANY OTHER LEGAL THEORY, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
              <p className="mt-3 uppercase text-sm">OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US, IF ANY, TO USE THE SERVICE DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">10. Indemnification</h2>
              <p>You agree to indemnify, defend, and hold harmless MySetlists and its operators from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or in any way connected with your access to or use of the Service, your User Content, or your violation of these Terms.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">11. DMCA and Copyright</h2>
              <p className="mb-3">We respect the intellectual property rights of others. If you believe that content on the Service infringes your copyright, please send a notice to us at the contact email below with the following information:</p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>A description of the copyrighted work you claim has been infringed</li>
                <li>A description of where the allegedly infringing material is located on the Service</li>
                <li>Your contact information (name, address, email, phone number)</li>
                <li>A statement that you have a good faith belief that the use is not authorized by the copyright owner</li>
                <li>A statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on behalf of the copyright owner</li>
                <li>Your physical or electronic signature</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">12. Termination</h2>
              <p>We may terminate or suspend your account and access to the Service immediately, without prior notice, for any reason, including if you breach these Terms. Upon termination, your right to use the Service will immediately cease.</p>
              <p className="mt-3">All provisions of these Terms which by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">13. Governing Law</h2>
              <p>These Terms shall be governed by and construed in accordance with the laws of the State of California, without regard to its conflict of law provisions. Any legal action or proceeding arising under these Terms shall be brought exclusively in the courts located in San Francisco County, California.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">14. Changes to These Terms</h2>
              <p>We reserve the right to modify these Terms at any time. We will notify you of material changes by posting the updated Terms on this page and updating the "Last Updated" date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">15. Severability</h2>
              <p>If any provision of these Terms is held to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will remain in full force and effect.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">16. Entire Agreement</h2>
              <p>These Terms, together with our <Link href="/privacy" className="text-brand hover:text-brand underline">Privacy Policy</Link>, constitute the entire agreement between you and MySetlists regarding the Service and supersede all prior agreements and understandings.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-primary mb-4">17. Contact Us</h2>
              <p>If you have questions about these Terms, please contact us at:</p>
              <p className="mt-2"><strong className="text-primary">Email:</strong> <a href="mailto:support@mysetlists.net" className="text-brand hover:text-brand underline">support@mysetlists.net</a></p>
            </section>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
