// The one store: every item on the list (open and done), proposals (kept apart: they're never
// on the sheet), settings, ai, status, setup, sync state, Claude Desktop's connection, and
// what's on screen because something went wrong. Filters are applied by the screens.

import { create } from "zustand";
import * as jotted from "../jotted/client";
import { handlingFor, JottedError, type Handling } from "../jotted/errors";
import type { JottedEvent } from "../jotted/events";
import type { ServeState } from "../jotted/transport";
import { transport, type DataEnv } from "../jotted/transport";
import type { CliUpdate } from "../platform";
import type { Ai, Data, Item, Library, Settings, SetupStatus, Status, Version } from "../jotted/types.gen";
import { claudeState } from "./labels";
import { readPrefs, writePrefs } from "./prefs";

export type Phase =
  | { kind: "starting" }
  | { kind: "needs-update"; contract: number }
  | { kind: "welcome" }
  | { kind: "setup"; step?: string; setup?: SetupStatus; /** Settings' Reconnect: only the connect step, replacing. */ reconnect?: boolean }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

export type Banner = { id: string; message: string; action: "reconnect" | "check-key" | null };

export type ClaudeStatus = Data["claude status"];
/** What the last Claude Desktop action said, shown where it was taken. */
export type ClaudeNote = {
  tone: "ok" | "error";
  text: string;
  /** Under "Details": the backup Jotted made of Claude's settings. */
  details?: string;
  /** "Show in Finder" on this file (Claude's settings file that isn't valid JSON). */
  reveal?: string;
};

export type State = {
  phase: Phase;
  version: Version | null;
  items: Record<number, Item>;
  /** Proposed items, by id. Never on the sheet: they have no row on the tablet. */
  proposed: Record<number, Item>;
  settings: Settings | null;
  ai: Ai | null;
  status: Status | null;
  /** The device's folders and documents (`library`), loaded when Notebooks opens. */
  library: Library | null;
  sync: "idle" | "checking";
  /** "Clear done" is printing a fresh To-do document. */
  printingFresh: boolean;
  serve: ServeState | null;
  banners: Banner[];
  /** An error by the row (or "new" for the add row) where the action was taken. */
  rowErrors: Record<string, string>;
  panel: string | null;
  /** The last `claude status`, or null before it answers (or when it failed). */
  claude: ClaudeStatus | null;
  claudeBusy: boolean;
  /** The data folder the app runs jotted with, to compare with Claude's entry. */
  dataEnv: DataEnv | null;
  claudeNote: ClaudeNote | null;
  /** The start-up check found a stale entry: offer Repair on the To-do window, this launch. */
  claudeRepairOffered: boolean;
  /** "Not now" on the post-setup card (kept across launches). */
  claudeCardHidden: boolean;
  /** Bumped by "Review" (Settings, tray): the panel opens and scrolls into view. */
  proposalsFocus: number;
  /** Open "Where it came from" for this item (from the menu bar popover); `n` makes each ask new. */
  peekRequest: { id: number; n: number } | null;
  /** CLI updates, or null where there are none (a browser). */
  cliUpdate: CliUpdate | null;
};

export const initialState: State = {
  phase: { kind: "starting" },
  version: null,
  items: {},
  proposed: {},
  settings: null,
  ai: null,
  status: null,
  library: null,
  sync: "idle",
  printingFresh: false,
  serve: null,
  banners: [],
  rowErrors: {},
  panel: null,
  claude: null,
  claudeBusy: false,
  dataEnv: null,
  claudeNote: null,
  claudeRepairOffered: false,
  claudeCardHidden: false,
  proposalsFocus: 0,
  peekRequest: null,
  cliUpdate: null,
};

export const useStore = create<State>(() => initialState);
const set = useStore.setState;
const get = useStore.getState;

export function byId(list: Item[]): Record<number, Item> {
  return Object.fromEntries(list.map((i) => [i.id, i]));
}

function addBanner(message: string, action: Banner["action"]) {
  const id = `${action ?? "info"}:${message}`;
  set((s) => ({ banners: [...s.banners.filter((b) => b.id !== id), { id, message, action }] }));
}

export function dismissBanner(id: string) {
  set((s) => ({ banners: s.banners.filter((b) => b.id !== id) }));
}

export function closePanel() {
  set({ panel: null });
}

/** Show a message in a banner with no action. */
export function notify(message: string) {
  addBanner(message, null);
}

