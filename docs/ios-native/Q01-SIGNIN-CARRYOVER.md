# Q-01: does sign-in carry over from the Capacitor app?

When the native app is installed over the Capacitor app (same bundle ID, `com.mysetlists.app`), is the person still signed in on its first launch, or do they see the sign-in screen? Test it three times: Google, Apple and email.

## Answer (2026-11-15)

Phillip ran the steps below on a device.

| Signed in to the Capacitor app with | Native app on first launch | As expected? |
|---|---|---|
| Google | **Signed in**, same account | Yes |
| Apple | **Signed out** (the sign-in screen) | No: expected to carry over |
| Email and password | **Signed out** (the sign-in screen) | Yes |

**Decision (2026-11-15): Apple and email users sign in again. There's no token bridge** (no custom-token hand-off from a last Capacitor release). Their shows are in their account, so nothing is lost; they sign in once after the update.

**What the app does about it (native 4.0.6):** after an update from the Capacitor app, until an account signs in on that install, the sign-in screen says "Welcome back. Sign in to see your shows. Everything you logged is still there." "Forgot your password?" is on the sign-in screen itself, not only in the email sheet (`Core/Session/WelcomeBack.swift`, `Features/Auth/SignInView.swift`). A carried-over Google session never sees it.

**Why Apple didn't carry over:** the likely cause is that the Capacitor app signs Apple users in with `skipNativeAuth: true` (`lib/native-auth.js`), so the native Firebase SDK never holds an Apple session to leave in the keychain. SCOPING §3.4 said so before the test; the expectation in the table below was wrong. Nothing depends on the cause now that the decision is made.

**Cutover message:** plan it for Apple and email users ("you'll sign in once more"). Google users go straight in.

The steps and the expectations they were run against are kept below.

## What we expected, and why (before the test)

| Signed in to the Capacitor app with | Expected in the native app | Why |
|---|---|---|
| Google | **Signed in**, same account | The Capacitor app signs in through `@capacitor-firebase/authentication` with `skipNativeAuth: false` (`capacitor.config.ts`, `lib/native-auth.js`). So the native Firebase iOS SDK holds the session, in the keychain. |
| Apple | **Signed in**, same account | Same plugin, same path. |
| Email and password | **Signed out** (the sign-in screen) | The Capacitor app signs email users in with the web Firebase SDK inside its WebView (`components/auth/LoginForm.js`, persistence `browserLocalPersistence` in `lib/firebase.js`). That session is in WebView storage, which the native app doesn't read. |

**Why Google and Apple should work.** Firebase Auth files the session in the keychain under the Firebase iOS app's id. Both apps use the same one (`GOOGLE_APP_ID` is identical in `ios/App/App/GoogleService-Info.plist` and `ios-native/App/Resources/GoogleService-Info.plist`), in the same keychain access group, `66N4YR3VP9.com.mysetlists.app`. Neither app has a keychain-sharing entitlement (DECISIONS.md, "Project setup"). The SDKs differ (Capacitor's plugin uses Firebase 12.10, the native app 13.2), and the native app should read an entry the older SDK wrote.

**If email fails as expected,** email users sign in once more after the update. Whether that's acceptable, or the last Capacitor release should hand the session over (for example, exchange its ID token for a custom token from a server function, and sign the native SDK in with it), is a decision for after the test. Don't build either until the results are in.

## How the result is recorded

The native app (4.0.5 and later) records **once per install**, on its first launch, which auth state Firebase restored. It records no personal data: whether a uid was there, never the uid; the provider ids; no email or name.

- **On the phone:** in Me, tap the version five times. A **First-launch sign-in** row appears; open it.
  - It shows: signed in or out, the providers, guest or not, what the keychain held (`user`, `empty` or `unreadable` with an error code), whether the app was installed over the Capacitor app, the version, and the time.
  - At the bottom is one line to copy, for example `first launch 4.0.5 (141): signed in (google.com); keychain user; over the Capacitor app`.
