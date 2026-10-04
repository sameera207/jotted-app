// Settings, keys and folders: what Settings, Notebooks and Setup change. Each runs one CLI
// command and keeps what it answers; settings also arrive as settings.changed events.

import * as jotted from "../jotted/client";
import { JottedError } from "../jotted/errors";
import type { Settings } from "../jotted/types.gen";
import { showError, useStore } from "./store";

const set = useStore.setState;
const get = useStore.getState;

type Editable = "poll_interval_s" | "todo_enabled" | "include_others" | "action_threshold";

/** Change a setting at once; put it back if the CLI refuses. */
export async function setSetting<K extends Editable>(key: K, value: Settings[K]): Promise<boolean> {
  const before = get().settings;
  if (!before || before[key] === value) return true;
  set({ settings: { ...before, [key]: value } });
  try {
    set({ settings: await jotted.settingsSet(key, JSON.stringify(value)) });
    return true;
  } catch (e) {
    set({ settings: before });
    showError(e);
    return false;
  }
}

/** A key on stdin; returns the error message to show by the field, or null when saved.
 *  The key itself is never kept: the caller clears its field either way. */
export async function saveKey(which: "llm" | "jev", key: string): Promise<string | null> {
  const clean = key.trim();
  if (!clean) return "Paste a key first.";
  try {
    set({ ai: await jotted.aiKey(which, clean) });
    return null;
  } catch (e) {
    return keyError(e);
  }
}

/** A refused key, or a provider or tablet that can't be reached, goes by the field. */
function keyError(e: unknown): string {
  const byField = ["model_error", "invalid", "not_connected", "busy", "conflict"];
  if (e instanceof JottedError && byField.includes(e.code)) return e.message;
  showError(e);
  return e instanceof Error ? e.message : String(e);
}

export async function removeJev() {
  try {
    set({ ai: await jotted.aiRemove("jev") });
  } catch (e) {
    showError(e);
  }
}

/** Provider and model: run only what changed. Returns an error message, or null. */
export async function chooseModel(provider: string, model: string): Promise<string | null> {
  const llm = get().ai?.llm;
  try {
    if (llm && provider !== llm.provider) set({ ai: await jotted.aiProvider(provider) });
    const clean = model.trim();
    if (clean && clean !== get().ai?.llm.model) set({ ai: await jotted.aiModel(clean) });
    return null;
  } catch (e) {
    return keyError(e);
  }
}

export async function reloadAi() {
  try {
    set({ ai: await jotted.ai() });
  } catch (e) {
    showError(e);
  }
}

export async function loadLibrary(): Promise<boolean> {
  try {
    set({ library: await jotted.library() });
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}

/** Read a folder (or stop), and From now on / Everything. Keeps the settings it answers. */
export async function watchFolder(action: jotted.WatchAction, path: string) {
  const before = get().settings;
  // Show the change at once: the folder's tick and its From now on / Everything.
  if (before) {
    const watch = action === "add" ? [...new Set([...before.watch, path])] : action === "remove" ? before.watch.filter((p) => p !== path) : before.watch;
    // `watch add` leaves from_now alone (the CLI reads the folder's earlier pages too).
    const from_now =
      action === "from-now" ? [...new Set([...before.from_now, path])] : action === "add" ? before.from_now : before.from_now.filter((p) => p !== path);
    set({ settings: { ...before, watch, from_now } });
  }
  try {
    const result = await jotted.watch(action, path);
    set({ settings: "settings" in result ? result.settings : result });
    void loadLibrary();
    void reloadStatus();
  } catch (e) {
    if (before) set({ settings: before });
    showError(e);
  }
}

async function reloadStatus() {
  try {
    set({ status: await jotted.status() });
  } catch {
    // the title bar keeps the last one
  }
}
