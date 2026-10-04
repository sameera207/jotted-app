// CLI updates (specs/CLI-updates-spec.md): the Rust side checks, downloads, verifies, switches
// and restarts; this keeps its status for Settings and shows its notes.

import * as jotted from "../jotted/client";
import { cliUpdate, onCliUpdate } from "../platform";
import { claudeState } from "./labels";
import { notify, showError, useStore } from "./store";

const set = useStore.setState;
let listening = false;

/** After the list loads (main window only): listen, then check once. */
export async function startCliUpdates() {
  if (!listening) {
    listening = true;
    void onCliUpdate((status, note) => {
      set({ cliUpdate: status });
      if (note) void announce(note);
    });
  }
  try {
    set({ cliUpdate: await cliUpdate("cli_update_status") });
    set({ cliUpdate: await cliUpdate("cli_update_check") });
  } catch {
    // offline or off: Settings shows the last status
  }
}

/** "Jotted updated to X." — and, with Claude connected, that it needs a restart to see it. */
async function announce(note: string) {
  const { claude, dataEnv } = useStore.getState();
  const connected = claude && claudeState(claude, dataEnv).kind === "connected";
  notify(connected ? `${note} Quit and reopen Claude Desktop to use it there.` : note);
  try {
    set({ version: await jotted.version() }); // what runs now
  } catch {
    // the title bar keeps the last one
  }
}

export async function cliUpdateAction(command: "cli_update_check" | "cli_update_install" | "cli_update_set_auto" | "cli_update_retry", args: Record<string, unknown> = {}) {
  try {
    set({ cliUpdate: await cliUpdate(command, args) });
  } catch (e) {
    showError(e);
  }
}