export function clearRowError(key: string) {
  set((s) => {
    const { [key]: _gone, ...rest } = s.rowErrors;
    return { rowErrors: rest };
  });
}

/** Show an error the way its code says to (spec: Errors). `where` is the row it came from. */
export function showError(error: unknown, where?: string): Handling {
  const h = handlingFor(error);
  if (h.kind === "setup") set({ phase: { kind: "setup", step: h.step } });
  if (h.kind === "banner") addBanner(h.message, h.action);
  if (h.kind === "inline") {
    if (where) set((s) => ({ rowErrors: { ...s.rowErrors, [where]: h.message } }));
    else addBanner(h.message, null);
  }
  if (h.kind === "panel") set({ panel: h.message });
  return h;
}

// ---------------------------------------------------------------- events

/** The store change for one event (spec: Store). */
export function reduce(state: State, event: JottedEvent): Partial<State> {
  switch (event.type) {
    case "item.added":
    case "item.changed":
      return { items: { ...state.items, [event.item.id]: event.item }, proposed: without(state.proposed, event.item.id) };
    case "item.proposed":
      return { proposed: { ...state.proposed, [event.item.id]: event.item } };
    case "item.accepted":
      // The item.added that follows puts it on the list.
      return { proposed: without(state.proposed, event.item.id) };
    case "item.removed":
      // A dismissed item, or a dismissed proposal.
      return { items: without(state.items, event.item.id), proposed: without(state.proposed, event.item.id) };
    case "check.started":
      return { sync: "checking" };
    case "check.finished":
      return { sync: "idle" };
    case "settings.changed":
      return { settings: event.settings };
    default:
      return {};
  }
}

function without(record: Record<number, Item>, id: number): Record<number, Item> {
  if (!(id in record)) return record;
  const { [id]: _gone, ...rest } = record;
  return rest;
}

export async function applyEvent(event: JottedEvent) {
  set((s) => reduce(s, event));
  if (event.type === "check.finished" || event.type === "todo.published") void reloadStatus();
  if (event.type === "check.finished" && event.errors > 0) {
    // The source's own source.error event carries the message; this only says it happened.
    addBanner(`The last check had ${event.errors} problem${event.errors === 1 ? "" : "s"}.`, null);
  }
  if (event.type === "source.error") addBanner(event.message, null);
}

export async function reloadStatus() {
  try {
    set({ status: await jotted.status() });
  } catch (e) {
    showError(e);
  }
}

export function setServe(serve: ServeState) {
  set({ serve });
  if (serve === "failed") {
    addBanner("Jotted's background server stopped. Everything still works, a little slower.", null);
  }
}

// ---------------------------------------------------------------- actions
//
// Ticks, edits, adds and dismissals are optimistic: the store changes at once, the
// command runs, and an error undoes the change.

let tempId = -1;

function putItem(item: Item) {
  set((s) => ({ items: { ...s.items, [item.id]: item } }));
}

function removeItem(id: number) {
  set((s) => {
    const { [id]: _gone, ...items } = s.items;
    return { items };
  });
}

async function optimistic(id: number, change: Partial<Item>, command: () => Promise<Item>) {
  const before = get().items[id];
  if (!before) return;
  clearRowError(String(id));
  putItem({ ...before, ...change });
  try {
    putItem(await command());
  } catch (e) {
    putItem(before);
    showError(e, String(id));
  }
}

/** "Someone else's" (with a name when given) or "Mine". */
export function setOwner(id: number, owner: "mine" | "others", name?: string) {
  const change: Partial<Item> = owner === "mine" ? { owner: "me", owner_name: null } : { owner: "someone_else", owner_name: name ?? null };
  return optimistic(id, change, () => jotted.itemsSetOwner(id, owner, name));
}

export const tick = (id: number) => optimistic(id, { status: "done" }, () => jotted.itemsDone(id));
export const reopen = (id: number) => optimistic(id, { status: "open" }, () => jotted.itemsReopen(id));

export function edit(id: number, text: string) {
  const clean = text.trim();
  const item = get().items[id];
  if (!item || !clean || clean === item.text) return Promise.resolve();
  return optimistic(id, { text: clean, edited: true }, () => jotted.itemsEdit(id, clean));
}

export async function dismiss(id: number) {
  const before = get().items[id];
  if (!before) return;
  clearRowError(String(id));
  removeItem(id);
  try {
    await jotted.itemsDismiss(id);
  } catch (e) {
    putItem(before);
    showError(e, String(id));
  }
}

