#!/usr/bin/env bash
# Build Jotted.app and the DMG for one macOS target, with the pinned jotted inside
# (docs/bundling.md §3 and §5). Run `npm run fetch-jotted` first.
#
#   scripts/build-mac.sh [aarch64-apple-darwin|x86_64-apple-darwin]   default: this Mac's
#
# The CLI goes into Contents/Resources/jotted/ after Tauri has built the app, with `ditto`:
# Tauri's own resource copy follows symlinks, which breaks the frozen Python's framework
# (`_internal/Python -> Python.framework/…`) and its code signature.
#
# With APPLE_SIGNING_IDENTITY set, every Mach-O in the bundled jotted is signed (innermost
# first, hardened runtime, src-tauri/jotted.entitlements), then the app around it. With a
# notarytool keychain profile in NOTARY_PROFILE (`xcrun notarytool store-credentials`), the
# DMG is notarized and stapled too.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-$(uname -m | sed 's/arm64/aarch64/')-apple-darwin}"
arch="${target%%-*}"
cli="$root/src-tauri/binaries/jotted-$target"
identity="${APPLE_SIGNING_IDENTITY:-}"

if [[ ! -x "$cli/jotted" ]]; then
  echo "no bundled jotted at ${cli#$root/}: run npm run fetch-jotted (needs a jotted-cli release)" >&2
  exit 1
fi

if [[ -n "$identity" ]]; then
  echo "signing the bundled jotted as $identity"
  # Deepest paths first, so a library is signed before what loads it. Symlinks are skipped:
  # their targets are signed where they are.
  find "$cli" -type f -print0 | xargs -0 file | grep -E 'Mach-O' | cut -d: -f1 |
    awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2- |
    while read -r bin; do
      codesign --force --options runtime --timestamp \
        --entitlements "$root/src-tauri/jotted.entitlements" --sign "$identity" "$bin"
    done
fi

cd "$root"
# Tauri signs the app with APPLE_SIGNING_IDENTITY; it's signed again below, around the CLI.
npx tauri build --target "$target" --bundles app

bundle="$root/src-tauri/target/$target/release/bundle"
app="$bundle/macos/Jotted.app"
rm -rf "$app/Contents/Resources/jotted"
ditto "$cli" "$app/Contents/Resources/jotted"

if [[ -n "$identity" ]]; then
  # Seal the app with the CLI inside; nested code keeps its own signatures.
  codesign --force --timestamp --options runtime --preserve-metadata=entitlements,requirements,flags \
    --sign "$identity" "$app"
fi

bundled="$app/Contents/Resources/jotted/jotted"
if "$bundled" --json version >/dev/null 2>&1; then
  echo "smoke test: the bundled jotted still runs"
  "$bundled" --json version
elif [[ "$arch" != "$(uname -m | sed 's/arm64/aarch64/')" ]]; then
  # Another architecture, and no Rosetta to run it: check what it is instead.
  echo "smoke test skipped: can't run an $arch jotted on this Mac"
  file "$bundled" | grep -q "$( [[ $arch == x86_64 ]] && echo x86_64 || echo arm64 )"
else
  echo "the bundled jotted doesn't run:" >&2
  "$bundled" --json version
  exit 1
fi

version="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
dmg="$bundle/dmg/Jotted_${version}_${arch}.dmg"
mkdir -p "$bundle/dmg"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Jotted.app"
ln -s /Applications "$stage/Applications"
rm -f "$dmg"
hdiutil create -quiet -volname "Jotted" -srcfolder "$stage" -fs HFS+ -format UDZO "$dmg"

if [[ -n "$identity" ]]; then
  codesign --force --timestamp --sign "$identity" "$dmg"
  codesign --verify --deep --strict "$app"
  if [[ -n "${NOTARY_PROFILE:-}" ]]; then
    echo "notarizing (a few minutes)"
    xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$dmg"
    spctl -a -t open --context context:primary-signature -vv "$dmg"
  else
    echo "not notarized: set NOTARY_PROFILE to a notarytool keychain profile" >&2
  fi
fi
echo "built ${dmg#$root/}"
