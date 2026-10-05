# How the `jotted` CLI is bundled

The app does everything through the `jotted` CLI (`jotted --json …`). People install one
thing, `Jotted.dmg`: the app with a pinned CLI release inside, Python included. They need no
Python, Rust, Node or terminal. Rust and Node are only needed to build the app.

```text
jotted-cli release vX.Y.Z            jotted-app                              Jotted.app
──────────────────────────           ───────────────────────────             ──────────────────────────────
jotted-X.Y.Z-macos-arm64.tar.gz ─┐   jotted.lock (version, sha256)           Contents/
jotted-X.Y.Z-macos-x64.tar.gz   ─┼─► scripts/fetch-jotted.ts ─────────────►    MacOS/jotted-app    (Rust + web UI)
schema.json, cli-contract.md    ─┘     checks sha256, unpacks into             Resources/jotted/
                                       src-tauri/binaries/jotted-<triple>/       jotted            (frozen Python)
                                     vendor/jotted/ (committed)                  _internal/...
                                     src/jotted/types.gen.ts
```

## 1. What jotted-cli publishes (not done yet)

Each tagged release should attach, per macOS architecture, a standalone build with Python
inside, plus a SHA-256 for each, `schema.json` and `cli-contract.md`
(`specs/CLI-contract-spec.md`, stage 2). **jotted-cli has no tags or build workflow yet**, so
there is nothing to pin. Until then the app runs against `JOTTED_BIN` (below).

The build should be **PyInstaller `--onedir`**: a folder holding `jotted` and `_internal/`,
shipped as `jotted-X.Y.Z-macos-<arch>.tar.gz` with that folder at its root.

- `--onefile` unpacks Python into a temp folder on every run. That slows every command the
  app makes, and the unpacked libraries can't be signed with the app's identity, which
  notarization rejects.
- With `--onedir`, every file can be signed and commands start fast.

## 2. The pin: `jotted.lock`

```json
{ "version": "0.1.0", "contract": 1, "repo": "sameera207/jotted-cli",
  "targets": { "aarch64-apple-darwin": { "asset": "jotted-0.1.0-macos-arm64.tar.gz", "sha256": "…" }, … } }
```

`npm run fetch-jotted` (or `-- --host` for this machine only) does the following:

1. Downloads each build and refuses it if its checksum doesn't match the lock.
2. Unpacks it into `src-tauri/binaries/jotted-<triple>/`, which is gitignored.
3. Downloads `schema.json` and `cli-contract.md` into `vendor/jotted/` (committed).
4. Regenerates `src/jotted/types.gen.ts`.

To bump the CLI:

1. Edit the version and checksums in the lock.
2. Run `npm run fetch-jotted`.
3. Run `scripts/record-fixtures.sh`.
4. Run the tests.
5. Commit `jotted.lock`, `vendor/`, `src/jotted/types.gen.ts` and `tests/fixtures/` together.

## 3. Where it goes in the app

Tauri's `externalBin` (its "sidecar") takes a single file, and Tauri's `resources` copy
follows symlinks: the frozen Python's `_internal/Python -> Python.framework/…` becomes a loose
copy whose code signature no longer checks out, and the CLI can't start ("code signature
invalid"). So Tauri builds the app alone, and `scripts/build-mac.sh TARGET` puts the onedir
folder in afterwards with `ditto` (which keeps symlinks), signs the app around it, and makes
the DMG:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: …" NOTARY_PROFILE=jotted-notary \
  scripts/build-mac.sh aarch64-apple-darwin
```

That puts it at `Jotted.app/Contents/Resources/jotted/jotted`. In release builds,
`src-tauri/src/bin.rs` looks for it there with `resource_dir()`. If the CLI ever ships as a
single file, switch to `externalBin`. Only `jotted_path()` would change.

## 4. How it runs

- Everything starts through `bin::command()`. It adds `JOTTED_BUNDLED=1`, so the CLI never
  updates itself and `update` fails with `conflict`.
- It removes `PYTHONHOME`, `PYTHONPATH` and `VIRTUAL_ENV`, so a Python setup in the user's
  shell can't interfere.
- In release builds it sets a fixed `PATH`, since an app opened from the Finder doesn't get
  the shell's.
- The CLI uses its usual app folder, `~/Library/Application Support/jotted`.

Three Rust pieces run it:

| Piece | File | What it runs |
| --- | --- | --- |
| Runner | `runner.rs` | `jotted --json ARGS` for the front end. Only commands in `vendor/jotted/schema.json` (built in by `build.rs`), never `serve start update mcp setup auth`, `--follow` or `-o`, and no argument that looks like a key. Secrets go on stdin, which is then closed. 60 s timeout; 10 min for `check collect todo connect setup prepare`. stderr goes to `~/Library/Logs/app.jotted.desktop/jotted.log` (stdin never does). |
| Serve supervisor | `serve.rs` | `jotted serve --no-browser --port 0` while the app runs. Restarts after 1, 5, 30 s; gives up after three fast failures and the window shows a banner. SIGTERM on quit, then up to 5 s to stop. |
| Events follower | `events.rs` | `jotted --json events --follow --since C`, each line sent as `jotted://event`. Restarts from the last cursor it saw. |

