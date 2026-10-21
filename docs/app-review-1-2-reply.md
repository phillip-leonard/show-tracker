# App Review — Guideline 1.2 reply (build 3.1 (TODO: build number))

Rejection: **3.1 (130 in the rejection notice)** on 2026-09-17, resubmit with build 3.1 (**TODO: new build number**),
Guideline 1.2 (Safety: User-Generated Content). Tested on an iPad Air 11-inch (M3).

This document holds three things: the screen-recording shot list, the reply to
App Review, and the text for the App Review Information Notes field.

**Every claim in the reply below was checked against the code on branch
`claude/happy-johnson-6bogsc`.** Anything that could not be verified in a
sandbox without Firebase credentials or a device is marked
**[VERIFY ON DEVICE]** — those must be confirmed during the physical-device
pass before this is sent.

---

## 1. Screen recording — shot list

Record on a **physical iPhone**, portrait, 60–90 seconds. Apple asks for a
device recording; a simulator capture has been rejected for this before.

Do a full delete-and-reinstall first — the terms gate only appears at first
launch or when the stored agreement version is behind, so a device that has
already agreed will not show it.

| # | Shot | What must be on screen | ~time |
|---|---|---|---|
| 1 | Delete the app from the Home Screen, reinstall from TestFlight, launch | The app icon going, then the splash | 0:00–0:10 |
| 2 | Tap **Log in** | The agreement panel appears above the sign-in buttons | 0:10–0:15 |
| 3 | **Hold still for 4 full seconds** on the agreement | "Zero tolerance for objectionable content", "Zero tolerance for abusive users", "We review reports within 24 hours" all legible | 0:15–0:22 |
| 4 | Tap **Sign in with Apple**, then **Sign in with Google**, then **Sign In** — all three while the box is unchecked | Nothing happens. All three are visibly greyed out | 0:22–0:32 |
| 5 | Tap the checkbox | The buttons become active in the same frame | 0:32–0:36 |
| 6 | Sign in as `appreview@mysetlists.net` | The app opens | 0:36–0:44 |
| 7 | Go to **Shows → Phish, Dick's Sporting Goods Park, 29 Aug 2025** | The show page, scrolled to Comments | 0:44–0:52 |
| 8 | Tap the **flag** icon on Jordan Mills' comment | The report sheet, showing the six reasons | 0:52–0:58 |
| 9 | Choose **Harassment or hate**, tap **Send report** | The comment disappears; "we'll review this within 24 hours" | 0:58–1:06 |
| 10 | Scroll to **Photos & Videos**, tap **Jordan Mills** | The profile sheet, with **Block** and **Report** | 1:06–1:12 |
| 11 | Tap **Block**, then **Block** to confirm | Their photo disappears from the gallery behind the sheet — no reload | 1:12–1:20 |
| 12 | Go to **Profile → Blocked accounts** | Jordan Mills listed, with **Unblock** | 1:20–1:30 |

Three things that make or break the recording:

- **Step 4 is the one Apple rejected us over.** Tapping disabled buttons looks
  like nothing happening, which is the point — but it reads as a stalled
  recording unless the greyed-out state is clearly visible. Frame it tightly.
- **Step 11 must not cut.** The value of it is that the content vanishes
  without a reload. If the recording cuts between the confirm and the result,
  it proves nothing.
- Do not speed up or add captions. Apple has asked for unedited recordings.

---

## 2. Reply to App Review

