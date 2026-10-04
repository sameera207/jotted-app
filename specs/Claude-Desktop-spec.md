# Claude Desktop from the Jotted app — build spec

Oct 4, 2026 · @Sam · proposed

## Purpose

Let a person connect Jotted to Claude Desktop with one button in the app, and see what Claude does to their list
(items it proposed from their documents and mail) in the app as well as in Claude.

Everything on the Claude side already exists in `jotted-cli` (merged to `main`, not yet released):

- `jotted claude connect | status | disconnect` writes the `jotted` entry in Claude Desktop's settings
  (`specs/Claude-connector-spec.md` there, §4.8).
- `jotted mcp` gives Claude the to-do tools, proposals (`items_propose`, `items_accept`) and the inline list widget
  (`specs/Claude-widget-spec.md` there). All of it was checked in Claude Desktop on Oct 3.

This spec is about the app: the button, keeping the connection healthy as the app moves and updates, and showing
proposals. The app still only runs `jotted --json …` (`specs/Desktop-app-spec.md`); nothing here talks to Claude
Desktop directly.

## Decisions

| Question | Decision |
| --- | --- |
| Which `jotted` Claude runs | The app's active copy, `<app data>/cli/current/jotted` (`specs/CLI-updates-spec.md`), passed as `claude connect --command PATH`. Claude and the app run the same version on the same data, and Claude follows CLI updates. Until that spec ships: the copy bundled in the app |
| Who edits Claude's settings | `jotted claude connect` and `disconnect`, through the runner, like every other command. The app never reads or writes `claude_desktop_config.json` itself |
| Admin tools | Off by default. A separate switch, with a warning, adds `--admin` |
| Restarting Claude Desktop | The app says to quit and reopen it. It never quits or restarts Claude Desktop itself (that would need Automation permission over another app) |
| Repairing a stale connection | Always asks first. The app never changes Claude's settings without the person pressing a button |
| Proposals in the app | Shown on the To-do window above the sheet, never on the sheet itself: they have no row on the tablet |
| When the app is closed | Claude keeps working: `jotted mcp` runs on its own. With the app open, its commands go to the app's `jotted serve` (the CLI's fast path), so there is one writer and they're quicker |

## How it fits together

```text
 Jotted.app                                         Claude Desktop
 ┌────────────────────────────────┐                 ┌──────────────────────────────┐
 │ Settings › Claude  ──runner──► jotted claude      │ claude_desktop_config.json   │
 │                                connect --command ─┼─► mcpServers.jotted =        │
 │                                <bundled jotted>   │   {command: <bundled jotted>,│
 │                                                   │    args: ["mcp"], env: {…}}  │
 │ serve supervisor: jotted serve ◄── fast path ──────┼── jotted mcp (spawned by    │
 │ events follower ◄─ item.proposed / item.accepted   │   Claude, same binary)       │
 └────────────────┬───────────────┘                 └──────────────┬───────────────┘
                  └────────── ~/Library/Application Support/jotted ┘ (one database)
```

- Claude starts `jotted mcp` from the app bundle. When the app's `jotted serve` is running (same version), each
  tool call is handed to it; otherwise `jotted mcp` opens the database itself.
- Every change Claude makes is an event, so the app's follower sees it at once: `item.proposed` for a proposal,
  `item.accepted` then `item.added` when one is accepted, the usual `item.*` events for the rest.

### The intended flow

Proposals are approved in Claude Desktop, at the time:

1. The person asks Claude to read a document, a thread or a meeting. Claude proposes items, shown in the Jotted
   widget in the chat.
2. The person accepts (or dismisses) them there.
3. Accepted items are on the Jotted list at once, and the app shows them.
4. They reach the tablet's To-do document at its next update. With the app running (`jotted serve`, kept in the
   menu bar), that update happens on its own a moment after the change. With the app closed, Claude still adds
   them, and they reach the tablet when the app next opens and checks.

The app's proposals panel (below) is the fallback for proposals left unreviewed in a chat.

## Connecting

### Where

