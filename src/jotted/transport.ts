// How the front end reaches `jotted`: through the Tauri runner in the app, or through the
// dev bridge (dev/jotted-bridge.ts) when the screens run in a plain browser.
// Nothing else in src/ spawns processes or talks to Tauri about jotted.

import type { ErrorCode } from "./types.gen";

export type Envelope<T = unknown> =
  | { v: number; ok: true; data: T }
  | { v: number; ok: false; error: { code: ErrorCode | string; message: string; retry?: boolean; step?: string } };

/** One line of `events --follow`. */
export type RawEvent = { v: number; cursor: number; at: string; type: string; [field: string]: unknown };

export type ServeState = "running" | "restarting" | "failed";

/** The data-folder variables the app runs jotted with (null when unset). */
export type DataEnv = { config: string | null; home: string | null };

export interface Transport {
  run(args: string[], stdin?: string): Promise<Envelope>;
  /** Start `jotted serve` and the events follower from `since`. Safe to call twice. */
  startBackground(since: number | null): Promise<void>;
  onEvent(listener: (event: RawEvent) => void): () => void;
  onServe(listener: (state: ServeState) => void): () => void;
  logPath(): Promise<string | null>;
  /** The bundled jotted for `claude connect --command`, or null to pass none. Throws the
   *  message to show when the app runs from a path that won't last (src-tauri/src/claude.rs). */
  bundlePath(): Promise<string | null>;
  dataEnv(): Promise<DataEnv>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function tauriTransport(): Transport {
  const core = import("@tauri-apps/api/core");
  const event = import("@tauri-apps/api/event");
  const listenTo = <T,>(name: string, listener: (payload: T) => void) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    event.then(({ listen }) =>
      listen<T>(name, (e) => listener(e.payload)).then((un) => (stopped ? un() : (stop = un))),
    );
    return () => {
      stopped = true;
      stop?.();
    };
  };
  return {
    run: async (args, stdin) => (await core).invoke<Envelope>("jotted", { args, stdin: stdin ?? null }),
    startBackground: async (since) => (await core).invoke("start_background", { since }),
    onEvent: (listener) => listenTo<RawEvent>("jotted://event", listener),
    onServe: (listener) => listenTo<{ state: ServeState }>("jotted://serve", (p) => listener(p.state)),
    logPath: async () => (await core).invoke<string | null>("log_path"),
    dataEnv: async () => (await core).invoke<DataEnv>("jotted_env"),
    bundlePath: async () => {
      try {
        return await (await core).invoke<string | null>("claude_bundle_ok");
      } catch (e) {
        throw new Error(String(e));
      }
    },
  };
}

function bridgeTransport(): Transport {
  const listeners = new Set<(event: RawEvent) => void>();
  let source: EventSource | null = null;
  return {
    run: async (args, stdin) => {
      const res = await fetch("/__jotted/run", { method: "POST", body: JSON.stringify({ args, stdin }) });
      return res.json();
    },
    startBackground: async (since) => {
      if (source) return;
      source = new EventSource(`/__jotted/events${since === null ? "" : `?since=${since}`}`);
      source.onmessage = (m) => listeners.forEach((l) => l(JSON.parse(m.data)));
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onServe: () => () => {},
    logPath: async () => null,
    bundlePath: async () => null, // the dev CLI connects with its own path
    dataEnv: async () => (await fetch("/__jotted/env")).json(),
  };
}

let current: Transport | null = null;

export function transport(): Transport {
  return (current ??= isTauri() ? tauriTransport() : bridgeTransport());
}

/** Tests swap in their own. */
export function setTransport(t: Transport | null): void {
  current = t;
}
