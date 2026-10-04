// The lines `events --follow` prints (vendor/jotted/cli-contract.md, Live updates).
// schema.json only lists the type names; the extra fields come from the contract's table.

import type { Item, Settings } from "./types.gen";
import type { RawEvent } from "./transport";

export type JottedEvent =
  | { type: "item.added" | "item.changed"; cursor: number; at: string; item: Item }
  | { type: "item.proposed" | "item.accepted"; cursor: number; at: string; item: Item }
  | { type: "item.removed"; cursor: number; at: string; item: { id: number } }
  | { type: "check.started"; cursor: number; at: string }
  | { type: "check.finished"; cursor: number; at: string; new: number; updated: number; missing: number; pages_read: number; errors: number }
  | { type: "todo.published"; cursor: number; at: string; items: unknown }
  | { type: "settings.changed"; cursor: number; at: string; settings: Settings }
  | { type: "source.error"; cursor: number; at: string; message: string };

const KNOWN = new Set([
  "item.added",
  "item.changed",
  "item.removed",
  "item.proposed",
  "item.accepted",
  "check.started",
  "check.finished",
  "todo.published",
  "settings.changed",
  "source.error",
]);

/** The event, or null for a type this app doesn't know (the contract says: ignore it). */
export function parseEvent(raw: RawEvent): JottedEvent | null {
  return KNOWN.has(raw.type) ? (raw as unknown as JottedEvent) : null;
}
