#!/usr/bin/env bash
# Build Jotted.app and the DMG for one macOS target, with the pinned jotted inside
# (docs/bundling.md §3 and §5). Run `npm run fetch-jotted` first.
#
#   scripts/build-mac.sh [aarch64-apple-darwin|x86_64-apple-darwin]   default: this Mac's
#
# With APPLE_SIGNING_IDENTITY set, every Mach-O in the bundled jotted is signed first
# (innermost first, hardened runtime, src-tauri/jotted.entitlements); Tauri then signs the
# app, and notarizes it when APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID are set too.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-$(uname -m | sed 's/arm64/aarch64/')-apple-darwin}"
cli="$root/src-tauri/binaries/jotted-$target"

if [[ ! -x "$cli/jotted" ]]; then
  echo "no bundled jotted at ${cli#$root/}: run npm run fetch-jotted (needs a jotted-cli release)" >&2
  exit 1
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "signing the bundled jotted as $APPLE_SIGNING_IDENTITY"
  # Deepest paths first, so a library is signed before what loads it.
  find "$cli" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) -print0 |
    xargs -0 file | grep -E 'Mach-O' | cut -d: -f1 | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2- |
    while read -r bin; do
      codesign --force --options runtime --timestamp \
        --entitlements "$root/src-tauri/jotted.entitlements" --sign "$APPLE_SIGNING_IDENTITY" "$bin"
    done
fi

cd "$root"
npx tauri build --target "$target" \
  --config "{\"bundle\":{\"resources\":{\"binaries/jotted-$target/\":\"jotted/\"}}}"

app="$root/src-tauri/target/$target/release/bundle/macos/Jotted.app"
echo "smoke test: the bundled jotted still runs"
"$app/Contents/Resources/jotted/jotted" --json version
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --verify --deep --strict "$app"
  spctl -a -vv "$app" || echo "spctl: not accepted yet (notarization pending?)" >&2
fi
