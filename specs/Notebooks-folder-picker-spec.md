# Notebooks folder picker — build spec

Oct 6, 2026 · @Sam · proposed

## Purpose

Make choosing which folders Jotted reads quick and obvious. Today's Notebooks screen (spec: `Desktop-app-spec.md` › Screens › 5) shows every folder as a card in a flat grid. With a real library (40-odd folders, some nested) it's hard to scan and hides how watching actually works.

This spec replaces the card grid with a folder tree and a detail panel beside it. It changes only the app. The CLI stays at the pinned release; the things it would need from the CLI are under "What the app needs from `jotted-cli`".

- Mockup: "Jotted Notebooks Picker" (https://claude.ai/artifact/PkYhYt6dznvDN4Wgq3LmLN). Copy it into `docs/mockups/` as `03-notebooks.html` / `.png` when this is accepted.
- Contract: `vendor/jotted/cli-contract.md` › `library`, `watch`, `settings`.

## What's wrong today

1. **A card per folder.** Each card is about 220 × 200 px for a name, a count and one checkbox. Fifteen folders fill the window; the rest, and the selected folder's documents, sit below the fold.
2. **Nesting is flattened.** `Mable › 1-1` is a card next to `Mable`, but ticking `Mable` already reads `Mable › 1-1`: `watch` covers a folder and everything under it. The cards don't show this, so people tick both, or think they have to.
3. **No overview.** The only way to see what Jotted reads is to scan every card for a tick (or read the sidebar's Watching list).
4. **Selecting a folder is hidden.** Clicking the folder's name (a plain bold label) shows its documents, far down the page.
5. **"From now on" is always "Everything" against the real CLI.** The screen checks `settings.from_now.includes(folder.path)`, but the CLI keeps document IDs in `from_now`, not paths (`watch.from_now` in `jotted-cli/src/jotted/api.py`). The fake CLI keeps paths, which is why the e2e test passes. See "Deriving state".

## Decisions

| Question | Decision |
| --- | --- |
| Layout | Two panes: a folder tree on a paper sheet (left, 280–380 px), the selected folder's detail (right). Stacked below 960 px |
| One row per folder | Chevron · checkbox · name · tag · count, 36 px high, ruled like the To-do sheet |
| Subfolders of a ticked folder | Shown ticked in pencil (dashed box, faint tick), tagged "via Mable", and not tickable on their own |
| Overview | A "Reading N documents in" line of chips above the panes, one per `settings.watch` entry, with × to stop |
| Finding a folder | A search field and an "All folders / Being read" filter above the tree |
| Ticking a folder whose subfolders have their own ticks | The parent takes over: `watch add` the parent, then `watch remove` each covered entry, so `settings.watch` has no overlaps |
| A new tick reads | From now on (`watch add` then `watch from-now`), so old notebooks don't flood the list. Everything is one click away |
| From now on / Everything | In the detail panel, as two labelled radio cards with one line each, only for a folder that is itself ticked |
| Undo | Every tick, untick and mode change shows a toast with Undo for 5 s |
| Setup | Setup's step uses the same tree, compact: no detail panel, no documents |

## How Jotted watches (from the CLI, unchanged)

- `settings.watch` is a list of paths: folders or single documents. A folder covers everything under it (`Settings.watches`: `doc.path == w or doc.path.startswith(w + "/")`; `/` covers everything).
- `library.folders[].documents` counts every document under the folder, subfolders included. `library.folders[].watched` is true when any entry covers it.
- `watch add` and `watch remove` change `settings.watch` only. `watch remove` of a subfolder whose parent is watched changes nothing that's read.
- `watch from-now PATH` adds the IDs of the documents under PATH **today** to `settings.from_now`, and answers `{settings, documents, already_read}`. Documents created later are new writing anyway, so they're read in full. Documents already read in full can't be skipped and come back in `already_read`. It fails with `not_found` when PATH has no documents.
- `watch read-all PATH` takes those IDs out of `from_now`.
- There is no exclude: you can't watch `Mable` but not `Mable › Hiring`.

## The screen

### Layout

```text
Notebooks
Tick a folder and Jotted reads it, along with every folder inside it. New writing becomes to-do items.

Reading 52 documents in  (Blog ×) (books +1 inside ×) (Mable +8 inside ×)

┌ sheet ───────────────────────────┐  ┌ detail ─────────────────────────────┐
│ ( Find a folder           )      │  │ Mable ›                             │
│ [All folders] Being read         │  │ 1-1                    (Go to Mable)│
│──────────────────────────────────│  │ Read because Mable is ticked. To    │
│   ☐ 1-1 Adam                  1  │  │ choose this folder on its own,      │
│ ▸ ☐ 2025                     35  │  │ untick Mable.                       │
│ ▸ ☐ archives                 44  │  └─────────────────────────────────────┘
│   ☑ Blog  (everything)        4  │  DOCUMENTS · 6
│ ▾ ☑ Mable (from now on)      32  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐
│     ☑ 1-1  via Mable          6  │  │  │ │  │ │  │ │  │
│     ☑ AI rollout  via Mable   1  │  └──┘ └──┘ └──┘ └──┘
└──────────────────────────────────┘  1-1 Priya  1-1 Tom …
```

### Reading chips

- One chip per `settings.watch` entry, sorted by name, labelled with `folderLabel` ("Mable", "books › C4"). A folder with subfolders adds "+N inside" (N = folders under it).
- The lead-in counts documents: "Reading **52 documents** in", the sum of `library.folders[].documents` for watched folders, plus 1 per watched document.
- Clicking a chip selects that folder in the tree (expanding its parents). × runs `watch remove` (with Undo).
- A watched **document** (e.g. "Quick sheets") gets a chip with the document's name. Clicking it selects its folder.
- Nothing watched: "Jotted isn't reading any folders yet."

### The tree

Built from `library.folders` (see "Deriving state"). Sorted by name, case-insensitive, numbers in order ("Q2" before "Q10"). The To-do document's folder is listed like any other.

**A row**: chevron (only when the folder has subfolders), checkbox, name, tag, count (`documents`, tabular figures). Indented 18 px per level. Clicking the row selects it; clicking the checkbox ticks it; clicking the chevron expands or collapses it.

| State | When | Checkbox | Tag | Click on the box |
| --- | --- | --- | --- | --- |
| `off` | Nothing covers it, and no entry under it | Empty | — | Tick it |
| `on` | It is in `settings.watch` | Ink tick, name in 600 | "from now on" / "everything" / "mixed" pill | Untick it |
| `inherited` | An ancestor is in `settings.watch` | Dashed faint box, faint tick | "via Mable" | Toast: "Read through Mable. Untick it to choose these one by one." Nothing changes |
| `partial` | Not covered, but an entry is under it | Box with an ink bar (mixed) | "2 inside" when collapsed | Tick it (the parent takes over) |

**Expanded at first**: folders with a watched entry under them, and the selected folder's parents. Expansion is kept for the session (in memory, not settings).

**Search**: filters by folder name, case-insensitive. A folder shows when it or anything under it matches; parents of a match are expanded while searching; the match is highlighted (`--highlighter`). ↓ from the field moves to the first match; Escape clears it. No match: "No folder called "xyz"."

**Being read**: shows only rows that aren't `off` (with their parents). Empty: "Jotted isn't reading any folders yet. Tick one to start."

### The detail panel

For the selected folder (first watched folder by default, else the first folder).

1. **Breadcrumbs**: the parents, each a link that selects it. A top-level folder shows "On your reMarkable".
2. **Name** (h2) and one button:
   - `off` / `partial`: **Read this folder** (solid pill).
   - `on`: **Stop reading** (outline pill).
   - `inherited`: **Go to Mable** (selects the covering folder).
3. **Status line**:
   - `on`: "Jotted reads **Mable** and the 8 folders inside it: 32 documents." (or "Jotted reads **Blog**: 4 documents.")
   - `inherited`: "Read because **Mable** is ticked. To choose this folder on its own, untick Mable."
   - `partial`: "Not read, but Jotted reads **1-1**, **Hiring** inside it. Ticking Mable covers those too."
   - `off`: "Not read. Tick it to turn its new writing into to-do items, along with the 8 folders inside it."
4. **Which pages** (only when `on`): two radio cards.
   - **From now on** — "Only writing added from today becomes items." → `watch from-now PATH`
   - **Everything** — "Pages already written count too." → `watch read-all PATH`
   - When neither is fully true (see `folderMode`), neither card is checked and a line reads "Some documents here read everything, some only new writing."
   - When `watch from-now` answers `already_read`, show under the cards: "Already read in full, so nothing is skipped: Weekly sync, Roadmap."
5. **Folders inside**: chips for the direct subfolders, with counts; clicking selects.
6. **Documents** in this folder only (not subfolders), as today's thumbnails (`image page DOC 1`, blank when unread), with today's notes ("read", "not read yet", "not read", "made by Jotted · not read"). Heading: "Documents in this folder · 6". None: "No documents directly in this folder."

### Keyboard

The tree is one tab stop (roving `tabindex`).

| Key | Does |
| --- | --- |
| ↑ / ↓ | Previous / next visible row, and select it |
| → | Expand; if expanded, go to the first child |
| ← | Collapse; if collapsed, go to the parent |
| Space / Enter | Tick or untick |
| ⌘F | Focus search |
| Escape (in search) | Clear search |

### Toasts

At the bottom of the content, ink on paper-inverted, 5 s, one at a time, with **Undo**.

| After | Says |
| --- | --- |
| Tick | "Reading Mable from now on" |
| Tick that took over entries | "Reading Mable, which now covers 1-1, Hiring" |
| Untick, or × on a chip | "Stopped reading Mable" |
| From now on / Everything | "Mable: only new writing" / "Mable: older pages count too" |
| Click on an `inherited` box | "Read through Mable. Untick it to choose these one by one." (no Undo) |

Undo runs the reverse commands (below) and restores the previous `settings` on success.

## Actions and commands

All in `src/store/settings.ts` as one `changeWatch(plan)` that applies the change optimistically, runs the commands in order, keeps the last `settings` answered, then reloads `library` and `status`. On an error it puts `settings` back, runs no further commands, and shows the error (`showError`). A partial failure (e.g. `add` worked, `from-now` failed) reloads `settings` so the screen shows the truth.

| Action | Commands |
| --- | --- |
| Tick `off` folder | `watch add P`, then `watch from-now P` (skipped when the folder has no documents) |
| Tick `partial` folder | `watch add P`, `watch remove C` for each entry C under P, then `watch from-now P` |
| Untick `on` folder | `watch remove P`, then `watch read-all P` (so its documents aren't skipped if it's read again later) |
| × on a chip | Same as untick |
| From now on | `watch from-now P` |
| Everything | `watch read-all P` |
| Undo a tick | `watch remove P`, `watch read-all P`, then `watch add C` (and `watch from-now C` where C was from now on) for each entry it took over |
| Undo an untick | `watch add P`, then `watch from-now P` if it was from now on |

Settings changes also arrive as `settings.changed` events; the store already applies them.

## Deriving state

New module `src/store/folders.ts`, pure functions, unit tested:

```ts
type FolderNode = { path: string; name: string; documents: number; direct: number; children: FolderNode[] };

buildTree(folders: Library["folders"]): FolderNode[]        // nests by path; adds missing parents
coverOf(path: string, watch: string[]): string | null        // the entry that covers path: itself or nearest ancestor ("/" covers all)
entriesUnder(path: string, watch: string[]): string[]        // watch entries strictly under path
folderState(path, watch): "off" | "on" | "inherited" | "partial"
folderMode(path, library, fromNow): "from-now" | "everything" | "mixed" | "empty"
filterTree(tree, query, onlyRead, watch): FolderNode[]       // search and Being read
```

- `direct` = `documents` minus the children's `documents`.
- `folderMode` looks at `library.documents` under `path` and checks their `id` against `settings.from_now`: all in → `from-now`, none → `everything`, some → `mixed`, no documents → `empty` (shown as "everything"). This fixes problem 5. `PickerProps` loses its `from_now.includes(path)` check.
- Path matching is the CLI's: `p === w || w === "/" || p.startsWith(w + "/")`. Normalise trailing slashes first.
- The fake CLI's `watch from-now` / `read-all` must store document IDs like the real one (`tests/fake-jotted/fake.cjs`, lines ~455–458 and the seed at line 54).

## Setup's picker

`FolderPicker` becomes `FolderTree` in `src/components/FolderTree.tsx`, used by Notebooks (with search, filter and selection) and by Setup's `folders` step (`compact`: no detail panel, no selection, no mode pill; "Read this folder" is the checkbox). Setup's "Continue" stays enabled once anything is ticked. A new tick in Setup also starts as From now on.

## Accessibility

- The tree is `role="tree"`, rows `role="treeitem"` with `aria-level`, `aria-expanded` (when they have children) and `aria-selected`; children in `role="group"`.
- The checkbox is `role="checkbox"` with `aria-checked` `true` / `false` / `mixed`; `inherited` adds `aria-disabled="true"` and a label "1-1, read through Mable".
- Chips' × have "Stop reading Mable". The chips line and the detail panel are `aria-live="polite"`.
- Contrast: the faint tick (`--faint` on `--paper`) marks state that the "via Mable" tag also states in `--pencil` text, so the state never depends on the faint tick alone.

## Files

| File | Change |
| --- | --- |
| `src/screens/Notebooks.tsx` | New layout: chips, tree, detail panel. `Documents` stays, filtered to direct documents |
| `src/components/FolderTree.tsx` | New: tree, search, filter, keyboard |
| `src/components/Toast.tsx` | New, unless the store's banner can carry an Undo action |
| `src/store/folders.ts` | New: the functions above |
| `src/store/settings.ts` | `changeWatch(plan)` and undo; `watchFolder` kept for single commands |
| `src/screens/Setup.tsx` | Use `FolderTree compact` |
| `src/styles/app.css` | Replace the `.folder*` card styles with `.tree`, `.row`, `.chip`, `.detail`, `.mode` |
| `tests/fake-jotted/fake.cjs` | `from_now` as document IDs; nested folders in the seed |
| `docs/mockups/03-notebooks.*` | The new mockup |
| `specs/Desktop-app-spec.md` | Screens › 5 points here |

## Testing

- **Unit (Vitest), `tests/unit/folders.test.ts`**: `buildTree` with nested and missing parents; `coverOf` with `/`, trailing slashes and siblings that share a prefix (`/Mable` must not cover `/Mable2`); `folderState` for all four states; `folderMode` with all, none and some IDs; `filterTree` keeps parents of matches.
- **Unit, store**: `changeWatch` runs the commands in order, stops on the first error and restores `settings`; Undo runs the reverse.
- **End to end (Playwright)**, replacing the two Notebooks tests:
  - ticks a folder: chip appears, the row shows "from now on", the sidebar's Watching lists it;
  - ticks a parent: its subfolders show "via …" and can't be ticked; a subfolder that had its own tick loses its chip;
  - Undo puts the previous ticks back;
  - Everything / From now on persist after a reload of `settings`;
  - search finds a nested folder and expands its parent; Being read hides unticked folders;
  - keyboard: ↓ ↓ Space ticks the second folder; ← goes to the parent;
  - Setup's compact tree ticks a folder and enables Continue.
- **Fixtures**: re-record `library.json` with `scripts/record-fixtures.sh` once the CLI's synthetic library has a nested folder (the current recording is a `not_set_up` error); until then the fake's seed adds one.

## What the app needs from `jotted-cli`

| Ask | For | Blocking? |
| --- | --- | --- |
| `watch exclude PATH` (and `include`), with `settings.exclude` | Unticking one subfolder of a ticked folder | No. Until then `inherited` rows can't be unticked |
| `parent` and `depth` on `library.folders` | Building the tree without parsing paths | No |
| A per-entry mode, e.g. `settings.from_now_paths` | Showing a folder's mode without matching every document ID | No |
| `watch add PATH --from-now` in one call | One command per tick, and no half-done tick | No |

## Milestones

1. `folders.ts` and its tests; fix the fake's `from_now`; fix problem 5 in the current screen.
2. `FolderTree` and the detail panel in Notebooks, with chips and toasts.
3. Setup's compact tree.
4. Mockup PNG and the Desktop app spec's Screens › 5.

## Open questions

- **New ticks as From now on.** Safer for big folders, but someone setting up for the first time may expect their open actions from last week. Default by folder size, or ask on first tick?
- **Picking single documents.** `watch` already takes a document path. Add a checkbox to each thumbnail in the detail panel?
- **The To-do document's folder.** Hide it from the tree, or keep it with the "made by Jotted" note?
- **Very large libraries.** Virtualise the tree past a few hundred folders, or is that not a real case on a reMarkable?
