// One typed function per jotted command the app uses. Each returns the command's `data`,
// or throws JottedError. tests/unit/schema.test.ts checks every command and option used
// here exists in vendor/jotted/schema.json.

import { JottedError } from "./errors";
import { transport } from "./transport";
import type { Data } from "./types.gen";

/** `busy` is retried after these waits (ms) before it reaches the screen. */
export const BUSY_WAITS = [1000, 2000, 4000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run<T>(args: string[], stdin?: string): Promise<T> {
  const command = args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
  for (let attempt = 0; ; attempt++) {
    const envelope = await transport().run(args, stdin);
    if (envelope.ok) return envelope.data as T;
    if (envelope.error.code === "busy" && attempt < BUSY_WAITS.length) {
      await sleep(BUSY_WAITS[attempt]);
      continue;
    }
    throw new JottedError(command, envelope.error);
  }
}

export type ItemsFilter = { status?: "open" | "done" | "all" | "proposed"; owner?: "mine" | "others"; folder?: string };

export const version = () => run<Data["version"]>(["version"]);
export const setupStatus = () => run<Data["setup status"]>(["setup", "status"]);

export const items = (filter: ItemsFilter = {}) =>
  run<Data["items"]>([
    "items",
    ...(filter.status ? ["--status", filter.status] : []),
    ...(filter.owner ? ["--owner", filter.owner] : []),
    ...(filter.folder ? ["--folder", filter.folder] : []),
  ]);
/** Proposed items (an agent found them; they wait for the person). Never on the list. */
export const itemsProposed = () => run<Data["items"]>(["items", "--status", "proposed"]);
export const itemsGet = (id: number) => run<Data["items get"]>(["items", "get", String(id)]);
/** Accept exactly these proposals: never `--all`, so nothing unseen is accepted. */
export const itemsAccept = (ids: number[]) => run<Data["items accept"]>(["items", "accept", ...ids.map(String)]);
export const itemsAdd = (text: string) => run<Data["items add"]>(["items", "add", text]);
export const itemsEdit = (id: number, text: string) => run<Data["items edit"]>(["items", "edit", String(id), text]);
export const itemsDone = (id: number) => run<Data["items done"]>(["items", "done", String(id)]);
export const itemsReopen = (id: number) => run<Data["items reopen"]>(["items", "reopen", String(id)]);
export const itemsDismiss = (id: number) => run<Data["items dismiss"]>(["items", "dismiss", String(id)]);

/** Someone else's (with a name, if known) or mine. */
export const itemsSetOwner = (id: number, owner: "mine" | "others", name?: string) =>
  run<Data["items edit"]>(["items", "edit", String(id), "--owner", owner, ...(name ? ["--owner-name", name] : [])]);

export const settings = () => run<Data["settings"]>(["settings"]);
export const settingsSet = (key: string, value: string) => run<Data["settings set"]>(["settings", "set", key, value]);
export const ai = () => run<Data["ai"]>(["ai"]);
export const status = () => run<Data["status"]>(["status"]);
export const check = () => run<Data["check"]>(["check"]);
/** Read the paper, then print the To-do document again with open items only. Done items stay done. */
export const todoFresh = () => run<Data["todo"]>(["todo", "--fresh"]);

export const claudeStatus = () => run<Data["claude status"]>(["claude", "status"]);
/** `command`: the bundled jotted Claude should run; omitted, the CLI uses its own path. */
export const claudeConnect = (opts: { command?: string | null; admin?: boolean; dryRun?: boolean } = {}) =>
  run<Data["claude connect"]>([
    "claude",
    "connect",
    ...(opts.command ? ["--command", opts.command] : []),
    ...(opts.admin ? ["--admin"] : []),
    ...(opts.dryRun ? ["--dry-run"] : []),
  ]);
export const claudeDisconnect = () => run<Data["claude disconnect"]>(["claude", "disconnect"]);

/** The latest event cursor, read before loading so the follower misses nothing. */
export const latestCursor = async () => (await run<Data["events"]>(["events"])).cursor;

export const setupPrepare = () => run<Data["setup prepare"]>(["setup", "prepare"]);
/** The one-time code goes on stdin. `replace` swaps out an existing connection. */
export const connect = (code: string, opts: { replace?: boolean } = {}) =>
  run<Data["connect"]>(["connect", "--stdin", ...(opts.replace ? ["--replace"] : [])], code);
/** Keys go on stdin; the CLI checks them with the provider before saving. */
export const aiKey = (which: "llm" | "jev", key: string) => run<Data["ai key"]>(["ai", "key", which, "--stdin"], key);
export const aiRemove = (which: "jev") => run<Data["ai remove"]>(["ai", "remove", which]);
export const aiProvider = (name: string) => run<Data["ai provider"]>(["ai", "provider", name]);
export const aiModel = (name: string) => run<Data["ai model"]>(["ai", "model", name]);

export const library = () => run<Data["library"]>(["library"]);
export type WatchAction = "add" | "remove" | "from-now" | "read-all";
export const watch = (action: WatchAction, path: string) => run<Data["watch"]>(["watch", action, path]);

/** A notebook page as SVG, with `anchor`'s line highlighted. Only pages Jotted has read. */
export const imagePage = (docId: string, page: number, opts: { anchor?: string; width?: number } = {}) =>
  run<{ svg: string }>([
    "image",
    "page",
    docId,
    String(page),
    ...(opts.anchor ? ["--anchor", opts.anchor] : []),
    ...(opts.width ? ["--width", String(opts.width)] : []),
  ]);

export const imageLine = (docId: string, anchor: string) =>
  run<{ svg: string }>(["image", "line", docId, anchor]);
