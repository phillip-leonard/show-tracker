#!/bin/sh
# Xcode Cloud, native app (ios-native/). Runs after the clone, before Xcode
# resolves packages and builds MySetlists.xcworkspace.
#
# No npm, no Node, no web build: unlike ios/App/ci_scripts/ci_post_clone.sh
# (the Capacitor app, which bundles the web export), the native app is
# Swift only. Xcode Cloud runs the ci_scripts folder next to the project it
# builds, so the two never run each other's script.
set -eu

echo "MySetlists native: ci_post_clone"
echo "  workflow:  ${CI_WORKFLOW:-?}"
echo "  commit:    ${CI_COMMIT:-?}"
echo "  build:     ${CI_BUILD_NUMBER:-?}"
echo "  xcode:     $(xcodebuild -version | head -1)"

ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
NATIVE="$ROOT/ios-native"

# The Firebase config is committed, as in the Capacitor project. Fail early,
# with a clear message, if it is missing or names another app.
PLIST="$NATIVE/App/Resources/GoogleService-Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "error: $PLIST is missing" >&2
  exit 1
fi
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$PLIST")
if [ "$BUNDLE_ID" != "com.mysetlists.app" ]; then
  echo "error: GoogleService-Info.plist is for $BUNDLE_ID, not com.mysetlists.app" >&2
  exit 1
fi

# Package.resolved pins every dependency; Xcode Cloud won't resolve without it.
if [ ! -f "$NATIVE/MySetlists.xcworkspace/xcshareddata/swiftpm/Package.resolved" ]; then
  echo "error: MySetlists.xcworkspace/xcshareddata/swiftpm/Package.resolved is missing" >&2
  exit 1
fi

echo "ci_post_clone: OK"
