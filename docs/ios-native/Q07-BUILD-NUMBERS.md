# Q-07: can native and Capacitor build numbers collide?

**No.** The native app ships as 4.0.x, and no Capacitor build has used a 4.x version, so no upload of one can have the same version and build pair as an upload of the other. Nothing has to be coordinated between the two projects' build numbers.

## Why

- **What App Store Connect requires:**
  - Each upload's pair of version (`CFBundleShortVersionString`, from `MARKETING_VERSION`) and build (`CFBundleVersion`, from `CURRENT_PROJECT_VERSION`) must be unique for the app.
  - Within one version, each build number must be higher than the last.
  - On iOS, a different version may reuse a build number.
- **What that means here:** the two projects can only collide if they upload the same version. The native project is on 4.0.x (it started at 4.0.0 in Part 3). The Capacitor project is on 3.13.x and never takes a 4.x number during the transition (CLAUDE.md, "Versioning"). So their versions never meet.
- **One Xcode Cloud product per bundle ID** (D-7). It has one build-number counter, so every build Xcode Cloud makes counts up from the same number. Capacitor builds are made by hand during the transition, so they don't advance that counter. Their build numbers come from `CURRENT_PROJECT_VERSION` in `ios/` (32 today), and they're still unique, because each one is a new 3.13.x version.

## What to do

1. **Before the first native upload,** read the highest build number in App Store Connect → MySetlists → TestFlight (the repo can't tell; Xcode Cloud overrides `CURRENT_PROJECT_VERSION`). Set Xcode Cloud's **Next Build Number** one above it (`XCODE-CLOUD.md`, step 3). This isn't needed to avoid a collision. It keeps TestFlight's list in order, newest build highest.
2. **For a manual Capacitor upload,** set `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` above the highest build in TestFlight, for the same reason. Every PR already gives the Capacitor app a new 3.13.x version, so any number is accepted.
3. **Leave the native `CURRENT_PROJECT_VERSION` alone** (1 in the project). Xcode Cloud sets it on every build.

## The one exception: a rollback after cutover

Once a native 4.0.x version is live on the App Store, a new App Store version must be higher than it. A Capacitor build shipped as a rollback would then need a version above the native one, for example 4.1.0. That would be the only time the Capacitor project takes a 4.x number (DECISIONS.md, "Xcode Cloud"). Until cutover, native builds go to internal TestFlight only, and Capacitor releases stay on 3.x.
