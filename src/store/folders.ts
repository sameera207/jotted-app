// The folder tree and what Jotted reads in it (spec: Notebooks-folder-picker-spec.md › Deriving
// state). Pure functions over `library` and `settings`; path matching is the CLI's
// (`Settings.watches`): an entry covers itself and everything under it, and "/" covers all.

import type { Library, Settings } from "../jotted/types.gen";
import type { WatchAction } from "../jotted/client";

export type FolderNode = { path: string; name: string; documents: number; direct: number; children: FolderNode[] };
export type FolderState = "off" | "on" | "inherited" | "partial";
export type FolderMode = "from-now" | "everything" | "mixed" | "empty";
export type WatchStep = { action: WatchAction; path: string };

/** "/Mable/" → "/Mable"; "/" stays "/". */
export function normalise(path: string): string {
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p.startsWith("/") ? p : `/${p}`;
}

/** Does the watch entry `w` cover `path`? */
export function covers(w: string, path: string): boolean {
  const [e, p] = [normalise(w), normalise(path)];
  return e === "/" || p === e || p.startsWith(`${e}/`);
}

export function parentOf(path: string): string | null {
  const p = normalise(path);
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : null;
}

export function nameOf(path: string): string {
  const p = normalise(path);
  return p === "/" ? "" : p.slice(p.lastIndexOf("/") + 1);
}

/** The folders above `path`, top first. */
export function ancestorsOf(path: string): string[] {
  const out: string[] = [];
  for (let a = parentOf(path); a; a = parentOf(a)) out.unshift(a);
  return out;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Nest `library.folders` by path, adding parents the library doesn't list. */
export function buildTree(folders: Library["folders"]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  const listed = new Set<string>();
  const node = (path: string): FolderNode => {
    let n = nodes.get(path);
    if (!n) nodes.set(path, (n = { path, name: nameOf(path), documents: 0, direct: 0, children: [] }));
    return n;
  };
  for (const f of folders) {
    const path = normalise(f.path);
    if (path === "/") continue;
    node(path).documents = f.documents;
    listed.add(path);
    for (let child = path, parent = parentOf(path); parent; child = parent, parent = parentOf(parent)) {
      const p = node(parent);
      const c = node(child);
      if (!p.children.includes(c)) p.children.push(c);
    }
  }
  const finish = (n: FolderNode): FolderNode => {
    n.children.sort(byName).forEach(finish);
    const under = n.children.reduce((sum, c) => sum + c.documents, 0);
    // A parent the library doesn't list: its count is what's under it.
    if (!listed.has(n.path)) n.documents = under;
    n.direct = Math.max(0, n.documents - under);
    return n;
  };
  return [...nodes.values()].filter((n) => parentOf(n.path) === null).sort(byName).map(finish);
}

/** Every node, depth first, in tree order. */
export function flatten(tree: FolderNode[]): FolderNode[] {
  return tree.flatMap((n) => [n, ...flatten(n.children)]);
}

export function findNode(tree: FolderNode[], path: string): FolderNode | null {
  const p = normalise(path);
  for (const n of tree) {
    if (n.path === p) return n;
    if (p.startsWith(`${n.path}/`)) return findNode(n.children, p);
  }
  return null;
}

/** The entry that covers `path`: itself, or its nearest ancestor ("/" last). */
export function coverOf(path: string, watch: string[]): string | null {
  const hits = watch.filter((w) => covers(w, path));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (normalise(b).length > normalise(a).length ? b : a));
}

/** Watch entries strictly under `path`. */
export function entriesUnder(path: string, watch: string[]): string[] {
  const p = normalise(path);
  return watch.filter((w) => normalise(w) !== p && covers(p, w));
}

export function folderState(path: string, watch: string[]): FolderState {
  const cover = coverOf(path, watch);
  if (cover !== null) return normalise(cover) === normalise(path) ? "on" : "inherited";
  return entriesUnder(path, watch).length > 0 ? "partial" : "off";
}

/** The documents `watch from-now PATH` would cover. */
export function documentsUnder(path: string, library: Library): Library["documents"] {
  return library.documents.filter((d) => covers(path, d.path));
}

/** From now on or Everything, from the documents' IDs in `settings.from_now`. */
export function folderMode(path: string, library: Library, fromNow: string[]): FolderMode {
  const docs = documentsUnder(path, library);
  if (docs.length === 0) return "empty";
  const skipped = new Set(fromNow);
  const n = docs.filter((d) => skipped.has(d.id)).length;
  return n === docs.length ? "from-now" : n === 0 ? "everything" : "mixed";
}

/** Search and Being read: a folder shows when it, or anything under it, matches. */
export function filterTree(tree: FolderNode[], query: string, onlyRead: boolean, watch: string[]): FolderNode[] {
  const q = query.trim().toLowerCase();
  if (!q && !onlyRead) return tree;
  const keep = (n: FolderNode): FolderNode | null => {
    const children = n.children.map(keep).filter((c): c is FolderNode => c !== null);
    const hit = (!q || n.name.toLowerCase().includes(q)) && (!onlyRead || folderState(n.path, watch) !== "off");
    return hit || children.length > 0 ? { ...n, children } : null;
  };
  return tree.map(keep).filter((n): n is FolderNode => n !== null);
}

/** What `settings` would become after `step`, for showing a change before the CLI answers. */
export function applyStep(settings: Settings, step: WatchStep, library: Library | null): Settings {
  const path = normalise(step.path);
  const ids = () => new Set(library ? documentsUnder(path, library).map((d) => d.id) : []);
  switch (step.action) {
    case "add":
      return settings.watch.includes(path) ? settings : { ...settings, watch: [...settings.watch, path] };
    case "remove":
      return { ...settings, watch: settings.watch.filter((w) => normalise(w) !== path) };
    case "from-now":
      return { ...settings, from_now: [...new Set([...settings.from_now, ...ids()])].sort() };
    case "read-all": {
      const gone = ids();
      return { ...settings, from_now: settings.from_now.filter((id) => !gone.has(id)) };
    }
  }
}
