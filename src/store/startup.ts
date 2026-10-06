// Start-up (spec: Architecture › Start-up).
//
// 1. `version`: stop with "needs updating" unless its contract is one this app supports.
// 2. `setup status`: incomplete → Setup (after the Welcome screen, the first time, unless the
//    person has nothing left to give: an existing jotted folder missing only what
//    `setup prepare` does on its own).
// 3. Read the latest event cursor, then load the store (items, proposals, settings, ai, status).
// 4. Start the server and the events follower from that cursor, so nothing that changed
//    while loading is missed. (A cursor saved across launches would add nothing: the list
//    is reloaded at every start anyway.)
// 5. Read Claude Desktop's connection (`claude status`), and offer Repair if it's stale.

import * as jotted from "../jotted/client";
import { JottedError } from "../jotted/errors";
import type { SetupStep } from "../jotted/types.gen";
import { parseEvent } from "../jotted/events";
import { transport } from "../jotted/transport";
import { startCliUpdates } from "./cliUpdate";
import { readPrefs, writePrefs } from "./prefs";
import { applyEvent, byId, checkClaudeAtStartup, checkNow, setServe, showError, useStore } from "./store";

/** Contract versions this app is built for. */
export const SUPPORTED_CONTRACTS = [1];

let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  transport().onEvent((raw) => {
    const event = parseEvent(raw);
    if (event) void applyEvent(event);
  });
  transport().onServe(setServe);
}

export async function startup(): Promise<void> {
  const set = useStore.setState;
  set({ phase: { kind: "starting" } });
  try {
    const version = await jotted.version();
    set({ version });
    if (!SUPPORTED_CONTRACTS.includes(version.contract)) {
      set({ phase: { kind: "needs-update", contract: version.contract } });
      return;
    }
    const setup = await jotted.setupStatus();
    if (!setup.complete) {
      // The Welcome screen once, on first launch; after that straight to Setup.
      if (!readPrefs().welcomed && setup.steps.some(needsPerson)) {
        set({ phase: { kind: "welcome" } });
        return;
      }
      const step = setup.steps.find((s) => !s.done && !s.optional)?.id;
      set({ phase: { kind: "setup", step, setup } });
      return;
    }

    listen();
    const cursor = await jotted.latestCursor();
    const [items, proposed, settings, ai, status] = await Promise.all([
      jotted.items({ status: "all" }),
      jotted.itemsProposed(),
      jotted.settings(),
      jotted.ai(),
      jotted.status(),
    ]);
    set({ items: byId(items), proposed: byId(proposed), settings, ai, status, phase: { kind: "ready" } });
    await transport().startBackground(cursor);
    void checkClaudeAtStartup(); // after the list, never holding it up
    void startCliUpdates();
  } catch (e) {
    if (e instanceof JottedError && e.code === "not_set_up") {
      showError(e);
      return;
    }
    set({ phase: { kind: "failed", message: e instanceof Error ? e.message : String(e) } });
  }
}

/** A step only the person can do: `setup prepare` does the rest without asking. */
export function needsPerson(step: SetupStep): boolean {
  return !step.done && !step.optional && step.command !== "setup prepare";
}

/** Welcome → Setup. */
export function startSetup() {
  writePrefs({ welcomed: true });
  useStore.setState({ phase: { kind: "setup" } });
}

/** Setup is complete: start like any launch, then check the tablet once. */
export async function finishSetup() {
  await startup();
  if (useStore.getState().phase.kind === "ready") void checkNow();
}

/** The menu bar popover: its own window, so its own store. It loads the list and listens to
 *  the same events; the main window owns `jotted serve` and the follower. */
export async function startupTray(): Promise<void> {
  const set = useStore.setState;
  try {
    const setup = await jotted.setupStatus();
    if (!setup.complete) {
      set({ phase: { kind: "setup", setup } });
      return;
    }
    listen();
    const [items, proposed, status] = await Promise.all([jotted.items({ status: "all" }), jotted.itemsProposed(), jotted.status()]);
    set({ items: byId(items), proposed: byId(proposed), status, phase: { kind: "ready" } });
  } catch (e) {
    set({ phase: { kind: "failed", message: e instanceof Error ? e.message : String(e) } });
  }
}
