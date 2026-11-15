#!/bin/sh
# netlify-ignore.sh — Netlify's `ignore` command (netlify.toml [build]).
#
# Netlify runs this before every build. Exit 0 cancels the build ("no content
# change"); exit 1 builds. It skips a build only when EVERY file changed since
# the last deploy is under ios-native/ (the native iOS app, which the website
# doesn't contain). Anything else changed (docs/, CHANGELOG.md, package.json,
# rules, functions, the web app) builds, as does any case this can't be sure
# of:
#
#   - no CACHED_COMMIT_REF (first deploy of a branch, cleared cache)
#   - CACHED_COMMIT_REF equal to COMMIT_REF (a retried or manual deploy)
#   - git can't diff the two (the base commit isn't in the clone)
#   - nothing changed at all
#
# Renames are listed as a delete plus an add (--no-renames), so moving a file
# from outside ios-native/ into it still builds.
#
# Tested by tests/ci/netlifyIgnore.test.js against a scratch git repo.

build() { echo "netlify-ignore: build ($1)"; exit 1; }
skip() { echo "netlify-ignore: skip ($1)"; exit 0; }

base="${CACHED_COMMIT_REF:-}"
head="${COMMIT_REF:-}"

[ -n "$base" ] || build "no previous deploy to compare with"
[ -n "$head" ] || build "no COMMIT_REF"
[ "$base" != "$head" ] || build "same commit as the last deploy (a retry)"

files=$(git diff --name-only --no-renames "$base" "$head" 2>/dev/null) || build "git can't compare $base..$head"
[ -n "$files" ] || build "no files changed"

outside=$(printf '%s\n' "$files" | grep -v '^ios-native/' || true)
if [ -n "$outside" ]; then
  build "changed outside ios-native/: $(printf '%s\n' "$outside" | head -3 | tr '\n' ' ')"
fi

skip "every changed file is under ios-native/ ($(printf '%s\n' "$files" | wc -l | tr -d ' ') files)"