/** Add an item of yours. Returns false if it failed (the text stays in the field). */
export async function add(text: string): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  clearRowError("new");
  const id = tempId--;
  putItem({
    id,
    origin: "web",
    text: clean,
    paper_text: clean,
    written: false,
    status: "open",
    owner: "me",
    owner_name: null,
    p_action: 1,
    source: { doc_id: "web", name: "", folder: "", page: 0, anchor: "", kind: null, key: null, title: null, url: null, excerpt: null },
    page: null,
    edited: false,
    slot: null,
    created_at: new Date().toISOString(),
  });
  try {
    const item = await jotted.itemsAdd(clean);
    removeItem(id);
    putItem(item);
    return true;
  } catch (e) {
    removeItem(id);
    showError(e, "new");
    return false;
  }
}

export async function checkNow() {
  if (get().sync === "checking") return;
  set({ sync: "checking" }); // the events say so too; this makes the button respond at once
  try {
    await jotted.check();
  } catch (e) {
    set({ sync: "idle" });
    showError(e);
  }
}

/** "Clear done": read the paper, then reprint the To-do document with open items only. */
export async function printFresh(): Promise<boolean> {
  if (get().printingFresh) return false;
  set({ printingFresh: true });
  try {
    const result = await jotted.todoFresh();
    if (result.enabled === false) {
      notify(result.unsupported ? "This reMarkable has no To-do document to print." : "The To-do document is off. Turn it on in Settings.");
      return false;
    }
    const n = result.items ?? Object.values(get().items).filter((i) => i.status === "open").length;
    const overflow = result.overflow ? `; ${result.overflow} didn't fit` : "";
    notify(`Printed a fresh list with ${n} open item${n === 1 ? "" : "s"}${overflow}`);
    return true;
  } catch (e) {
    showError(e);
    return false;
  } finally {
    set({ printingFresh: false });
  }
}

// ---------------------------------------------------------------- proposals
//
// Accept and Dismiss are optimistic too. A `conflict` or `not_found` means someone dealt with
// it elsewhere (in Claude, most likely): reload the proposals quietly instead of an error.

export function requestPeek(id: number) {
  set((s) => ({ peekRequest: { id, n: (s.peekRequest?.n ?? 0) + 1 } }));
}

export function reviewProposals() {
  set((s) => ({ proposalsFocus: s.proposalsFocus + 1 }));
}

export async function reloadProposed() {
  try {
    set({ proposed: byId(await jotted.itemsProposed()) });
  } catch (e) {
    showError(e);
  }
}

const handledElsewhere = (e: unknown) => e instanceof JottedError && (e.code === "conflict" || e.code === "not_found");

/** Accept exactly these proposals: the ones on screen. Accepted items arrive as item.added. */
export async function acceptProposals(ids: number[]) {
  const before = get().proposed;
  const shown = ids.filter((id) => id in before);
  if (shown.length === 0) return;
  shown.forEach((id) => clearRowError(`p${id}`));
  set((s) => ({ proposed: shown.reduce(without, s.proposed) }));
  try {
    const result = await jotted.itemsAccept(shown);
    if (result.skipped.length > 0) void reloadProposed();
  } catch (e) {
    if (handledElsewhere(e)) return void reloadProposed();
    set((s) => ({ proposed: { ...s.proposed, ...Object.fromEntries(shown.map((id) => [id, before[id]])) } }));
    showError(e, shown.length === 1 ? `p${shown[0]}` : undefined);
  }
}

export async function dismissProposal(id: number) {
  const before = get().proposed[id];
  if (!before) return;
  clearRowError(`p${id}`);
  set((s) => ({ proposed: without(s.proposed, id) }));
  try {
    await jotted.itemsDismiss(id);
  } catch (e) {
    if (handledElsewhere(e)) return void reloadProposed();
    set((s) => ({ proposed: { ...s.proposed, [id]: before } }));
    showError(e, `p${id}`);
  }
}

// ---------------------------------------------------------------- Claude Desktop
//
// The app never changes Claude's settings on its own: connect and disconnect run only from a
// button the person pressed. Start-up only reads `claude status` and offers Repair.

