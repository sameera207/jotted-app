import { describe, expect, it } from "vitest";
import type { Item, Status } from "../../src/jotted/types.gen";
import { ago, folderLabel, paginate, passes, sourceLabel } from "../../src/store/labels";
import { data } from "./helpers";

const base = data<Item>("items-add");
const item = (over: Partial<Omit<Item, "source">> & { source?: Partial<Item["source"]> } = {}): Item => ({
  ...base,
  ...over,
  source: { ...base.source, ...over.source },
});
const status = data<Status>("status");

describe("source lines", () => {
  it("names items added in Jotted", () => {
    expect(sourceLabel(item(), status)).toEqual({ kind: "added", text: "Added in Jotted" });
  });

  it("names the folder, document and page", () => {
    const i = item({ origin: "remarkable", source: { folder: "/Meeting Notes/2026", name: "Weekly sync", page: 3 } });
    expect(sourceLabel(i, status).text).toBe("Meeting Notes › 2026 › Weekly sync · p3");
  });

  it("names a row written on the To-do document, by its row", () => {
    const i = item({ origin: "remarkable", written: true, slot: 21, source: { folder: status.todo.folder, name: status.todo.name } });
    expect(sourceLabel(i, status)).toEqual({ kind: "todo", text: "Written on the To-do · row 2" });
  });

  it("reads folder paths", () => {
    expect(folderLabel("/")).toBe("");
    expect(folderLabel("/Work/1:1s")).toBe("Work › 1:1s");
  });
});

describe("filters", () => {
  it("shows unclear owners in Mine, and only someone else's in Others", () => {
    expect(passes(item({ owner: "unclear" }), "open", "mine")).toBe(true);
    expect(passes(item({ owner: "someone_else" }), "open", "mine")).toBe(false);
    expect(passes(item({ owner: "unclear" }), "open", "others")).toBe(false);
    expect(passes(item({ status: "done" }), "open", "everyone")).toBe(false);
    expect(passes(item({ status: "done" }), "all", "everyone")).toBe(true);
  });
});

describe("pages", () => {
  it("puts rows on their slot's page, and unslotted rows on the first page with room", () => {
    const pages = paginate([item({ id: 1, slot: 25 }), item({ id: 2, slot: 3 }), item({ id: 3, slot: null }), item({ id: 4, slot: 0 })]);
    expect(pages.map((p) => p.map((i) => i.id))).toEqual([[4, 2, 3], [1]]);
  });

  it("puts unslotted rows after a full page", () => {
    const full = Array.from({ length: 20 }, (_, n) => item({ id: n + 1, slot: n }));
    const pages = paginate([...full, item({ id: 99, slot: null })]);
    expect(pages[1].map((i) => i.id)).toEqual([99]);
  });

  it("always has the document's two pages, and more if a slot needs them", () => {
    expect(paginate([]).length).toBe(2);
    expect(paginate([item({ slot: 45 })]).length).toBe(3);
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it.each([
    ["2026-10-03T11:59:40Z", "just now"],
    ["2026-10-03T11:58:00Z", "2 min ago"],
    ["2026-10-03T09:00:00Z", "3 h ago"],
  ])("%s → %s", (iso, text) => expect(ago(iso, now)).toBe(text));
  it("is null before the first sync", () => expect(ago(null, now)).toBeNull());
});
