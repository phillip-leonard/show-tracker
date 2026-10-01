'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import Pick from './brand/Pick';
import { BRAND_LOCKUP } from './brand/Wordmark';
import { Button, Card, Badge } from './ui';
import { PLAYLIST_CREATION_ENABLED } from '@/lib/constants';
import { isNativePlatform } from '@/lib/native-auth';
import './LandingPage.css';
import packageJson from '../package.json';

function PickSimple({ size = 20 }) {
  return (
    <svg width={size} height={Math.round(size * 1.2)} viewBox="0 0 160 190">
      <path d="M 95 15 C 130 15, 158 36, 158 65 C 158 94, 138 122, 95 175 C 52 122, 32 94, 32 65 C 32 36, 60 15, 95 15 Z" fill="#4bc86a" />
    </svg>
  );
}

export default function LandingPage({ onSignUp, onSignIn, onGuest, communityStats }) {
  return (
    <div className="lp-root">

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pick size={BRAND_LOCKUP.landingNav.pick} />
            <div style={{ fontSize: BRAND_LOCKUP.landingNav.wordmark, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--lp-text-primary)' }}>
              <span style={{ fontWeight: 300, color: 'var(--lp-text-muted)' }}>my</span>
              <span style={{ color: 'var(--lp-amber)' }}>setlists</span>
            </div>
          </div>
          <div className="lp-nav-links">
            <Link href="/shows">Browse</Link>
            <Link href="/stats/top-artists">Artists</Link>
            <Link href="/stats/top-venues">Venues</Link>
            <Link href="/stats">Stats</Link>
          </div>
          <div className="lp-nav-right">
            <Button variant="ghost" size="sm" onClick={onSignIn}>Log in</Button>
            <Button variant="primary" size="sm" onClick={onSignUp}>Start tracking</Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div>
          <div className="lp-hero-eyebrow">
            <span className="lp-dot" />
            3.2M shows indexed · updated daily
          </div>
          <h1>
            Every show you&apos;ve seen,<br />
            in <span className="lp-accent">one place</span>.
          </h1>
          <p className="lp-hero-sub">
            The setlist archive for live music lovers. Track the shows you&apos;ve been to, discover
            the ones you missed, and keep a running log of the best nights of your life.
          </p>
          <div className="lp-hero-cta">
            <Button variant="primary" size="lg" onClick={onSignUp}>
              Start your show log →
            </Button>
            <Button variant="secondary" size="lg" icon={Play} onClick={onGuest}>
              Try it first
            </Button>
          </div>
          <div className="lp-hero-trust">
            <div className="lp-avatar-stack">
              <div className="lp-a lp-a1" />
              <div className="lp-a lp-a2" />
              <div className="lp-a lp-a3" />
              <div className="lp-a lp-a4" />
            </div>
            <div>
              <b>
                {communityStats
                  ? `${(communityStats.totalUsers || 24000).toLocaleString()}+`
                  : '24,000+'} fans
              </b>{' '}
              tracking their shows
            </div>
          </div>
        </div>

        <div className="lp-hero-visual">
          <div className="lp-show-card-big">
            <div className="lp-card-cover">
              <div>
                <div className="lp-cover-date">Halloween · Oct 31, 1994</div>
                <div className="lp-cover-artist">Phish</div>
              </div>
            </div>
            <div className="lp-card-body">
              <div className="lp-card-venue">
                <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24" style={{ color: 'var(--lp-text-muted)' }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Glens Falls Civic Center · Glens Falls, NY
              </div>
              <div className="lp-card-rating">
                <span className="lp-stars">★★★★★</span>
                <span className="lp-score">4.8</span>
                <span className="lp-score-sub">· 3,421 reviews</span>
              </div>
              <div className="lp-card-setlist-head">Set II — Sgt. Pepper&apos;s, front to back</div>
              <div className="lp-card-setlist">
                <div><span className="lp-num">01</span>I Saw Her Standing There</div>
                <div><span className="lp-num">04</span>Getting Better</div>
                <div><span className="lp-num">02</span>With a Little Help</div>
                <div><span className="lp-num">05</span>Fixing a Hole</div>
                <div><span className="lp-num">03</span>Lucy in the Sky</div>
                <div><span className="lp-num">06</span>She&apos;s Leaving Home</div>
              </div>
            </div>
          </div>
          <div className="lp-stats-float">
            <div className="lp-n">87</div>
            <div className="lp-l">Shows this year</div>
          </div>
          <div className="lp-ticket-float">
            <div className="lp-ticket-icon">
              <svg className="lp-ico" viewBox="0 0 24 24">
                <path d="M3 7v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
                <line x1="13" y1="5" x2="13" y2="7" />
                <line x1="13" y1="11" x2="13" y2="13" />
                <line x1="13" y1="17" x2="13" y2="19" />
              </svg>
            </div>
            <div className="lp-ticket-info">
              <Badge tone="green" size="sm" dot>Checked in</Badge>
              <div className="lp-t1">Billy Strings · Red Rocks</div>
              <div className="lp-t2">Sep 14, 2024</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Data sources bar ── */}
      <div className="lp-logos">
        <div className="lp-logos-inner">
          <div className="lp-logos-label">Setlist data from</div>
          <div className="lp-logos-row">
            <span>setlist.fm</span>
            {PLAYLIST_CREATION_ENABLED && (
              <>
                <span>Spotify</span>
                <span>Apple Music</span>
              </>
            )}
            <span>phish.net</span>
            <span>Bandsintown</span>
            <span>relisten.net</span>
          </div>
        </div>
      </div>

      {/* ── Features ── */}
      <section className="lp-features">
        <div className="lp-section-head">
          <div className="lp-section-kicker">Features</div>
          <h2>Built for the fan who calls the opener.</h2>
          <p>Not just a list. A searchable, sortable, sharable record of every live moment — with the setlists, venues, tour stops, and memories that make each show its own.</p>
        </div>
        <div className="lp-feature-grid">
          <Card padding="none" interactive className="lp-feature">
            <div className="lp-feature-icon">
              <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              </svg>
            </div>
            <h3>Auto-import your shows</h3>
            <p>Scan a ticket, upload a photo of past ticket purchases, or search for a show</p>
          </Card>
          <Card padding="none" interactive className="lp-feature lp-amber">
            <div className="lp-feature-icon">
              <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                <polygon points="12 2 15 9 22 9 17 14 19 22 12 17 5 22 7 14 2 9 9 9 12 2" fill="currentColor" opacity="0.15" stroke="none" />
                <polygon points="12 2 15 9 22 9 17 14 19 22 12 17 5 22 7 14 2 9 9 9 12 2" />
              </svg>
            </div>
            <h3>Rate &amp; remember</h3>
            <p>Five-star ratings, private notes, photos from your camera roll. Your show history reads like a music journal — because it is one.</p>
          </Card>
          <Card padding="none" interactive className="lp-feature lp-navy">
            <div className="lp-feature-icon">
              <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                <path d="M3 3v18h18M7 14l3-3 4 4 5-6" />
              </svg>
            </div>
            <h3>Stats that actually matter</h3>
            <p>
              How many &quot;Tweezer&quot;s have you heard? Top venues, songs seen live, minutes on the lawn.
              {PLAYLIST_CREATION_ENABLED
                ? ' Year-end wraps that beat Spotify’s.'
                : ' Year-end wraps worth sharing.'}
            </p>
          </Card>
          <Card padding="none" interactive className="lp-feature">
            <div className="lp-feature-icon">
              <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <h3>Follow friends &amp; bands</h3>
            <p>See who else was at the 10/31 show. Compare tour runs. Get notified when your favorites announce new dates in your city.</p>
          </Card>
          {PLAYLIST_CREATION_ENABLED && (
            <Card padding="none" interactive className="lp-feature lp-amber">
              <div className="lp-feature-icon">
                <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <h3>One-click Spotify playlists</h3>
              <p>Export any setlist to Spotify or Apple Music. Re-live the show on your drive home — in the order it happened.</p>
            </Card>
          )}
          <Card padding="none" interactive className="lp-feature lp-navy">
            <div className="lp-feature-icon">
              <svg className="lp-ico lp-ico-lg" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <h3>Wishlist the ones you missed</h3>
            <p>Build a &quot;should have been there&quot; list. When archival recordings surface, we let you know — so you can finally hear that legendary show.</p>
          </Card>
        </div>
      </section>

      {/* ── Showcase (app mock) ── */}
      <section className="lp-showcase">
        <div className="lp-showcase-inner">
          <div className="lp-showcase-grid">
            <div>
              <div className="lp-kicker">The web app</div>
              <h2>Your library, sortable, searchable, alive.</h2>
              <p>Every show you&apos;ve logged, one keystroke away. Filter by artist, tour, year, venue. Jump to any setlist in two clicks.</p>
              <ul className="lp-showcase-list">
                <li><span className="lp-check">✓</span><span>Smart filters — &quot;Phish shows in the Northeast before 2000&quot; just works</span></li>
                <li><span className="lp-check">✓</span><span>Virtualized list handles 1,000+ shows without breaking a sweat</span></li>
                <li><span className="lp-check">✓</span><span>Offline-ready PWA — your show diary works on a festival field</span></li>
                <li><span className="lp-check">✓</span><span>Native iOS app with ticket scanning &amp; push for announces</span></li>
              </ul>
            </div>
            <div className="lp-app-mock">
              <div className="lp-app-chrome">
                <span className="lp-d lp-r" /><span className="lp-d lp-y" /><span className="lp-d lp-g" />
                <span className="lp-url">mysetlists.net/library</span>
              </div>
              <div className="lp-app-body">
                <div className="lp-app-sb">
                  <div className="lp-app-sb-logo">
                    <PickSimple size={20} />
                    <div className="lp-wm"><span className="lp-my">my</span><span className="lp-set">setlists</span></div>
                  </div>
                  <div className="lp-app-sb-item lp-active">
                    <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></svg>
                    My Shows <span className="lp-ct">87</span>
                  </div>
                  <div className="lp-app-sb-item">
                    <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
                    Wishlist <span className="lp-ct">12</span>
                  </div>
                  <div className="lp-app-sb-item">
                    <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
                    Stats
                  </div>
                  <div className="lp-app-sb-item">
                    <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    Profile
                  </div>
                </div>
                <div className="lp-app-main">
                  <div className="lp-app-mainbar">
                    <div className="lp-app-search">
                      <svg className="lp-ico lp-ico-sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      Search your 87 shows…
                    </div>
                  </div>
                  <h3>My shows</h3>
                  <div className="lp-app-shows">
                    {[
                      { date: 'Oct 31 · 1994', artist: 'Phish', venue: 'Glens Falls Civic Center', tags: [['amber', '★ 4.8'], ['green', 'Beatles']] },
                      { date: 'Sep 14 · 2024', artist: 'Billy Strings', venue: "Dick's Sporting Goods Park", tags: [['amber', '★ 4.9'], ['green', '3N Run']] },
                      { date: 'Nov 01 · 2023', artist: 'Goose', venue: 'Radio City Music Hall', tags: [['amber', '★ 4.7']] },
                      { date: 'Mar 02 · 2025', artist: 'Trey Anastasio Band', venue: 'Beacon Theatre · NYC', tags: [['amber', '★ 4.5']] },
                    ].map((show) => (
                      <div key={show.artist + show.date} className="lp-app-show">
                        <div className="lp-s-date">{show.date}</div>
                        <div className="lp-s-artist">{show.artist}</div>
                        <div className="lp-s-venue">{show.venue}</div>
                        <div className="lp-s-tags">
                          {show.tags.map(([color, label]) => (
                            <Badge key={label} tone={color} size="sm" uppercase={false}>{label}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <div className="lp-stats-section">
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <div className="lp-n">
              {communityStats
                ? (communityStats.totalShows || 0).toLocaleString()
                : <><span>3.2</span><span className="lp-u">M</span></>}
            </div>
            <div className="lp-l">Shows indexed</div>
          </div>
          <div className="lp-stat">
            <div className="lp-n">
              {communityStats
                ? (communityStats.totalUsers || 0).toLocaleString()
                : <><span>24</span><span className="lp-u">K</span></>}
            </div>
            <div className="lp-l">Active trackers</div>
          </div>
          <div className="lp-stat">
            <div className="lp-n">180<span className="lp-u">K</span></div>
            <div className="lp-l">Artists covered</div>
          </div>
          <div className="lp-stat">
            <div className="lp-n">42<span className="lp-u">K</span></div>
            <div className="lp-l">Venues worldwide</div>
          </div>
        </div>
      </div>

      {/* ── How it works ── */}
      <section className="lp-how">
        <div className="lp-section-head">
          <div className="lp-section-kicker">How it works</div>
          <h2>Three steps to your complete show history.</h2>
        </div>
        <div className="lp-how-grid">
          <Card padding="none" className="lp-step">
            <div className="lp-step-visual">
              <div style={{ fontFamily: 'source-code-pro, monospace', fontSize: 12, color: 'var(--lp-text-muted)', marginBottom: 10 }}>PASTE LINK</div>
              <div style={{ background: 'var(--lp-bg-surface)', borderRadius: 8, padding: '10px 14px', fontFamily: 'source-code-pro, monospace', fontSize: 11, color: 'var(--lp-text-secondary)', border: '1px solid var(--lp-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--lp-green-primary)' }}>●</span>setlist.fm/setlist/phish/1994/…
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--lp-text-muted)' }}>→ auto-fills date, venue, 23 songs</div>
            </div>
            <div className="lp-step-num">Step 01</div>
            <h3>Import anything</h3>
            <p>Scan a ticket, upload a photo of past ticket purchases, or search for a show</p>
          </Card>
          <Card padding="none" className="lp-step">
            <div className="lp-step-visual">
              <div style={{ fontFamily: 'source-code-pro, monospace', fontSize: 12, color: 'var(--lp-text-muted)', marginBottom: 10 }}>RATE &amp; NOTE</div>
              <div style={{ fontSize: 22, color: 'var(--lp-amber)', letterSpacing: 2, marginBottom: 8 }}>★★★★★</div>
              <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)', fontStyle: 'italic' }}>&quot;Type II Tweezer &gt; Makisupa. Ghost encore. Life-changing.&quot;</div>
            </div>
            <div className="lp-step-num">Step 02</div>
            <h3>Remember the night</h3>
            <p>Star ratings, notes, photos. Tag the highlights so you can find them years later.</p>
          </Card>
          <Card padding="none" className="lp-step">
            <div className="lp-step-visual">
              <div style={{ fontFamily: 'source-code-pro, monospace', fontSize: 12, color: 'var(--lp-text-muted)', marginBottom: 12 }}>YEAR IN REVIEW</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--lp-green-primary)', letterSpacing: '-0.03em' }}>27</div>
                <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }}>shows · 12 artists · 9 venues</div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                <div style={{ height: 20, background: 'var(--lp-green-primary)', flex: 3, borderRadius: 2 }} />
                <div style={{ height: 20, background: 'var(--lp-green-light)', flex: 2, borderRadius: 2 }} />
                <div style={{ height: 20, background: 'var(--lp-amber)', flex: 2, borderRadius: 2 }} />
                <div style={{ height: 20, background: 'var(--lp-amber-light)', flex: 1, borderRadius: 2 }} />
              </div>
            </div>
            <div className="lp-step-num">Step 03</div>
            <h3>See the patterns</h3>
            <p>Stats, streaks, and year-end wraps that reveal what you actually love seeing live.</p>
          </Card>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-section">
        <div className="lp-cta-card">
          <h2>Your show log is one click away.</h2>
          <p>Free forever. No ads. Built by fans who&apos;ve lost too many stub ticket memories already.</p>
          <Button variant="secondary" size="lg" onClick={onSignUp}>Claim your profile →</Button>
          <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 0 }}>
            By signing up you agree to our{' '}
            <Link href="/terms" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-wordmark">
              <svg width="22" height="26" viewBox="0 0 160 190">
                <path d="M 95 15 C 130 15, 158 36, 158 65 C 158 94, 138 122, 95 175 C 52 122, 32 94, 32 65 C 32 36, 60 15, 95 15 Z" fill="#4bc86a" />
              </svg>
              <span><span className="lp-fmy">my</span><span className="lp-fset">setlists</span></span>
            </div>
            <p>Your show history, beautifully kept. Track the live music moments that make up a life.</p>
          </div>
          <div className="lp-footer-col">
            <h4>Resources</h4>
            <Link href="/how-to-use">How to use</Link>
            {/* Website-only — see the note in components/layout/Sidebar.jsx. */}
            {!isNativePlatform() && (
              <a href="https://buymeacoffee.com/phillipd" target="_blank" rel="noopener noreferrer">Support this project</a>
            )}
            <Link href="/community">Community</Link>
          </div>
          <div className="lp-footer-col">
            <h4>Company</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/terms#community-guidelines">Community Guidelines</Link>
            <Link href="/cookies">Cookies</Link>
            {/* Published contact information, on the signed-out landing
                page — App Store Guideline 1.2 wants it findable by
                someone who has not made an account. */}
            <a href="mailto:support@mysetlists.net">support@mysetlists.net</a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© 2026 MySetlists.net · Built by fans, for fans</span>
          <span>v{packageJson.version}</span>
        </div>
      </footer>

    </div>
  );
}
