# mysetlists.net Development Guide

## Routing: read before touching navigation

This app is a Next.js static export (`output: 'export'`, `trailingSlash: true` in next.config.js). Only pre-rendered routes exist as files in the build output. A dynamic route with runtime ids — `/shows/[id]`, `/festivals/[id]` — cannot be served:

- On the web, Netlify's catch-all rule (`/* → /index.html`) returns the root page's HTML for any missing route, making the URL work but the page render wrong
- On iOS, there is no Netlify at all. Capacitor serves bundled files directly; the catch-all doesn't exist, and the behavior is whatever the local server does with a missing path

**Detail views use a query parameter on a real route**, not a dynamic route:
- `/shows/?show=<id>` renders `ShowDetailView` on the `/shows` page, the same URL pattern songs, runs, and tours use
- The URL is a real pre-rendered route (`out/shows/index.html` exists)
- Back controls work because `lib/navRoutes.js` declares `detailParam: 'show'` for `/shows`, telling the mobile header this is a detail view inside a list
- Deep links (pasted URLs, shared links, Resend emails) redirect via `netlify.toml`: `/shows/<id>` and `/shows/<id>/` → `/shows/?show=<id>` (status 301)

**Verify any navigation change** against the contents of `out/` after `npm run build`, not against the source alone. The presence of a `.jsx` file says nothing about whether the route can be served.

In-app navigation goes through `showHref(id)` helper in `lib/showRouting.js` — use it everywhere so there is one place this can ever be wrong again.

This pattern has now cost three attempts to get right. The next session should not have to rediscover it.

## Netlify Blobs and background functions

The public band pages (`/artist/...`) read a snapshot from Netlify Blobs, written by `public-artist-snapshot-background.mjs`. Two things that cost three deploy-preview rounds to find:

- **A function that uses Blobs from a background function must be a v2 function (`export default`) that imports `@netlify/blobs` at the top level.** A `require('@netlify/blobs')` inside a function body is left out of the v2 bundle ("Cannot find module '@netlify/blobs'"). The Lambda-style page functions use `openBlobStore(event)` in `lib/publicArtistSnapshot.js`, which calls `connectLambda(event)`.
- **`netlify logs` without `--follow` shows only the first line of each invocation**, an empty `INFO`, so a failing background function looks like it ran and printed nothing. Stream with `netlify logs --deploy-id <id> --function <name> --follow` while you trigger it.

Deploy previews always carry `X-Robots-Tag: noindex` (Netlify adds it). Lighthouse's `is-crawlable` and the Rich Results Test's "Indexing allowed?" fail there for that reason alone.

## Versioning: every PR bumps the App Store version

**Every PR opened for MySetlists bumps the App Store version**, in addition to the web version in `package.json` (and its `CHANGELOG.md` entry).

- Change `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`. It appears twice (Debug and Release); change both. `Info.plist` reads `CFBundleShortVersionString` from it, so nothing else needs editing.
- Default to a patch bump (3.6 → 3.6.1 → 3.6.2). Use a minor bump (3.6.x → 3.7) only when the user asks for one.
- Bump from the value on the latest `main`, not from your branch's starting point. If another open PR already took the next number, take the one after it and say so in the PR description.
- Leave `CURRENT_PROJECT_VERSION` (the build number) alone. Xcode Cloud sets it.
- Name the new version in the PR description, and in the `CHANGELOG.md` entry ("Ships in iOS 3.6.1").
