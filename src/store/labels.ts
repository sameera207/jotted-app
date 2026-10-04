// Words and layout derived from items: source lines, owners, filters, To-do pages.

import type { DataEnv } from "../jotted/transport";
import type { Data, Item, Status } from "../jotted/types.gen";

export type StatusFilter = "open" | "done" | "all";
export type OwnerFilter = "everyone" | "mine" | "others";

/** The To-do document's rows per page and pages. Hard-coded until `status.todo` says
 *  (asked of jotted-cli: capacity and page count in status.todo). */
export const ROWS_PER_PAGE = 20;
export const TODO_PAGES = 2;

export function passes(item: Item, status: StatusFilter, owner: OwnerFilter): boolean {
  if (status !== "all" && item.status !== status) return false;
  // `unclear` shows in Mine, with a "?" mark.
  if (owner === "mine" && item.owner === "someone_else") return false;
  if (owner === "others" && item.owner !== "someone_else") return false;
  return true;
}

/** The folder path as a person reads it: "/Meeting Notes/2026" → "Meeting Notes › 2026". */
export function folderLabel(folder: string): string {
  return folder.split("/").filter(Boolean).join(" › ");
}

export function isOnTodoDocument(item: Item, status: Status | null): boolean {
  return !!status && item.source.name === status.todo.name && item.source.folder === status.todo.folder;
}

export type SourceLabel =
  | { kind: "added"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "todo"; text: string }
  | { kind: "page"; text: string };

/** The line under an item's text: where it came from. */
export function sourceLabel(item: Item, status: Status | null): SourceLabel {
  if (item.origin === "web") return { kind: "added", text: "Added in Jotted" };
  if (item.origin === "agent") {
    // "from Claude · Doc · Platform sync, 29 Sep", or just "Added by Claude" for one it was asked to add.
    const kind = sourceKindLabel(item.source.kind);
    const parts = [kind, item.source.title].filter(Boolean);
    return { kind: "agent", text: parts.length ? ["from Claude", ...parts].join(" · ") : "Added by Claude" };
  }
  if (isOnTodoDocument(item, status)) {
    // The CLI doesn't say which To-do document is the current one yet, so every row from a
    // To-do document reads as written on it.
    const row = item.slot === null ? "" : ` · row ${(item.slot % ROWS_PER_PAGE) + 1}`;
    return { kind: "todo", text: `Written on the To-do${row}` };
  }
  const where = [folderLabel(item.source.folder), item.source.name].filter(Boolean).join(" › ");
  return { kind: "page", text: `${where} · p${item.source.page}` };
}

export function ownerLabel(item: Item): string | null {
  if (item.owner !== "someone_else") return null;
  const name = item.owner_name?.trim();
  return name ? `→ ${name}` : "→ Someone else";
}

const SOURCE_KINDS: Record<string, string> = {
  doc: "Doc",
  gdoc: "Doc",
  mail: "Mail",
  gmail: "Mail",
  calendar: "Calendar",
  gcal: "Calendar",
  jira: "Jira",
  confluence: "Confluence",
  chat: "Chat",
};

/** An agent's `source.kind` as a person reads it; kinds this app doesn't know read "Other". */
export function sourceKindLabel(kind: string | null): string | null {
  if (!kind) return null;
  return SOURCE_KINDS[kind.toLowerCase()] ?? "Other";
}

/** The link to open, only when it is https. Agents copied it from someone else's document. */
export function httpsUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** What Claude Desktop runs, from `claude status` (spec: Claude Desktop › Status and repair). */
export type ClaudeState =
  | { kind: "not-connected" }
  | { kind: "connected"; admin: boolean }
  | { kind: "repair"; reason: "missing" | "other-app" }
  | { kind: "another"; command: string }
  | { kind: "other-data"; config: string | null; home: string | null };

/** `env`: the app's own data folder variables; when given, an entry made for another data
 *  folder (another JOTTED_CONFIG or JOTTED_HOME) isn't "connected": Claude sees another list. */
export function claudeState(status: Data["claude status"], env?: DataEnv | null): ClaudeState {
  if (!status.configured) return { kind: "not-connected" };
  if (!status.command_exists) return { kind: "repair", reason: "missing" };
  if (status.matches_current) {
    const entry = status.env as Record<string, string | undefined>;
    const config = entry.JOTTED_CONFIG || null;
    const home = entry.JOTTED_HOME || null;
    if (env && (config !== env.config || home !== env.home)) return { kind: "other-data", config, home };
    return { kind: "connected", admin: status.admin };
  }
  const command = status.command ?? "";
  if (command.includes("/Jotted.app/")) return { kind: "repair", reason: "other-app" };
  return { kind: "another", command };
}

export const REPAIR_MESSAGES = {
  missing: "Claude can't find Jotted. The app was moved or reinstalled.",
  "other-app": "Claude runs another copy of the Jotted app.",
} as const;

/** Paper order: slotted rows by slot, then the rest oldest first. */
export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (a.slot !== null && b.slot !== null) return a.slot - b.slot;
    if (a.slot !== null) return -1;
    if (b.slot !== null) return 1;
    return a.created_at.localeCompare(b.created_at) || a.id - b.id;
  });
}

/** Split the sheet into the To-do document's pages: a row goes on its slot's page; a row
 *  with no slot yet goes on the first page with room, where the CLI will most likely put it
 *  (it gives new items the first free slots). */
export function paginate(items: Item[]): Item[][] {
  const slotted = items.filter((i) => i.slot !== null);
  const lastSlotPage = Math.max(-1, ...slotted.map((i) => Math.floor(i.slot! / ROWS_PER_PAGE)));
  const pages: Item[][] = Array.from({ length: Math.max(TODO_PAGES, lastSlotPage + 1) }, () => []);
  for (const item of sortItems(items)) {
    if (item.slot !== null) {
      pages[Math.floor(item.slot / ROWS_PER_PAGE)].push(item);
      continue;
    }
    let page = pages.findIndex((p) => p.length < ROWS_PER_PAGE);
    if (page < 0) page = pages.push([]) - 1;
    pages[page].push(item);
  }
  return pages;
}
/** "2 min ago", "just now", "3 h ago", or a date. */
export function ago(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 60 * 60) return `${Math.round(s / 60)} min ago`;
  if (s < 24 * 60 * 60) return `${Math.round(s / 3600)} h ago`;
  return `on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
