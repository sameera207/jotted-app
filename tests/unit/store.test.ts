import { beforeEach, describe, expect, it } from "vitest";
import { parseEvent } from "../../src/jotted/events";
import type { Item } from "../../src/jotted/types.gen";
import { add, byId, dismiss, edit, initialState, printFresh, reduce, tick, useStore } from "../../src/store/store";
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

describe("Clear done", () => {
  it("prints a fresh list and says how many open items are on it", async () => {
    useStore.setState({ items: byId([item({ id: 1 }), item({ id: 2, status: "done" })]) });
    const calls = fakeTransport(() => ({ v: 1, ok: true, data: { ticked: 0, written: 0, published: true, items: 1, overflow: 0, rebuilt: true } }));
    const pending = printFresh();
    expect(useStore.getState().printingFresh).toBe(true);
    expect(await pending).toBe(true);
    expect(calls.map((c) => c.args)).toEqual([["todo", "--fresh"]]);
    expect(useStore.getState().printingFresh).toBe(false);
    expect(useStore.getState().banners.map((b) => b.message)).toEqual(["Printed a fresh list with 1 open item"]);
    expect(useStore.getState().items[2].status).toBe("done"); // done items stay done
  });

  it("says when items didn't fit", async () => {
    fakeTransport(() => ({ v: 1, ok: true, data: { published: true, items: 40, overflow: 3, rebuilt: true } }));
    await printFresh();
    expect(useStore.getState().banners.map((b) => b.message)).toEqual(["Printed a fresh list with 40 open items; 3 didn't fit"]);
  });

  it("runs once at a time", async () => {
    const calls = fakeTransport(() => ({ v: 1, ok: true, data: { published: true, items: 0 } }));
    const first = printFresh();
    expect(await printFresh()).toBe(false);
    await first;
    expect(calls.length).toBe(1);
  });

  it("says so when the To-do document is off", async () => {
    fakeTransport(() => ({ v: 1, ok: true, data: { enabled: false } }));
    expect(await printFresh()).toBe(false);
    expect(useStore.getState().banners.map((b) => b.message)).toEqual(["The To-do document is off. Turn it on in Settings."]);
  });

  it("sends not_connected to a banner with Reconnect", async () => {
    fakeTransport(() => ({ v: 1, ok: false, error: { code: "not_connected", message: "Couldn't reach the cloud" } }));
    expect(await printFresh()).toBe(false);
    expect(useStore.getState().banners).toEqual([
      { id: "reconnect:Couldn't reach the cloud", message: "Couldn't reach the cloud", action: "reconnect" },
    ]);
    expect(useStore.getState().printingFresh).toBe(false);
  });

  it("shows invalid in a banner", async () => {
    fakeTransport(() => ({ v: 1, ok: false, error: { code: "invalid", message: "The To-do document is off" } }));
    await printFresh();
    expect(useStore.getState().banners.map((b) => b.message)).toEqual(["The To-do document is off"]);
  });
});
