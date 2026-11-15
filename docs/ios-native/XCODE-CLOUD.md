# Xcode Cloud for the native app

Xcode Cloud setup can't be scripted from the repo: products and workflows are created in Xcode and App Store Connect. These are the steps for Phillip, written for the decision in `DECISIONS.md` (D-7).

## The constraint

Apple: "a bundle ID always matches exactly one Xcode Cloud product". The native app keeps `com.mysetlists.app`, so it shares the product the Capacitor app uses today. D-7 assumes that one product can't build two different projects. So **during the transition Xcode Cloud builds the native app, and the Capacitor app is built by hand** (Xcode → Archive → Distribute, as in [`docs/build-testflight-3-1-32.md`](../build-testflight-3-1-32.md)).

**Build numbers can't collide.** App Store Connect requires a unique pair of version and build number. The native app is 4.0.x, and no Capacitor build has used 4.x. The Capacitor app stays on 3.x, and a rollback build takes a version above the native one.

## Before you start

1. **Look up the highest build number used so far:** App Store Connect → MySetlists → TestFlight → iOS builds, newest first. Note it, for example 140. The repo can't tell: `CURRENT_PROJECT_VERSION` in `ios/` says 32, but Xcode Cloud overrides it, and the September rejection named build 130.
2. **Make the last Capacitor build you need from Xcode Cloud.** After the switch, Capacitor builds are manual.

## Step 1: point the product at the native workspace

**Path A (try first, 5 minutes).** Open `ios-native/MySetlists.xcworkspace` in Xcode, then Integrate → Create Workflow.
- If Xcode offers the **existing** MySetlists product and lets the new workflow build `ios-native/MySetlists.xcworkspace`, do that, and continue at step 2.
- Afterwards, open the old Capacitor workflow in App Store Connect and check that it still points at `ios/App`. Forum reports say a second onboarding can move the old workflows. If it moved, disable the old workflow.

**Path B (the D-7 assumption: one product, one project).**
1. App Store Connect → MySetlists → Xcode Cloud → Settings → **Remove product**. This deletes the Xcode Cloud workflows and their build history. TestFlight builds, App Store versions and the app record are untouched.
2. In Xcode, open `ios-native/MySetlists.xcworkspace` → Integrate → Create Workflow → choose the **MySetlists** app (`com.mysetlists.app`) → grant access to `phillip-leonard/show-tracker` when asked.
3. A new product starts its build numbers at 1. Set App Store Connect → Xcode Cloud → Settings → Build Number → **Next Build Number** to one above the number from "Before you start" (for example 141), so build numbers never go backwards in TestFlight.

## Step 2: the workflows

**"Native: internal TestFlight"** (main):

| Setting | Value |
|---|---|
| Start condition | Branch Changes → `main`. Files and Folders → Custom Conditions → **Start a Build** when files change in `ios-native/`. Also Manual Start. |
| Environment | Latest release Xcode and macOS. **Clean** build on. |
| Actions | **Test**: iOS, scheme `MySetlists`, iOS Simulator (any recent iPhone). **Archive**: iOS, scheme `MySetlists`, Deployment Preparation **TestFlight (Internal Testing Only)**. |
| Post-actions | TestFlight Internal Testing → a group named "Native internal" (create it in TestFlight first). **No external testing, no App Store submission** (DECISIONS: internal TestFlight only until cutover). |

**"Native: PR check"** (pull requests):

| Setting | Value |
|---|---|
| Start condition | Pull Request Changes → any source branch into `main`. Files and Folders → Start a Build when files change in `ios-native/`. |
| Actions | **Test** only (iOS Simulator, scheme `MySetlists`). |

Both workflows run `ios-native/ci_scripts/ci_post_clone.sh`, which installs nothing. It checks that `GoogleService-Info.plist` is for `com.mysetlists.app` and that `Package.resolved` is committed.

## Step 3: check the first build

- The build log shows `ci_post_clone: OK`, then package resolution from `MySetlists.xcworkspace/xcshareddata/swiftpm/Package.resolved`.
- The Archive log shows the **Upload dSYM to Crashlytics** phase running, not "skipped". The Firebase console → Crashlytics → MySetlists (iOS) then lists the dSYM for 4.0.0 (*n*).
- TestFlight shows **4.0.0 (*n*)**, with *n* above every earlier Capacitor build.

Signing is automatic (team `66N4YR3VP9`). The App ID already has Sign in with Apple, Push Notifications and Associated Domains from the Capacitor app, so the developer portal needs no changes.

## While both apps exist

| | Capacitor (`ios/`) | Native (`ios-native/`) |
|---|---|---|
| Version | 3.13.x, bumped by every PR | 4.0.x, bumped by PRs that touch `ios-native/` |
| Built by | Hand, from Xcode | Xcode Cloud |
| Goes to | App Store and external TestFlight | Internal TestFlight only |
| ci_scripts | `ios/App/ci_scripts` (npm, next build, cap sync) | `ios-native/ci_scripts` (no npm) |

**A device holds one build per bundle ID.** Installing the native TestFlight build replaces the Capacitor app on that phone. That replacement is the Q-01 carry-over test (Part 7).
