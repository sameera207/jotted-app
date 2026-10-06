import { describe, expect, it } from "vitest";
import type { Library } from "../../src/jotted/types.gen";
import { applyStep, buildTree, coverOf, entriesUnder, filterTree, flatten, folderMode, folderState } from "../../src/store/folders";
import { data } from "./helpers";

const folder = (path: string, documents: number) => ({ path, documents, watched: false });
const doc = (path: string, id: string) => {
  const folder = path.slice(0, path.lastIndexOf("/")) || "/";
  return { path, folder, id, own: false, read: false, baseline_pages: 0, watched: false };
};

const library: Library = {
  folders: [folder("/Mable", 4), folder("/Mable/1-1", 2), folder("/Blog", 1), folder("/Mable2", 0)],
  documents: [doc("/Mable/Roadmap", "a"), doc("/Mable/Ideas", "b"), doc("/Mable/1-1/Priya", "c"), doc("/Mable/1-1/Tom", "d"), doc("/Blog/Drafts", "e")],
};

describe("buildTree", () => {
  it("nests by path, sorts by name with numbers in order, and counts direct documents", () => {
    const tree = buildTree([folder("/b/Q10", 1), folder("/b", 3), folder("/b/Q2", 1), folder("/A", 0)]);
    expect(tree.map((n) => n.name)).toEqual(["A", "b"]);
    expect(tree[1].children.map((n) => n.name)).toEqual(["Q2", "Q10"]);
    expect(tree[1].direct).toBe(1);
  });

  it("adds parents the library doesn't list, counting what's under them", () => {
    const tree = buildTree([folder("/x/y/z", 2), folder("/x/w", 1)]);
    expect(flatten(tree).map((n) => n.path)).toEqual(["/x", "/x/w", "/x/y", "/x/y/z"]);
    expect(tree[0].documents).toBe(3);
    expect(tree[0].direct).toBe(0);
  });
});

describe("coverOf", () => {
  it("is the path itself, else its nearest watched ancestor", () => {
    expect(coverOf("/Mable/1-1", ["/Mable", "/Mable/1-1"])).toBe("/Mable/1-1");
    expect(coverOf("/Mable/1-1/x", ["/Mable", "/Mable/1-1"])).toBe("/Mable/1-1");
    expect(coverOf("/Mable/Hiring", ["/Mable"])).toBe("/Mable");
  });

  it("lets / cover everything, last", () => {
    expect(coverOf("/Blog", ["/"])).toBe("/");
    expect(coverOf("/Blog", ["/", "/Blog"])).toBe("/Blog");
  });

  it("ignores trailing slashes", () => {
    expect(coverOf("/Mable/1-1/", ["/Mable/"])).toBe("/Mable/");
  });

  it("doesn't let a folder cover a sibling that shares its prefix", () => {
    expect(coverOf("/Mable2", ["/Mable"])).toBeNull();
    expect(entriesUnder("/Mable", ["/Mable2", "/Mable/1-1", "/Mable"])).toEqual(["/Mable/1-1"]);
  });
});

describe("folderState", () => {
  it("has four states", () => {
    expect(folderState("/Blog", [])).toBe("off");
    expect(folderState("/Mable", ["/Mable"])).toBe("on");
    expect(folderState("/Mable/1-1", ["/Mable"])).toBe("inherited");
    expect(folderState("/Mable", ["/Mable/1-1"])).toBe("partial");
  });
});

describe("folderMode", () => {
  it("compares the documents' IDs with from_now", () => {
    expect(folderMode("/Mable", library, ["a", "b", "c", "d"])).toBe("from-now");
    expect(folderMode("/Mable", library, ["e"])).toBe("everything");
    expect(folderMode("/Mable", library, ["c", "d"])).toBe("mixed");
    expect(folderMode("/Mable/1-1", library, ["c", "d"])).toBe("from-now");
    expect(folderMode("/Mable2", library, [])).toBe("empty");
  });

  it("never matches a folder path in from_now (the CLI keeps IDs)", () => {
    expect(folderMode("/Mable", library, ["/Mable"])).toBe("everything");
  });
});

describe("filterTree", () => {
  const tree = buildTree(library.folders);

  it("keeps the parents of a match", () => {
    const shown = filterTree(tree, "1-1", false, []);
    expect(shown.map((n) => n.path)).toEqual(["/Mable"]);
    expect(shown[0].children.map((n) => n.path)).toEqual(["/Mable/1-1"]);
  });

  it("matches case-insensitively, and finds nothing for a name that isn't there", () => {
    expect(flatten(filterTree(tree, "BLOG", false, [])).map((n) => n.path)).toEqual(["/Blog"]);
    expect(filterTree(tree, "xyz", false, [])).toEqual([]);
  });

  it("Being read keeps folders that aren't off, with their parents", () => {
    expect(flatten(filterTree(tree, "", true, ["/Mable/1-1"])).map((n) => n.path)).toEqual(["/Mable", "/Mable/1-1"]);
    expect(filterTree(tree, "", true, [])).toEqual([]);
  });
});

describe("applyStep", () => {
  const settings = { ...data("settings"), watch: ["/Mable/1-1"], from_now: [] };

  it("adds and removes entries, and from-now / read-all change document IDs", () => {
    let s = applyStep(settings, { action: "add", path: "/Mable" }, library);
    s = applyStep(s, { action: "remove", path: "/Mable/1-1" }, library);
    s = applyStep(s, { action: "from-now", path: "/Mable" }, library);
    expect(s.watch).toEqual(["/Mable"]);
    expect(s.from_now).toEqual(["a", "b", "c", "d"]);
    s = applyStep(s, { action: "read-all", path: "/Mable/1-1" }, library);
    expect(s.from_now).toEqual(["a", "b"]);
  });
});
