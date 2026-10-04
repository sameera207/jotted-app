import type { ErrorCode } from "./types.gen";

/** A failed `jotted` command. Branch on `code`, never on `message`. */
export class JottedError extends Error {
  readonly code: ErrorCode | string;
  readonly retry: boolean;
  readonly step?: string;
  readonly command: string;

  constructor(command: string, error: { code: string; message: string; retry?: boolean; step?: string }) {
    super(error.message);
    this.name = "JottedError";
    this.command = command;
    this.code = error.code;
    this.retry = error.retry ?? false;
    this.step = error.step;
  }
}

/** What the app does about an error, by its code (spec: Errors). */
export type Handling =
  | { kind: "setup"; step?: string }
  | { kind: "banner"; message: string; action: "reconnect" | "check-key" | null }
  | { kind: "inline"; message: string }
  | { kind: "panel"; message: string };

export function handlingFor(error: unknown): Handling {
  if (!(error instanceof JottedError)) {
    return { kind: "panel", message: error instanceof Error ? error.message : String(error) };
  }
  switch (error.code) {
    case "not_set_up":
      return { kind: "setup", step: error.step };
    case "busy":
      // The client already retried after 1, 2 and 4 s.
      return { kind: "banner", message: "Your reMarkable is busy; try again in a moment", action: null };
    case "not_connected":
      return { kind: "banner", message: error.message, action: "reconnect" };
    case "model_error":
      return { kind: "banner", message: error.message, action: "check-key" };
    case "invalid":
    case "not_found":
    case "conflict":
      return { kind: "inline", message: error.message };
    default:
      return { kind: "panel", message: error.message };
  }
}