> Thank you for the detailed feedback on build 3.1 (130). We have addressed all
> five points of Guideline 1.2 in build 3.1 (**TODO: new build number**).
>
> **1. Terms (EULA) agreed before registering or signing in**
>
> Every user must now accept our Terms of Use and Community Guidelines before
> any sign-in method will work. The agreement appears above the sign-in options
> with an unchecked checkbox, and Sign in with Apple, Sign in with Google and
> the email form are all disabled until it is ticked. The agreement summary
> states that we have zero tolerance for objectionable content and for abusive
> users, that users can flag content and block users, that we review reports
> within 24 hours, and that we remove offending content and remove the accounts
> that posted it. It links to the full Terms, which repeat each of those points
> in Section 4, "Community Guidelines".
>
> Existing users who have not accepted the current version see the same gate at
> their next launch and cannot use the app until they accept. Acceptance is
> stored against the user's account with the version they agreed to, so a future
> material change re-prompts everyone.
>
> **2. A method for filtering objectionable content**
>
> Every piece of free text a user can publish is checked against a filter before
> it is published: comments, photo and video captions, meetup messages, meetup
> descriptions, display names and public handles. Rejected text is refused with
> an inline explanation and is never written.
>
> The filter runs on our server, in a function that is the only write path for
> that content, and the Firestore security rules refuse a direct client write
> to every one of those fields. The browser runs the same check first so the
> user gets an immediate inline error, but the server is the enforcement and it
> cannot be bypassed by a modified client.
>
> **3. A mechanism for users to flag objectionable content**
>
> Every comment, photo, video, meetup message and user profile carries a flag
> icon, shown directly on the item rather than behind a menu or a long-press.
> Tapping it opens a report sheet with six reasons and an optional note, plus a
> one-tap option to block the author at the same time.
>
> When a report is submitted the item disappears for the reporter immediately
> and they are told it will be reviewed within 24 hours. Content reported by
> three separate users is withdrawn from public view automatically while it
> waits for review. Every report emails our moderation address the moment it is
> filed.
>
> **4. A mechanism for users to block abusive users**
>
> Users can block from any other user's profile, from the report sheet, and
> from a friend's card. Blocking takes one confirmation step that explains what
> it does.
>
> On confirmation, everything the blocked user has posted — comments, photos and
> videos, meetup messages, activity — disappears from every list on screen
> immediately, with no reload and no navigation. Blocking works in both
> directions, ends any friendship between the two accounts, and cancels any
> pending friend request or photo tag between them. Blocked accounts are listed
> under Profile → Blocked accounts and can be unblocked there.
>
> Every block also notifies us: it creates a record in our moderation queue and
> sends us an email, including how many separate users have now blocked that
> account, so a pattern is visible even when nobody has filed a formal report.
>
> **5. Acting on reports within 24 hours, and ejecting offending users**
>
> Reports and block notices arrive in a moderation queue sorted oldest-first,
> each showing how long it has been open against the 24-hour commitment. A
> scheduled job re-sends us the list of anything still open after 12 hours, so
> the deadline cannot be missed silently.
>
> Each item offers three actions: dismiss, remove the content, or remove the
> content and eject the user. Ejecting an account disables it so the user cannot
> sign in again, signs them out of every device they are already signed in on,
> and removes everything that account has ever posted from view for all other
> users. An ejected user who opens the app sees a clear explanation and a
> support address, not a broken screen. Every action is recorded with the
> reviewer and the time.
>
> **Camera and photo permissions**
>
> We have also corrected the camera permission prompt, which could fail to
> appear, and rewritten all three permission descriptions to say specifically
> what is accessed and why.
>
> **Demo account**
>
> Sign in with the account in the App Review Information section. The steps in
> the Notes field lead to a comment and a video posted by a different user, both
> of which can be flagged, and whose author can be blocked.
>
> Thank you again for the thorough review.

---

## 3. App Review Information → Notes

Paste this into the Notes field. Keep it short — it is instructions, not an
argument.

```
Demo account: appreview@mysetlists.net / <REVIEW_PASSWORD>

To see the Guideline 1.2 features:

TERMS AGREEMENT
1. On a fresh install, tap "Log in". The Terms of Use agreement appears
   above the sign-in options. Sign in with Apple, Sign in with Google and
   the email form are all disabled until the checkbox is ticked.

ANOTHER USER'S CONTENT (to flag and block)
2. Sign in, then open Shows and select:
      Phish — Dick's Sporting Goods Park — 29 August 2025
3. That show has a comment AND a video from a different user
   ("Jordan Mills"), which the demo account can flag and block.

FLAGGING
4. Tap the flag icon on Jordan Mills' comment, choose a reason, tap
   "Send report". The comment disappears immediately and a confirmation
   states the 24-hour review commitment.

BLOCKING
5. In "Photos & Videos" on the same show, tap the name "Jordan Mills" to
   open their profile, then tap Block and confirm. Their content
   disappears from the screen straight away, without reloading.
6. Profile -> Blocked accounts lists them, with an Unblock option.

Full Community Guidelines: https://mysetlists.net/terms#community-guidelines
Moderation contact: support@mysetlists.net
```

---

## 4. Claim-by-claim verification

What every statement in the reply rests on, and how far it has actually been
checked.