At start-up the front end:

1. Runs `version` and stops with "needs updating" unless `contract` is in
   `SUPPORTED_CONTRACTS` (`src/store/startup.ts`).
2. Runs `setup status`.
3. Reads the latest cursor (`events`).
4. Loads the list.
5. Starts serve and the follower from that cursor.

Because the list is reloaded at every launch, the app doesn't save a cursor between launches.
That's a small departure from the spec: there's no stale saved cursor to deal with, and
nothing is missed.

The children's process IDs are kept in `children.json` in the app's data folder. A quit
(including SIGTERM/Ctrl-C) stops them. A launch after a crash stops any the last run left
behind, after checking that each process is still a jotted one.

## 5. Signing and notarization (milestone 7)

macOS requires every executable in the bundle to be signed. In CI:

1. `npm run fetch-jotted`
2. Sign every Mach-O under `src-tauri/binaries/jotted-<triple>/` (executables, `*.dylib`,
   `*.so`), innermost first, with `codesign --force --options runtime --timestamp
   --entitlements src-tauri/jotted.entitlements --sign "$APPLE_SIGNING_IDENTITY"`.
3. `tauri build` as above. It signs the app with `APPLE_SIGNING_IDENTITY`.
4. Notarize and staple (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
5. Smoke test: `Jotted.app/Contents/Resources/jotted/jotted --json version` still runs.
   Then `codesign --verify --deep --strict` and `spctl -a -vv`.

The frozen Python will probably need `com.apple.security.cs.disable-library-validation` in
its entitlements. Add `allow-unsigned-executable-memory` only if the smoke test fails without
it.

**rmapi** isn't in the bundle. `jotted setup prepare` downloads it into the app folder,
checking a pinned checksum. Python's downloader sets no quarantine flag, so Gatekeeper
doesn't block it, but it isn't covered by the app's notarization either.

`scripts/build-mac.sh TARGET` (`npm run build:mac`) does steps 2, 3 and 5 for one target;
`.github/workflows/release.yml` runs it for both on a version tag, with the certificate and
notarization credentials from the repo's secrets, and publishes the DMGs as a GitHub release.

## 6. Updates

The bundled CLI is the one the app starts with. Newer CLI releases are downloaded, verified and
switched to by the app itself, without an app release: `specs/CLI-updates-spec.md`. The pin
still moves with app releases, as the seed and the fallback.

How it's built: `src-tauri/src/cli_update.rs` seeds `<app data>/cli/<version>/` from the
bundle and runs `cli/current/jotted/jotted` (`bin::jotted_path()` falls back to the bundled
copy while that doesn't answer `version`). The release signing key is
`vendor/jotted/release-key.pub`, fetched with the contract from jotted-cli's
`docs/release-key.pub` at the pinned tag and built in by `build.rs`: release builds fail
without it; debug builds without it compile with updates off. In debug builds `JOTTED_BIN`
turns updates off, and `JOTTED_RELEASE_URL` points them at a test server instead of GitHub.

**App updates are not wired yet:** `tauri-plugin-updater` needs an updater signing key pair. The public key
goes in `tauri.conf.json` (`plugins.updater.pubkey`, with the release feed as `endpoints`),
the private key and its password in the CI secrets (`TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), and the workflow then uploads `latest.json` with each
release. Until then Settings › App says updates arrive with release builds.

## Development without a release build

| `JOTTED_BIN` | Runs |
| --- | --- |
| `tests/fake-jotted/jotted` | The fake CLI, from recorded fixtures. No tablet, key or Python. |
| `scripts/dev-jotted.sh` | `uv run --project ../jotted-cli jotted`: your checkout, on your real data |

`JOTTED_BIN` is honoured only in debug builds. Relative paths are resolved from the repo
root.

## Risks to keep an eye on

- **One app folder, two CLIs.** A `uv tool install`ed jotted and the bundled one share
  `~/Library/Application Support/jotted` and its database. That's useful, but a newer
  standalone CLI could migrate the database ahead of the app's pin. The CLI should refuse a
  database from a newer schema with a clear error code.
- **Size.** A frozen Python with `anthropic` is probably 40–80 MB. Measure it in jotted-cli's
  build job.