1. **Settings › Claude** (new section, always there).
2. **After setup**, once: a card at the top of the To-do window, "Use Jotted from Claude Desktop", with Connect and
   "Not now". Shown only when Claude Desktop is installed (`claude status` → `installed`, a CLI ask) and not yet
   connected. "Not now" hides it for good (app setting); Settings › Claude stays.

### The Connect button

1. **Check where the app is running from.** If its bundle path is under `/Volumes/` (still in the disk image) or
   contains `/AppTranslocation/` (macOS runs a quarantined app from a random, temporary path), don't connect: the
   path would vanish. Say "Move Jotted to your Applications folder first, then open it from there." This check is in
   Rust (`claude.rs`, below), since only the app knows its own path.
2. `jotted claude connect --command <bundled jotted>` (plus `--admin` when that switch is on).
3. On success:
   - `changed: true`: "Connected. Quit and reopen Claude Desktop to use Jotted there." with the backup path under
     "Details".
   - `changed: false`: "Already connected."
4. Errors, by `error.code`:

| Code | Means | The app shows |
| --- | --- | --- |
| `config` | Claude Desktop isn't installed, or its settings file isn't valid JSON (left untouched) | The message, and for the second case "Show in Finder" on `config_path` |
| `invalid` | The bundled `jotted` isn't there or isn't executable | The error panel: the app is damaged; reinstall |
| other | As in the main spec's error table | |

In debug builds with `JOTTED_BIN` set, pass no `--command`: the CLI uses its own path (`.venv/bin/jotted` for
`scripts/dev-jotted.sh`). Claude Desktop can't run the dev script itself, since its `PATH` has no `uv`.

### Status and repair

At start-up (after the list loads, not blocking it) and on opening Settings › Claude, run `claude status`:

| `claude status` | State shown | Action |
| --- | --- | --- |
| `configured: false` | Not connected | Connect |
| configured, `command_exists`, `matches_current` | Connected (and "with admin tools" when `admin`) | Disconnect |
| configured, `command_exists: false` | Needs repair: "Claude can't find Jotted. The app was moved or reinstalled." | Repair (= Connect) |
| configured, exists, `matches_current: false`, `command` inside a `Jotted.app` | Needs repair: "Claude runs another copy of the Jotted app." | Repair |
| configured, exists, `matches_current: false`, any other path | "Claude runs a different `jotted` (`command`)." Someone set it up from a terminal | "Use this app's Jotted" (= Connect), never automatic |

**Repair always asks.** When the start-up check finds "Needs repair", the app shows a banner on the To-do window:
"Claude Desktop can't find Jotted (the app was moved or reinstalled)", with **Repair** and **Not now**. Repair
runs Connect, then says "Quit and reopen Claude Desktop." Not now hides the banner until the next launch; Settings
› Claude keeps showing the state. Nothing is changed without the person pressing Repair.

**Updates:** the updater replaces the app in place, so the path stays the same and nothing needs repairing. A
`jotted mcp` that Claude started before the update keeps running the old version until Claude is restarted. It
still works: the fast path skips a server of another version, and database changes only add columns. After an
update that bumps the CLI pin, the app shows a quiet note once: "Quit and reopen Claude Desktop to use the new
version of Jotted there."

### Disconnecting

Settings › Claude › Disconnect runs `jotted claude disconnect`, then shows "Disconnected. Quit and reopen Claude
Desktop."

Deleting the app can't run anything, so Claude is left with an entry for a missing binary and reports the server
as failed. Settings › Claude says "Disconnect before you remove Jotted"; the website's uninstall note says the
same.

## What the bundled `jotted` needs in Claude's entry

The app runs its `jotted` through `bin::command()`. That sets `JOTTED_BUNDLED=1` and removes `PYTHONHOME`,
`PYTHONPATH` and `VIRTUAL_ENV`. Claude Desktop starts the same binary with its own environment, so the entry has
to carry what matters:

- `JOTTED_BUNDLED=1`, so `version` reports a bundled copy and nothing tries to update it. `claude connect` copies
  it into `env` when it is set, with `JOTTED_CONFIG` and `JOTTED_HOME`. The runner already sets it, so the app
  passes nothing extra.
- Python variables: **Verify** that the frozen (PyInstaller `--onedir`) build ignores `PYTHONPATH`/`PYTHONHOME`
  from Claude's environment. If it doesn't, `claude connect` should write them as empty strings in `env`.

