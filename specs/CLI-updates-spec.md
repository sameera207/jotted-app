# Jotted CLI updates in the app — build spec

Oct 4, 2026 · @Sam · proposed

## Purpose

Let the app install new `jotted` CLI releases on its own, without waiting for an app release. Fixes and
features in the CLI then reach people as soon as they're released, and app releases are only for changes to
the app.

Today the CLI inside the app is the pinned release in `jotted.lock`, and "the bundled CLI changes only with the
app" (`docs/bundling.md` §6). That stays as the starting point and the fallback. On top of it, the app checks
jotted-cli's GitHub releases, and downloads, verifies and switches to a newer CLI when one is compatible.

## What a jotted-cli release gives the app

Every published release (`release.yml` in jotted-cli) holds:

| File | What the app does with it |
| --- | --- |
| `release.json` | The manifest: `version`, `tag`, `contract`, `contract_min`, and `builds` (`macos-arm64`, `macos-x64`: `file`, `sha256`, `size`) |
| `release.json.minisig` | Its minisign signature. Checked first; nothing else is trusted until it passes |
| `jotted-X.Y.Z-macos-<arch>.tar.gz` | The standalone build (a `jotted/` folder, Python inside) |
| `schema.json`, `cli-contract.md` | Not used at runtime. The app's types are generated from the pinned release, which is why only releases with the same `contract` are installed |

The latest release's files are at `https://github.com/sameera207/jotted-cli/releases/latest/download/<file>`.
That's a plain download, not the GitHub API, so it has no rate limit. jotted-cli publishes a release only once
every file is on it, so the app never sees half of one.

## Decisions

