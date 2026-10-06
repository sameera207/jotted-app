import { beforeEach, describe, expect, it } from "vitest";
import type { Library, Settings } from "../../src/jotted/types.gen";
import { tickChange, untickChange } from "../../src/store/folders";
import { changeWatch, toggleFolder } from "../../src/store/settings";
import { initialState, useStore } from "../../src/store/store";
import { data, fakeTransport } from "./helpers";

const doc = (path: string, id: string) => ({ path, folder: path.slice(0, path.lastIndexOf("/")), id, own: false, read: false, baseline_pages: 0, watched: false });
const library: Library = {
  folders: [{ path: "/Mable", documents: 2, watched: false }, { path: "/Mable/1-1", documents: 1, watched: true }, { path: "/Empty", documents: 0, watched: false }],
  documents: [doc("/Mable/Roadmap", "a"), doc("/Mable/1-1/Priya", "b")],
};
const settings = (over: Partial<Settings> = {}): Settings => ({ ...data<Settings>("settings"), watch: ["/Mable/1-1"], from_now: ["b"], ...over });

/** A CLI that answers each `watch` with settings changed as the real one would. */
function cli(failOn?: string) {
  let s = settings();
  return fakeTransport(([command, action, path]) => {
    if (command === "settings") return { v: 1, ok: true, data: s };
    if (command === "library") return { v: 1, ok: true, data: library };
    if (command !== "watch") return { v: 1, ok: true, data: data("status") };
    if (`${action} ${path}` === failOn) return { v: 1, ok: false, error: { code: "not_found", message: "no folder there" } };
    const ids = library.documents.filter((d) => d.path.startsWith(`${path}/`)).map((d) => d.id);
    if (action === "add") s = { ...s, watch: [...s.watch, path] };
    if (action === "remove") s = { ...s, watch: s.watch.filter((w) => w !== path) };
    if (action === "from-now") s = { ...s, from_now: [...new Set([...s.from_now, ...ids])].sort() };
    if (action === "read-all") s = { ...s, from_now: s.from_now.filter((id) => !ids.includes(id)) };
    const answer = action === "add" || action === "remove" ? s : { settings: s, documents: [], already_read: action === "from-now" ? ["/Mable/Roadmap"] : [] };
    return { v: 1, ok: true, data: answer };
  });
}

const watchCalls = (calls: { args: string[] }[]) => calls.filter((c) => c.args[0] === "watch").map((c) => c.args.slice(1).join(" "));

beforeEach(() => useStore.setState({ ...initialState, phase: { kind: "ready" }, settings: settings(), library }, true));

describe("changeWatch", () => {
  it("ticking a folder with a ticked subfolder: add, remove the subfolder, from now on", async () => {
    const calls = cli();
    const pending = changeWatch(tickChange("/Mable", settings(), library).steps);
    expect(useStore.getState().settings?.watch).toEqual(["/Mable"]); // at once
    expect(await pending).toEqual(["/Mable/Roadmap"]);
    expect(watchCalls(calls)).toEqual(["add /Mable", "remove /Mable/1-1", "from-now /Mable"]);
    expect(useStore.getState().settings).toMatchObject({ watch: ["/Mable"], from_now: ["a", "b"] });
  });

  it("skips from-now for a folder with no documents", () => {
    expect(tickChange("/Empty", settings(), library).steps).toEqual([{ action: "add", path: "/Empty" }]);
  });

  it("stops at the first error, puts settings back, and reloads them when some commands ran", async () => {
    const calls = cli("remove /Mable/1-1");
    expect(await changeWatch(tickChange("/Mable", settings(), library).steps)).toBeNull();
    expect(watchCalls(calls)).toEqual(["add /Mable", "remove /Mable/1-1"]);
    expect(calls.some((c) => c.args.join(" ") === "settings")).toBe(true);
    await new Promise((r) => setTimeout(r));
    // The truth: `add` worked.
    expect(useStore.getState().settings?.watch).toEqual(["/Mable/1-1", "/Mable"]);
    expect(useStore.getState().banners.map((b) => b.message)).toContain("no folder there");
  });

  it("puts settings back when the first command fails", async () => {
    const calls = cli("add /Mable");
    expect(await changeWatch(tickChange("/Mable", settings(), library).steps)).toBeNull();
    expect(watchCalls(calls)).toEqual(["add /Mable"]);
    expect(useStore.getState().settings?.watch).toEqual(["/Mable/1-1"]);
  });
});

describe("undo", () => {
  it("undoing a tick removes it and puts back what it took over, From now on included", () => {
    expect(tickChange("/Mable", settings(), library).undo).toEqual([
      { action: "remove", path: "/Mable" },
      { action: "read-all", path: "/Mable" },
      { action: "add", path: "/Mable/1-1" },
      { action: "from-now", path: "/Mable/1-1" },
    ]);
  });

  it("undoing an untick reads it again, from now on if it was", () => {
    const s = settings();
    expect(untickChange("/Mable/1-1", s, library)).toMatchObject({
      steps: [{ action: "remove", path: "/Mable/1-1" }, { action: "read-all", path: "/Mable/1-1" }],
      undo: [{ action: "add", path: "/Mable/1-1" }, { action: "from-now", path: "/Mable/1-1" }],
    });
  });

  it("the toast's Undo runs the reverse and ends where it started", async () => {
    const calls = cli();
    await toggleFolder("/Mable");
    const toast = useStore.getState().toast;
    expect(toast?.message).toBe("Reading Mable, which now covers 1-1");
    toast!.undo!();
    expect(useStore.getState().toast).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(watchCalls(calls).slice(3)).toEqual(["remove /Mable", "read-all /Mable", "add /Mable/1-1", "from-now /Mable/1-1"]);
    expect(useStore.getState().settings).toMatchObject({ watch: ["/Mable/1-1"], from_now: ["b"] });
  });

  it("a box read through its parent changes nothing and says why", async () => {
    useStore.setState({ settings: settings({ watch: ["/Mable"] }) });
    const calls = cli();
    expect(await toggleFolder("/Mable/1-1")).toBeNull();
    expect(watchCalls(calls)).toEqual([]);
    expect(useStore.getState().toast).toMatchObject({ message: "Read through Mable. Untick it to choose these one by one.", undo: null });
  });
});