| Claim | Where it lives | Verified |
|---|---|---|
| Agreement blocks all three providers | `AuthModal.js` holds `agreed`; `LoginForm`/`SignupForm` pass it to `OAuthButtons` and their submit | ✅ 7 Playwright tests, green in CI |
| Handlers refuse even on Enter | `if (!agreed) return` in all four handlers | ✅ code read |
| Existing users re-gated at launch | `TermsGate` returns early in `AppShell` on `termsAccepted === false` | **[VERIFY ON DEVICE]** |
| Acceptance stored with version | `userProfiles/{uid}.termsAcceptedVersion` via `lib/terms.js` | **[VERIFY ON DEVICE]** |
| Terms state all five points | `TermsOfService.jsx` §4 | ✅ 5 Playwright tests |
| Filter covers all listed fields | `moderate-content.js` targets: showComment, meetupComment, showMedia, profileName, handle, meetupDescription | ✅ code read |
| Client write refused by rules | `firestore.rules` — `textFieldsUnchanged()`, meetup `hasOnly(['updatedAt'])` | ✅ 8 rules tests |
| Client and server agree | `contentFilterParity.test.js`, `handleParity.test.js` | ✅ passing |
| Flag on comments/media/meetups/profiles | `ReportButton` at 4 call sites + `UserProfileSheet` | ✅ code read, not runtime |
| Flag shown on the item, not in a menu | `ReportButton` renders inline | ✅ code read |
| Item hides for reporter immediately | `onReported` in `ReportModal` | ⚠️ integration test written, **not run** |
| Auto-hide at three reporters | `AUTO_HIDE_THRESHOLD`, `report-content.js` | ⚠️ integration test written, **not run** |
| Report emails us | `notifyAdmin()` via Resend in `report-content.js` | **[VERIFY ON DEVICE]** — needs `RESEND_API_KEY` |
| Block from profile / sheet / friend card | `UserProfileSheet`, `ReportModal`, `FriendCard` | ✅ code read |
| Content disappears with no reload | Optimistic `setBlockedUserIds` in `AppContext` + `withoutBlocked` selectors | ⚠️ integration test written, **not run** |
| Block ends friendship, clears tags/requests | `blockUser` + `clearPendingBetween` in `lib/moderation.js` | **[VERIFY ON DEVICE]** |
| Block notifies us | `notify-block.js` → `reports` row + Resend | **[VERIFY ON DEVICE]** |
| Blocked list and unblock | `BlockedAccountsSection` on `/profile` | ✅ code read |
| Queue oldest-first with age | `subscribeOpenReports`, `AgeBadge` | ✅ code read |
| 12-hour reminder | `moderation-sla-reminder.js`, every 4h | ✅ 9 unit tests on the rule; **[VERIFY ON DEVICE]** for delivery |
| Eject disables sign-in | `getAuth().updateUser({disabled:true})` in `moderate-report.js` | **[VERIFY ON DEVICE]** |
| Eject signs out other devices | `revokeRefreshTokens()` | **[VERIFY ON DEVICE]** |
| Eject removes all their content | sweep into `moderationHidden` | ⚠️ rules tests cover readability; sweep **not run** |
| Ejected user sees an explanation | `SuspendedScreen` | **[VERIFY ON DEVICE]** |
| Actions recorded with reviewer/time | `adminAuditLog` + `resolvedBy`/`resolvedAt` | ✅ code read |
| Camera prompt fixed | `lib/nativePermissions.js` — one permission at a time | **[VERIFY ON DEVICE]** — the bug is iOS-only |
| Purpose strings specific | `Info.plist` | ✅ plist parsed |
| Privacy manifest ships in the bundle | `PrivacyInfo.xcprivacy` is in the Resources build phase (pbxproj L157) | ✅ verified in the project file — no manual step needed |
| Release build uses production push | `AppRelease.entitlements`, wired at pbxproj L356 | ✅ verified in the project file |

### Do not send this reply until

1. The device pass confirms every **[VERIFY ON DEVICE]** row.
2. `node scripts/seed-review-account.js --yes --reset` has been run, and
   `node scripts/verify-review-account.js` passes. **The `--reset` matters**:
   if a previous review round left `appreview@` blocking `reviewfriend@`, the
   friend's content is invisible and the reviewer will find nothing to flag.
3. The recording is made on a physical device from a fresh install.

Build and upload steps are in `docs/build-testflight-3-1-32.md` — reconstructed from
the project's own build settings, because `claude/build-testflight-and-submit.md` is
not in this repository.

### One wording note

Both the reply and the Notes field say "video" for Jordan Mills' media item,
and that is deliberate. The seeded item is a YouTube-type record in the Photos &
Videos gallery — it carries the same flag control and the same "Photo or video"
label as an uploaded image, and the flag and block flows are identical — but a
reviewer told to look for a photo and shown a video embed may reasonably think
they are in the wrong place. Do not change either to "photo" without seeding a
real image upload first.