- **Crashlytics** (TestFlight builds report): Crashlytics → Non-fatals → issue domain `FirstLaunchAuthState`. Code 1 is signed in, 0 is signed out. Each event has the summary line and the keys `first_launch_uid_present`, `first_launch_providers`, `first_launch_keychain` and `first_launch_over_capacitor`. Reports arrive within a few minutes, sometimes only after the next launch.
- **Console.app** (phone connected to the Mac): filter on subsystem `com.mysetlists.app`, category `Q01`.

"Installed over the Capacitor app" means the container already had WebKit data, which only the Capacitor app's WebView writes. A fresh install says "fresh install".

## Before you start

1. **A native build of 4.0.5 or later in internal TestFlight.** That needs the Xcode Cloud setup (`XCODE-CLOUD.md`) or a manual archive and upload. Use a build number above the highest already in TestFlight (Q-07, `Q07-BUILD-NUMBERS.md`).
2. **The Capacitor app from the App Store**, the version people have now. Installing the TestFlight build over the App Store app keeps its data, which is what a real update does.
3. **A test iPhone** on Wi-Fi. Offline, the native app can't read the profile, so even a carried-over account stops at the terms screen (by design: an unreadable profile fails closed). Online, an account that has accepted the terms goes straight in.
4. **Three accounts you can sign in to on production:** one Google, one Apple, one email and password. Existing accounts are fine; the test creates nothing new.
5. **The keychain outlives the app.** Deleting MySetlists doesn't delete its Firebase session, so a reinstalled app can come back signed in as the last account. That's why each run below starts by signing out in whichever app is installed, then deleting it.

## Steps for each run

Do this three times, with **Google**, then **Apple**, then **email**.

1. **Clean slate.** If MySetlists is installed, open it and sign out: in the native app, **Me → Sign out**; in the Capacitor app, open the menu and tap **Logout** at the bottom. Then delete the app (long-press → Remove App → Delete App).
2. **Install the Capacitor app** from the App Store. Note its version (Profile, or App Store → MySetlists).
3. **Sign in** with this run's method. Tick the terms box if asked. Wait until your shows load.
4. **Leave it signed in.** Don't sign out or delete the app. Swipe it away from the app switcher, so nothing is mid-write.
5. **Install the native build over it:** TestFlight → MySetlists → the 4.0.x build → **Install** (or **Update**). Don't delete the Capacitor app first.
6. **Launch MySetlists.** Note the first screen you see: the app (Shows), the sign-in screen, the terms screen, or something else.
7. **If you're in the app,** open **Me** and note who it says is signed in (the email or name, and "Signed in with Apple/Google"). Check it's the same account as in step 3.
8. **Read the record:** Me → tap the version five times → **First-launch sign-in**. Take a screenshot, or copy the line at the bottom.
9. **Fill in the row** for this run in the results table below.

**Optional control run** (checks the record itself): sign out and delete the app as in step 1, then install the native build from TestFlight without installing the Capacitor app. Expect `signed out; keychain empty; fresh install`.

## Results

Outcomes as reported on 2026-11-15. The versions and first-launch lines weren't sent; add them here if they're wanted for the record.

| Run | Capacitor version (App Store) | Signed in with | Native build (TestFlight) | First screen | Me shows the same account? | First-launch line | As expected? |
|---|---|---|---|---|---|---|---|
| 1 | | Google | | Shows (signed in) | Yes | | Yes |
| 2 | | Apple | | Sign-in screen | — | | No (expected signed in) |
| 3 | | Email | | Sign-in screen | — | | Yes |
| Control | none | none | | | | | |

## What the results mean

- **Google or Apple signed out, with `keychain empty`:** the Capacitor app's session wasn't where the native SDK looks. Check that the Capacitor app was still signed in at step 4, and that both builds use the same team and bundle ID.
- **`keychain unreadable` with a code** (for example -34018, a missing entitlement): an entitlement or access-group problem. Send the code.
- **Signed in, but as a different account:** the keychain held an older session. Step 1 wasn't done in the previous run; redo this run.
- **The terms screen first:** the profile couldn't be read (offline), or the account hadn't accepted the current terms. Check Wi-Fi and try again. The first-launch line still says what was restored.
- **Email signed in:** better than expected. It means the person had also signed in natively (Google or Apple) on this phone. Check that the providers in the line say `password`.

The answer and the decision are at the top of this file and in DECISIONS.md ("Spikes").
