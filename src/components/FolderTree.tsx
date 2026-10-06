// The device's folders as a tree, one ruled row each: chevron, checkbox, name, tag, count
// (spec: Notebooks-folder-picker-spec.md › The tree). Notebooks uses it with search, the Being
// read filter and selection; Setup uses it `compact`. One tab stop, arrow keys inside.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Library, Settings } from "../jotted/types.gen";
import {
  ancestorsOf,
  coverOf,
  entriesUnder,
  filterTree,
  folderMode,
  folderState,
  parentOf,
  shortName,
  type FolderNode,
  type FolderState,
} from "../store/folders";

type Props = {
  tree: FolderNode[];
  library: Library;
  settings: Settings;
  onToggle: (path: string) => void;
  /** Notebooks: the selected folder. Setup has no selection, search or mode tags. */
  selected?: string | null;
  onSelect?: (path: string) => void;
  compact?: boolean;
};

type Row = { node: FolderNode; depth: number; open: boolean };

// Which folders are open, kept for the session (not in settings).
let sessionExpanded: Set<string> | null = null;

export function FolderTree({ tree, library, settings, onToggle, selected = null, onSelect, compact = false }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // At first: folders with a watched entry under them, and the selected folder's parents.
    sessionExpanded ??= new Set(settings.watch.flatMap(ancestorsOf));
    return new Set([...sessionExpanded, ...(selected ? ancestorsOf(selected) : [])]);
  });
  const [query, setQuery] = useState("");
  const [onlyRead, setOnlyRead] = useState(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

  const changeExpanded = (change: (s: Set<string>) => void) =>
    setExpanded((before) => {
      const next = new Set(before);
      change(next);
      sessionExpanded = next;
      return next;
    });

  // A folder selected from elsewhere (a chip, a breadcrumb) is shown, its parents open.
  useEffect(() => {
    if (selected && ancestorsOf(selected).some((a) => !expanded.has(a))) changeExpanded((s) => ancestorsOf(selected).forEach((a) => s.add(a)));
  }, [selected]);

  // ⌘F finds a folder.
  useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact]);

  const filtering = query.trim() !== "" || onlyRead;
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (nodes: FolderNode[], depth: number) => {
      for (const node of nodes) {
        // While searching or filtering, the parents of what's shown are open.
        const open = node.children.length > 0 && (filtering || expanded.has(node.path));
        out.push({ node, depth, open });
        if (open) walk(node.children, depth + 1);
      }
    };
    walk(filterTree(tree, query, onlyRead, settings.watch), 0);
    return out;
  }, [tree, query, onlyRead, settings.watch, expanded, filtering]);

  useEffect(() => {
    const path = pendingFocus.current;
    if (path === null) return;
    pendingFocus.current = null;
    rowEls.current.get(path)?.focus();
  });

  const paths = rows.map((r) => r.node.path);
  const tabStop = [focusPath, selected].find((p) => p !== null && paths.includes(p)) ?? paths[0];

  const goTo = (path: string) => {
    setFocusPath(path);
    pendingFocus.current = path;
    onSelect?.(path);
  };

  const toggleOpen = (path: string, open: boolean) => changeExpanded((s) => (open ? s.add(path) : s.delete(path)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = paths.indexOf(focusPath ?? tabStop ?? "");
    const row = rows[i];
    if (!row) return;
    const path = row.node.path;
    if (e.key === "ArrowDown" && rows[i + 1]) goTo(rows[i + 1].node.path);
    else if (e.key === "ArrowUp" && rows[i - 1]) goTo(rows[i - 1].node.path);
    else if (e.key === "ArrowRight" && row.node.children.length > 0) {
      if (!row.open) toggleOpen(path, true);
      else if (rows[i + 1]) goTo(rows[i + 1].node.path);
    } else if (e.key === "ArrowLeft") {
      if (row.open && !filtering) toggleOpen(path, false);
      else {
        const parent = parentOf(path);
        if (parent && paths.includes(parent)) goTo(parent);
      }
    } else if (e.key === " " || e.key === "Enter") onToggle(path);
    else return;
    e.preventDefault();
  };

  const firstMatch = () => {
    const q = query.trim().toLowerCase();
    return rows.find((r) => r.node.name.toLowerCase().includes(q))?.node.path;
  };

  const empty = query.trim()
    ? `No folder called “${query.trim()}”.`
    : onlyRead
      ? "Jotted isn't reading any folders yet. Tick one to start."
      : "No folders on your reMarkable.";

  return (
    <div className={`folder-tree ${compact ? "folder-tree-compact" : ""}`}>
      {!compact && (
        <div className="tree-tools">
          <div className="tree-search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              ref={search}
              type="search"
              placeholder="Find a folder"
              aria-label="Find a folder"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const hit = firstMatch();
                  if (hit) goTo(hit);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery("");
                }
              }}
            />
          </div>
          <div className="tree-filters" role="group" aria-label="Show">
            <button type="button" aria-pressed={!onlyRead} onClick={() => setOnlyRead(false)}>
              All folders
            </button>
            <button type="button" aria-pressed={onlyRead} onClick={() => setOnlyRead(true)}>
              Being read
            </button>
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="tree-empty">{empty}</p>
      ) : (
        <ul className="tree" role="tree" aria-label="Folders" onKeyDown={onKeyDown}>
          {renderRows(rows, 0, 1)}
        </ul>
      )}
    </div>
  );

  /** Rows from `start` at `level`, with each open folder's children in a group. */
  function renderRows(list: Row[], start: number, level: number): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (let i = start; i < list.length && list[i].depth >= level - 1; i++) {
      const row = list[i];
      if (row.depth !== level - 1) continue;
      const children = row.open ? renderRows(list, i + 1, level + 1) : null;
      out.push(
        <li key={row.node.path} role="none">
          {renderRow(row, level)}
          {children && (
            <ul role="group" className="tree-group">
              {children}
            </ul>
          )}
        </li>,
      );
    }
    return out;
  }

  function renderRow({ node, depth, open }: Row, level: number) {
    const state = folderState(node.path, settings.watch);
    const cover = state === "inherited" ? shortName(coverOf(node.path, settings.watch) ?? "/") : null;
    const isSelected = !compact && selected === node.path;
    let tag: string | null = null;
    if (state === "inherited") tag = `via ${cover}`;
    else if (state === "on" && !compact) tag = modeLabel(node.path, library, settings);
    else if (state === "partial" && !open) tag = `${entriesUnder(node.path, settings.watch).length} inside`;
    return (
      <div
        ref={(el) => void (el ? rowEls.current.set(node.path, el) : rowEls.current.delete(node.path))}
        role="treeitem"
        aria-label={[node.name, tag, `${node.documents} documents`].filter(Boolean).join(", ")}
        className={`tree-row tree-row-${state}`}
        aria-level={level}
        aria-expanded={node.children.length > 0 ? open : undefined}
        aria-selected={compact ? undefined : isSelected}
        tabIndex={node.path === tabStop ? 0 : -1}
        style={{ paddingLeft: 6 + depth * 18 }}
        onFocus={() => setFocusPath(node.path)}
        onClick={() => {
          setFocusPath(node.path);
          onSelect?.(node.path);
        }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="tree-twisty"
            tabIndex={-1}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setFocusPath(node.path);
              pendingFocus.current = node.path;
              if (!filtering) toggleOpen(node.path, !open);
            }}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 1.5 7.5 5 3 8.5z" />
            </svg>
          </button>
        ) : (
          <span className="tree-twisty" aria-hidden="true" />
        )}
        <TreeCheck
          state={state}
          label={state === "inherited" ? `${node.name}, read through ${cover}` : `Read ${node.name}`}
          onClick={() => {
            setFocusPath(node.path);
            pendingFocus.current = node.path;
            onToggle(node.path);
          }}
        />
        <span className="tree-name">
          <span className="tree-name-text">{highlight(node.name, query)}</span>
          {tag && <span className={`tree-tag ${state === "on" ? "tree-tag-mode" : ""}`}>{tag}</span>}
        </span>
        <span className="tree-count" aria-label={`${node.documents} documents`}>
          {node.documents}
        </span>
      </div>
    );
  }
}

function modeLabel(path: string, library: Library, settings: Settings): string {
  const mode = folderMode(path, library, settings.from_now);
  return mode === "from-now" ? "from now on" : mode === "mixed" ? "mixed" : "everything";
}

function highlight(name: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  if (i < 0) return name;
  return (
    <Fragment>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </Fragment>
  );
}

/** The row's box: empty, ticked in ink, ticked in pencil (read through a parent), or mixed. */
function TreeCheck({ state, label, onClick }: { state: FolderState; label: string; onClick: () => void }) {
  const ticked = state === "on" || state === "inherited";
  return (
    <button
      type="button"
      role="checkbox"
      className={`tree-check tree-check-${state}`}
      aria-checked={ticked ? true : state === "partial" ? "mixed" : false}
      aria-disabled={state === "inherited" ? true : undefined}
      aria-label={label}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="tree-check-box" aria-hidden="true" />
      {ticked && (
        <svg viewBox="0 0 28 26" aria-hidden="true">
          <path d="M3 14.5c2.4 1.6 4.6 4.2 6.4 7.4C13.2 13.6 18.4 6.6 25.4 1.8" />
        </svg>
      )}
    </button>
  );
}
