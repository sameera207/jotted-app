import { beforeEach, describe, expect, it } from "vitest";
import { parseEvent } from "../../src/jotted/events";
import type { Item } from "../../src/jotted/types.gen";
import { add, byId, dismiss, edit, initialState, reduce, tick, useStore } from "../../src/store/store";
import { data, fakeTransport, fixture } from "./helpers";

const recorded = () => data<{ cursor: number; events: any[] }>("events").events;
const item = (over: Partial<Item> = {}): Item => ({ ...data<Item>("items-add"), ...over });

beforeEach(() => useStore.setState({ ...initialState, phase: { kind: "ready" } }, true));

describe("events update the store", () => {
  it("applies the recorded events: added, changed, removed, settings", () => {
    let state = { ...initialState };
    for (const raw of recorded()) {
      const event = parseEvent({ v: 1, ...raw });
      expect(event).not.toBeNull();
      state = { ...state, ...reduce(state, event!) };
    }
    // Recorded: three adds, item 2 done then reopened, item 3 edited then dismissed; three
    // proposals (4, 5, 6), an agent's add (7), 4 accepted, 6 dismissed; two settings.
    expect(Object.keys(state.items).map(Number)).toEqual([1, 2, 4, 7]);
    expect(state.items[2].status).toBe("open");
    expect(Object.keys(state.proposed).map(Number)).toEqual([5]);
    expect(state.settings?.poll_interval_s).toBe(120);
  });

  it("tracks a check", () => {
    const at = "2026-10-03T00:00:00Z";
    let s = { ...initialState, ...reduce(initialState, { type: "check.started", cursor: 1, at }) };
    expect(s.sync).toBe("checking");
    s = { ...s, ...reduce(s, { type: "check.finished", cursor: 2, at, new: 0, updated: 0, missing: 0, pages_read: 0, errors: 0 }) };
    expect(s.sync).toBe("idle");
  });

  it("ignores event types it doesn't know", () => {
    expect(parseEvent({ v: 1, cursor: 9, at: "", type: "plugin.sparkles" })).toBeNull();
  });
});

describe("optimistic changes", () => {
  it("ticks at once and keeps the CLI's answer", async () => {
    useStore.setState({ items: byId([item({ id: 1 })]) });
    fakeTransport(() => ({ v: 1, ok: true, data: item({ id: 1, status: "done" }) }));
    const done = tick(1);
    expect(useStore.getState().items[1].status).toBe("done");
    await done;
    expect(useStore.getState().items[1].status).toBe("done");
  });

  it("undoes a tick that fails, and shows the error by the row", async () => {
    useStore.setState({ items: byId([item({ id: 1 })]) });
    fakeTransport(() => ({ v: 1, ok: false, error: { code: "not_found", message: "no item 1" } }));
    await tick(1);
    expect(useStore.getState().items[1].status).toBe("open");
    expect(useStore.getState().rowErrors["1"]).toBe("no item 1");
  });

  it("puts back a dismissed row when dismissing fails", async () => {
    useStore.setState({ items: byId([item({ id: 1 })]) });
    fakeTransport(() => fixture("error-invalid"));
    const pending = dismiss(1);
    expect(useStore.getState().items[1]).toBeUndefined();
    await pending;
    expect(useStore.getState().items[1]).toBeDefined();
  });

  it("adds a row at once and swaps in the real one", async () => {
    fakeTransport(() => ({ v: 1, ok: true, data: item({ id: 7, text: "Call the bank" }) }));
    const pending = add("  Call the bank ");
    expect(Object.values(useStore.getState().items).map((i) => i.text)).toEqual(["Call the bank"]);
    expect(await pending).toBe(true);
    expect(Object.keys(useStore.getState().items)).toEqual(["7"]);
  });

  it("doesn't run an edit that changes nothing", async () => {
    useStore.setState({ items: byId([item({ id: 1, text: "Same" })]) });
    const calls = fakeTransport(() => fixture("items-edit"));
    await edit(1, " Same ");
    expect(calls).toEqual([]);
  });

  it("sends a not_connected error to a banner with Reconnect", async () => {
    useStore.setState({ items: byId([item({ id: 1 })]) });
    fakeTransport(() => ({ v: 1, ok: false, error: { code: "not_connected", message: "Couldn't reach the cloud" } }));
    await tick(1);
    expect(useStore.getState().banners).toEqual([
      { id: "reconnect:Couldn't reach the cloud", message: "Couldn't reach the cloud", action: "reconnect" },
    ]);
  });
});