| Question | Decision |
| --- | --- |
| Trust | Only a `release.json` whose minisign signature checks out against the public key built into the app (`vendor/jotted/release-key.pub`, from jotted-cli's `docs/release-key.pub`). Then the build's SHA-256 and size must match the manifest |
| Compatibility | Install only a release whose `contract` is in `SUPPORTED_CONTRACTS` (`src/store/startup.ts`). A release with a new contract waits for an app release built for it |
| Where it lives | `~/Library/Application Support/app.jotted.desktop/cli/<version>/` (the app's data folder), with a `current` symlink to the active one |
| Which one runs | `cli/current/jotted`. The bundled copy is only the seed and the last-resort fallback |
| Claude Desktop | Connected to `cli/current/jotted`, a path that doesn't move with the app and follows every CLI update |
| When | At launch (after the list loads) and every 6 hours while running. On by default; Settings can turn it off |
| Applying | At once: download and check in the background, switch `current`, restart `jotted serve` and the events follower. The person sees a quiet note, not a prompt |
| Going back | If the new CLI fails its check, or `jotted serve` won't start on it, `current` goes back to the previous version and that release is skipped from then on |
| Development | Off when `JOTTED_BIN` is set (debug builds) |

## How it works

### The CLI folder

```text
~/Library/Application Support/app.jotted.desktop/cli/
  0.1.0/jotted/jotted, _internal/…     seeded from the app bundle
  0.2.0/jotted/jotted, _internal/…     downloaded
  current -> 0.2.0
  state.json                           last check, skipped versions, the version before `current`
```

- **Seeding, at every launch:** if `cli/` has no version at least as new as the bundled one (`jotted.lock`'s
  `version`), copy the bundled `Contents/Resources/jotted/` to `cli/<bundled version>/` and point `current` at
  it. A first launch, or an app update whose bundled CLI is newer than anything downloaded, ends up here. The
  copy is about 50 MB, once per version.
- **`bin::jotted_path()`** in release builds returns `cli/current/jotted` when it exists and runs
  (`--json version` answers). Otherwise it returns the bundled copy and logs why.
- **Keep two:** after a switch, keep `current` and the version before it; delete the rest. A `jotted mcp`
  that Claude started earlier may still be running from the previous one.

### Checking

1. Download `release.json` and `release.json.minisig` (timeout 15 s; offline means try again later, silently).
2. Verify the signature with the built-in key (the `minisign-verify` crate). A failure is logged, shown in
   Settings as "Couldn't verify the latest release", and nothing is downloaded.
3. Compare: install when `version` is newer than `current`'s, `contract` is in `SUPPORTED_CONTRACTS`, and the
   version isn't in `skipped`. A newer release with an unsupported contract shows "Jotted X.Y.Z needs a newer
   app" in Settings; the app's own updater brings that.

### Installing

1. Download `builds["macos-<arch>"].file` to `cli/.download/`, then check its size and SHA-256 against the
   manifest.
2. Unpack it into `cli/<version>.partial/` and check that `jotted/jotted` is there and executable.
3. Run `cli/<version>.partial/jotted/jotted --json version` with the app's environment (`bin::command()`). Its
   `version` and `contract` must match the manifest.
4. Rename the folder to `cli/<version>/`, then switch `current` in one step (a new symlink beside it, renamed
   over it).
5. Restart the background: `stop_background()`, then `start_background(since)` from the follower's last cursor,
   so no events are missed. Commands already running finish on the old copy, whose files are still there.
6. Note: "Jotted updated to X.Y.Z." If Claude Desktop is connected, add "Quit and reopen Claude Desktop to use
   it there."

### Going back

- A failure in steps 1–3 deletes the partial download and keeps `current`. A failed check (checksum, version)
  adds the version to `skipped`; a network failure doesn't, so it's retried later.
- After the switch, if the serve supervisor gives up (three fast failures), point `current` back at the
  previous version, add the new one to `skipped`, restart, and show: "Jotted X.Y.Z didn't start, so the app
  went back to W.V.U." The log has the details.

### Downloads and macOS

Files the app downloads itself carry no quarantine flag, so Gatekeeper doesn't stop them. The standalone builds
are ad-hoc signed by PyInstaller, which is enough for them to run on Apple silicon as children of the app.
**Verify** on a clean Mac:

- a downloaded CLI runs from the app's data folder with no prompt;
- Claude Desktop can start it as `cli/current/jotted`.

If either fails, jotted-cli's release job has to sign and notarize the builds with a Developer ID, which needs
the Apple certificate in jotted-cli's CI too.

## Claude Desktop

This changes `specs/Claude-Desktop-spec.md`:

- **Connect** passes `--command <app data>/cli/current/jotted` instead of the path inside the app bundle.
  Claude then follows every CLI update and keeps working wherever the app is moved.
- **The disk-image and translocation check** (`claude.rs`, `refuse_location`) is no longer needed: the path
  never depends on where the app runs from. Keep the check until this ships.
- **"Needs repair"** becomes rare: the entry only goes stale if the data folder is deleted. The repair banner
  and button stay as they are.
- **Restarting Claude:** after an update, `claude status` still matches (same path), but a `jotted mcp` that
  Claude already started keeps the old version until Claude is restarted. Hence the note in Installing,
  step 6.

## Settings

Settings › App gains a **Jotted** row:

- "Jotted 0.2.0 (contract 1)". If it isn't the bundled copy: "installed Oct 6; came with the app: 0.1.0".
- **Update automatically**: on by default. Off: a new release shows "Jotted 0.3.0 is available" with an Install
  button, which runs the same steps.
- **Check now**, and when it last checked.
- If a release was skipped: "0.2.1 didn't start and was skipped", with **Try again** (removes it from `skipped`).

## The Rust side

- **`src-tauri/src/cli_update.rs`:** `check()`, `install(manifest)`, `seed()`, `rollback()`, `state.json`.
  Tauri commands: `cli_update_status`, `cli_update_check`, `cli_update_install`, `cli_update_retry`.
- **Downloads:** `reqwest` with rustls, https only, following redirects to GitHub's object storage, 15 s to
  connect, 5 minutes for a build.
- **New crates:** `minisign-verify` (signature), `sha2`, `flate2` and `tar` (unpacking; refuse absolute paths
  and `..` in the archive).
- **`build.rs`:** builds `vendor/jotted/release-key.pub` into the binary, and fails the build if it's missing.
- **`bin.rs`:** `jotted_path()` as above. `JOTTED_BIN` (debug builds) still wins and turns updates off.
- **`lib.rs`:** a timer every 6 hours, and the restart in Installing, step 5, through the existing
  `stop_background` / `start_background`.
- **Serve supervisor:** reports "gave up" to `cli_update` so it can go back to the previous version.

## The front end

- `store`: `cliUpdate` (active version, bundled version, available, last check, skipped, state).
- Settings › App › Jotted row; the update notes.
- Start-up: unchanged. The version and contract check still runs against whatever `current` is, and an
  incompatible `current` can't happen, since only supported contracts are installed.

## Testing

- **Unit (Rust):**
  - the manifest parses;
  - a good signature passes and a bad one fails, with a test key pair under `tests/keys/`;
  - a wrong SHA-256 or size is refused;
  - contract filtering, version comparison, `skipped`;
  - archive paths with `..` are refused;
  - the `current` switch is atomic;
  - going back after the supervisor gives up.
- **Integration:** a local HTTP server serving a fake release (manifest signed with the test key, a tiny build
  whose `jotted` answers `--json version`). Covers a full install, a refused signature, a refused checksum, an
  unsupported contract, and the bundled fallback when `current` is broken.
- **Manual, per CLI release:** on a Mac with the previous app build, publish the release and wait for (or force)
  the check. The app switches and restarts; Settings shows the new version; Claude Desktop keeps working, then
  uses the new version after a restart.

## What this needs from jotted-cli

| Ask | Status |
| --- | --- |
| Signed `release.json` on every release, published only when complete | Done (`release.yml`, Oct 4) |
| `docs/release-key.pub` | Waiting on the key pair: `AGENTS.md` › Releases |
| Standalone builds per architecture | Done; the Intel build hasn't run in CI yet |

`scripts/fetch-jotted.ts` should also copy `docs/release-key.pub` into `vendor/jotted/` with the contract.

## Milestones

1. **Seed and run from `cli/current`:** `bin.rs`, seeding, the fallback. No downloads yet.
2. **Check and verify:** the manifest, the signature, contract filtering. Settings shows "available".
3. **Install and switch:** download, check, unpack, smoke test, switch, restart, the notes.
4. **Going back:** supervisor failures, `skipped`, Try again.
5. **Claude Desktop on `cli/current/jotted`:** the connect path, and dropping the translocation check.
6. **Manual run** on a clean Mac with a real release.

## Out of scope

Windows; beta or other update channels; downgrading by hand; updating the app itself (`tauri-plugin-updater`,
`docs/bundling.md` §6).