Data: no variable needed. Both the app and Claude's `jotted mcp` use `~/Library/Application Support/jotted`.

## Proposals in the app

Claude proposes items it found in documents, mail and meetings (`status: proposed`). They wait for the person and
never reach the tablet before. They are meant to be approved in Claude Desktop, at the time (see "The intended
flow"). The panel below is the fallback: proposals left unreviewed when a chat was closed or moved on from can
still be accepted or dismissed in the app. It stays out of the way when there are none.

### Loading and events

- Load `items --status proposed` with the list at start-up (store: `proposed`, kept apart from `items`, since the
  sheet's rows and slots never include them).
- Events:

| Event | Store change |
| --- | --- |
| `item.proposed` | Upsert into `proposed` |
| `item.accepted` | Remove from `proposed` (the `item.added` that follows puts it on the list) |
| `item.removed` | Also remove from `proposed` (a dismissed proposal) |

- `status.items.proposed` gives the count before the list loads (sidebar and tray).

### To-do window

- A **"Proposed by Claude (N)"** panel above the sheet, collapsed to one line when N > 3, hidden when N = 0. It
  isn't a sheet: no checkboxes, no rule lines, so it doesn't read as being on the tablet.
- Each proposal shows its text, owner (`owner_name`), source (`source.kind` as Doc / Mail / Calendar / Jira /
  Confluence / Chat, plus `source.title`), and the `source.excerpt` quoted in `--pencil`. **Accept** and
  **Dismiss**.
- "Open" on the source, for an `https` `source.url` only, opens the default browser (`tauri-plugin-opener`, scoped
  to `https://`). Jotted never fetches it.
- **Accept all** accepts the proposals shown (`items accept ID…`), never `--all`, so nothing the person hasn't seen
  is accepted.
- Accept and Dismiss are optimistic like the rest. A `conflict` or `not_found` (someone accepted it in Claude
  meanwhile) refreshes `proposed` quietly instead of showing an error.
- Text is shown as text: excerpts and titles were copied by an agent from someone else's document.

### Elsewhere

- **Sidebar:** "To-do 12 · 3 proposed".
- **Tray popover:** a "3 proposed by Claude" line under the open count; clicking it opens the To-do window at the
  panel.
- **Source line** of an accepted item (`origin: agent`): "from Claude · Doc · Platform sync, 29 Sep". Its "Where it
  came from" shows the excerpt and the link instead of a notebook page.
- **Owner names:** `owner_name` is now on every item. Rows show "→ Dana" instead of "→ Someone else" (the main
  spec's ask).

## Settings › Claude

| Row | Shows | Commands |
| --- | --- | --- |
| Claude Desktop | State from `claude status` (Not connected, Connected, Needs repair, Another `jotted`) and the button for it | `claude connect --command …`, `claude disconnect` |
| Items Claude adds | "Ask me first" (proposes everything) or "Add what I ask for straight away" (default) | `settings set mcp_add_mode propose_all\|auto` |
| Let Claude change what Jotted reads | Off by default. On: "Claude can change watched folders and settings. Only turn this on if you trust every document you ask Claude to read." Reconnects with `--admin` | `claude connect --command … [--admin]` |
| Proposals waiting | `N of proposed_limit`, "Review" (scrolls to the panel) | `settings` |

## The Rust side

- **`src-tauri/src/claude.rs`:** one Tauri command, `claude_bundle_ok() -> Result<(), String>`. It checks the
  translocation and disk-image cases above and returns the bundled path the front end passes to `--command`.
  Nothing else; the commands still go through the runner.
- **Runner:** nothing to change for `claude connect | status | disconnect`. They come from the vendored schema
  once the pin moves, and `mcp` stays blocked. Paths aren't caught by `looks_like_secret` (they contain `/`); a
  test keeps it that way.
- **Opener:** add `tauri-plugin-opener` with its scope limited to `https://*` for source links.

## The front end

- `client.ts`: `claudeStatus()`, `claudeConnect({command, admin, dryRun})`, `claudeDisconnect()`,
  `itemsProposed()`, `itemsAccept(ids)`, `itemsGet(id)`. All checked against the vendored schema by the existing
  test.
- `store.ts`: `proposed`, `claude` (last status), the event cases above.
- `labels.ts`: the `agent` origin and source kinds.
- Screens: Settings › Claude; the proposals panel in `Todo.tsx`; the tray line; the one-time card.
- Mockups: none exist for these. Add `09-settings-claude` and `10-proposals` to `docs/mockups/` before building
  the screens.

## Testing

- **Never touch the real Claude Desktop settings.** `scripts/record-fixtures.sh`, the fake CLI and every test set
  `JOTTED_CLAUDE_CONFIG` to a file in a temporary folder. (jotted-cli's own test run once edited the real file
  before it did this.)
- **Fixtures:** record `claude status` in each state (not configured; connected; stale command; another command),
  `claude connect` (changed, unchanged, `config` error), `claude disconnect`, `items --status proposed`,
  `items accept`, and `events` lines for `item.proposed` / `item.accepted`.
- **Unit:** the status-to-state table, no `claude connect` without a button press (start-up only shows the
  banner), the event cases, Accept all sending only the shown ids, `https`-only links.
- **Rust:** `claude_bundle_ok` refuses `/Volumes/…` and `…/AppTranslocation/…` paths; the runner allows `claude
  connect --command /Applications/Jotted.app/Contents/Resources/jotted/jotted`.
- **End to end (fake CLI):** connect from Settings; the post-setup card and "Not now"; a stale entry offered for repair at
  start-up, then repaired; a proposal arriving by event, accepted, then on the sheet; Accept all; dismiss.
- **Manual, per release:**
  1. Install from the DMG and connect before moving the app (refused).
  2. Move it to Applications, connect, and restart Claude.
  3. Ask Claude to "show my Jotted list" (the widget appears).
  4. Propose from a pasted document and accept one in the app (it disappears from Claude's widget on its next
     refresh).
  5. Move the app and relaunch (the repair banner; press Repair).
  6. Disconnect.

## What this needs from `jotted-cli`

| Ask | For | Blocking? |
| --- | --- | --- |
| A tagged release with standalone builds that includes `claude …`, proposals and the widget (everything on `main` as of 8edc6d5) | Moving the pin; packaging | Yes, for release. Development works now with `JOTTED_BIN=scripts/dev-jotted.sh` |
| `claude connect` copies `JOTTED_BUNDLED` and `JOTTED_HOME` into the entry's `env` when set | Claude runs the bundled copy as the app does | Done in jotted-cli (Oct 4), not yet released |
| `claude status` gains `installed` (Claude Desktop's settings folder exists) | Showing the post-setup card only to people who have Claude Desktop | Done (Oct 4), not yet released |
| `claude status` reports the entry's `env` | Spotting an entry made for another data folder | Done (Oct 4), not yet released |

All are additive; the contract stays 1.

Moving the pin also clears two of the main spec's asks: owner names (`owner_name`) and changing the owner
(`items edit --owner`).

## Milestones

This slots in after the main spec's milestone 6 (Settings and the tray). It can be built against `JOTTED_BIN`
before milestone 7 (packaging), but ships only with a pinned release.

1. **Pin and client:** move the pin (or `JOTTED_BIN` meanwhile), regenerate types, record the fixtures, client
   functions.
2. **Connect:** Settings › Claude, `claude.rs`, status and repair, the post-setup card.
3. **Proposals:** the store, the panel, Accept / Accept all / Dismiss, sidebar and tray counts, source lines and
   links.
4. **Settings:** add mode, admin switch, the limit.
5. **Manual run** of the list above on a signed build.

## Decided

- **No reminder on the tablet.** Proposals are approved in Claude Desktop when Claude makes them (see "The intended
  flow"), so the To-do document shows items only.

## Out of scope for now

- **Windows.** Claude Desktop keeps its settings in `%APPDATA%\Claude\` there, and the CLI already knows the path,
  but the app's checks (disk image, translocation) and testing are macOS-only.
- **Other agent apps** (Codex, Cursor and the like). The CLI's `connect` pattern is meant to extend to them; the
  app would then have a row per app under "Agent apps".
- **Restarting Claude Desktop from the app.**