/** Run `claude status`. Quiet: a failure leaves `claude` null and says why in the note. */
export async function loadClaude(): Promise<ClaudeStatus | null> {
  try {
    const [claude, dataEnv] = await Promise.all([jotted.claudeStatus(), get().dataEnv ?? transport().dataEnv().catch(() => null)]);
    set({ claude, dataEnv });
    return claude;
  } catch (e) {
    set((s) => ({ claude: null, claudeNote: connectFailure(e, s.claude?.config_path) ?? s.claudeNote }));
    return null;
  }
}

/** After the list loads, never blocking it: read the connection and offer Repair if stale. */
export async function checkClaudeAtStartup() {
  set({ claudeCardHidden: readPrefs().claudeCardHidden });
  const claude = await loadClaude();
  if (!claude) return;
  const state = claudeState(claude, get().dataEnv);
  if (state.kind === "repair") set({ claudeRepairOffered: true });
  // After an update that moves the CLI pin, Claude still runs the old jotted until restarted.
  const version = get().version?.version ?? null;
  const seen = readPrefs().claudeSeenVersion;
  if (state.kind === "connected" && version && seen && seen !== version) {
    addBanner("Quit and reopen Claude Desktop to use the new version of Jotted there.", null);
  }
  if (state.kind === "connected" && version) writePrefs({ claudeSeenVersion: version });
}

export function hideClaudeCard() {
  writePrefs({ claudeCardHidden: true });
  set({ claudeCardHidden: true });
}

export function hideClaudeRepair() {
  set({ claudeRepairOffered: false }); // until the next launch; Settings › Claude still says so
}

/** The note for a failed connect or status, or null when the error goes the usual way. */
function connectFailure(e: unknown, configPath?: string): ClaudeNote | null {
  if (!(e instanceof JottedError)) return null;
  // Claude Desktop isn't installed, or its settings file isn't valid JSON (left untouched).
  // The error doesn't carry the file's path; the last status does.
  if (e.code === "config") return { tone: "error", text: e.message, reveal: configPath };
  return null;
}

/** Connect (or Repair, or "Use this app's Jotted"): only ever from a button press. */
export async function connectClaude(opts: { admin?: boolean } = {}): Promise<boolean> {
  if (get().claudeBusy) return false;
  set({ claudeBusy: true, claudeNote: null });
  try {
    let command: string | null;
    try {
      command = await transport().bundlePath();
    } catch (e) {
      // Still in the disk image, or translocated: the path would vanish.
      set({ claudeNote: { tone: "error", text: e instanceof Error ? e.message : String(e) } });
      return false;
    }
    const admin = opts.admin ?? get().claude?.admin ?? false;
    const result = await jotted.claudeConnect({ command, admin });
    set({
      claudeRepairOffered: false,
      claudeNote: result.changed
        ? { tone: "ok", text: "Connected. Quit and reopen Claude Desktop to use Jotted there.", details: result.backup_path ?? undefined }
        : { tone: "ok", text: "Already connected." },
    });
    const version = get().version?.version;
    if (version) writePrefs({ claudeSeenVersion: version });
    await loadClaude();
    return true;
  } catch (e) {
    const note = connectFailure(e, get().claude?.config_path);
    if (note) set({ claudeNote: note });
    else if (e instanceof JottedError && e.code === "invalid") {
      set({ panel: `The Jotted inside this app is missing or damaged (${e.message}). Reinstall Jotted.` });
    } else showError(e);
    return false;
  } finally {
    set({ claudeBusy: false });
  }
}

export async function disconnectClaude() {
  if (get().claudeBusy) return;
  set({ claudeBusy: true, claudeNote: null });
  try {
    const result = await jotted.claudeDisconnect();
    set({
      claudeNote: result.changed
        ? { tone: "ok", text: "Disconnected. Quit and reopen Claude Desktop.", details: result.backup_path ?? undefined }
        : { tone: "ok", text: "Claude Desktop wasn't running Jotted." },
    });
    await loadClaude();
  } catch (e) {
    const note = connectFailure(e, get().claude?.config_path);
    if (note) set({ claudeNote: note });
    else showError(e);
  } finally {
    set({ claudeBusy: false });
  }
}

/** Items Claude adds: straight away (`auto`) or proposed first (`propose_all`). */
export async function setAddMode(mode: Settings["mcp_add_mode"]) {
  const before = get().settings;
  if (!before || before.mcp_add_mode === mode) return;
  set({ settings: { ...before, mcp_add_mode: mode } });
  try {
    set({ settings: await jotted.settingsSet("mcp_add_mode", mode) });
  } catch (e) {
    set({ settings: before });
    showError(e);
  }
}
