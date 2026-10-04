# Jotted desktop app

A Tauri 2 + React app for Jotted: the To-do list from your reMarkable, on paper-like sheets.
The build spec is `specs/Desktop-app-spec.md`; the designs are in `docs/mockups/`; how the CLI
gets inside the app is `docs/bundling.md`.

```sh
npm install
npm run dev:fake                                    # the screens in a browser, on the fake CLI
JOTTED_BIN=tests/fake-jotted/jotted npm run tauri dev   # the real app, on the fake CLI
JOTTED_BIN=scripts/dev-jotted.sh npm run tauri dev      # the real app, on ../jotted-cli and your data
npm test                                            # unit tests (Vitest)
npm run test:e2e                                    # end to end (Playwright, on the fake CLI, port 1430)
(cd src-tauri && cargo test)                        # the runner's allowlist and parsing
npm run typecheck
```

Rust is needed to build (`rustup`); people installing the app need nothing.

## Layout

- `src/jotted/`: the only code that talks to jotted. `transport.ts` (Tauri runner or the
  dev bridge), `client.ts` (one typed function per command), `errors.ts` (what to do per
  `error.code`), `events.ts`, `types.gen.ts` (generated: `npm run gen-types`, never edit).
- `src/store/`: the Zustand store, start-up, and labels (source lines, filters, pages).
- `src/screens/`: Welcome, Setup, Todo, Notebooks, Settings, Tray (the menu bar popover, the
  same front end at `#tray`). `src/components/`, `src/styles/` (tokens from the mockups).
- `src/platform.ts`: links, the Finder, open at login, the menu bar; no-ops in a browser.
- `src-tauri/src/`: `runner.rs` (the `jotted` command), `serve.rs`, `events.rs`, `bin.rs`
  (which jotted, and its environment), `orphans.rs`, `log.rs`, `claude.rs` (where the app
  runs from, for `claude connect`), `tray.rs` (menu bar icon, popover, keep running).
- `scripts/build-mac.sh` and `.github/workflows/release.yml`: signed builds with the pinned CLI.
- `tests/fake-jotted/`: a stand-in jotted answering from `tests/fixtures/`, which are
  recorded from the real CLI by `scripts/record-fixtures.sh`, never written by hand.
- `dev/jotted-bridge.ts`: lets the screens run in a browser for Playwright. Dev only.

## Rules

- The front end never spawns processes; everything goes through `transport()`.
- Branch on `error.code`, never on the message.
- Keys and one-time codes go on stdin; the runner refuses arguments that look like keys.
- A new command in `client.ts` must exist in `vendor/jotted/schema.json`
  (`tests/unit/schema.test.ts` checks).
- Ticks, edits, adds and dismissals are optimistic and undone on error (`src/store/store.ts`).

## Jotted

This project talks to Jotted only through the `jotted` CLI, pinned to release v0.1.0.
Read `vendor/jotted/cli-contract.md` (how to use it) and `vendor/jotted/schema.json`
(every command, its arguments and the shape of its data) before writing code that calls it.
Run `jotted --json …`, check `ok`, branch on `error.code`. Never import Jotted's Python,
read its database, call its HTTP API, or pass keys through an agent. If a command you need
is missing, say so instead of working around it.
