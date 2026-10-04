// Claude Desktop from the app (specs/Claude-Desktop-spec.md): the status-to-state table,
// proposals in the store, and no change to Claude's settings without a button press.
import { beforeEach, describe, expect, it } from "vitest";
import type { Envelope } from "../../src/jotted/transport";
import { setTransport } from "../../src/jotted/transport";
import { parseEvent } from "../../src/jotted/events";
import type { Item } from "../../src/jotted/types.gen";
import { claudeState, httpsUrl, ownerLabel, sourceKindLabel, sourceLabel } from "../../src/store/labels";
import {
  acceptProposals,
  byId,
  checkClaudeAtStartup,
  connectClaude,
  dismissProposal,
  initialState,
  reduce,
  useStore,
} from "../../src/store/store";
import { data, fakeTransport, fixture } from "./helpers";

const proposals = () => data<Item[]>("items-proposed");
const BUNDLED = "/Applications/Jotted.app/Contents/Resources/jotted/jotted";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment: prefs fall back to defaults
  }
  useStore.setState({ ...initialState, phase: { kind: "ready" } }, true);
});

/** Answer by command ("claude status", "items accept", …) from a table of envelopes. */
function answers(table: Record<string, Envelope | (() => Envelope)>) {
  return fakeTransport((args) => {
    const key = Object.keys(table)
      .filter((k) => k.split(" ").every((w, i) => args[i] === w))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`no answer for ${args.join(" ")}`);
    const a = table[key];
    return typeof a === "function" ? a() : a;
  });
}

describe("claude status → what the app shows", () => {
  it("isn't connected when Claude reads another data folder", () => {
    const status = { ...data("claude-status-connected"), env: { JOTTED_CONFIG: "/Users/you/workspace/jotted-cli/config.toml" } };
    expect(claudeState(status, { config: null, home: null })).toEqual({
      kind: "other-data",
      config: "/Users/you/workspace/jotted-cli/config.toml",
      home: null,
    });
    expect(claudeState(status, { config: "/Users/you/workspace/jotted-cli/config.toml", home: null })).toEqual({ kind: "connected", admin: false });
    expect(claudeState(status)).toEqual({ kind: "connected", admin: false }); // the app's own env not known yet
  });

  it.each([
    ["claude-status-not-installed", { kind: "not-connected" }],
    ["claude-status-not-configured", { kind: "not-connected" }],
    ["claude-status-connected", { kind: "connected", admin: false }],
    ["claude-status-connected-admin", { kind: "connected", admin: true }],
    ["claude-status-missing", { kind: "repair", reason: "missing" }],
    ["claude-status-other-app", { kind: "repair", reason: "other-app" }],
    ["claude-status-another", { kind: "another", command: "/usr/local/bin/jotted" }],
  ])("%s", (name, expected) => {
    expect(claudeState(data(name))).toEqual(expected);
  });
});

describe("labels for agents' items", () => {
  const [dana, priya] = proposals();

  it("reads source kinds, and unknown ones as Other", () => {
    expect(sourceKindLabel("doc")).toBe("Doc");
    expect(sourceKindLabel("gmail")).toBe("Mail");
    expect(sourceKindLabel("gcal")).toBe("Calendar");
    expect(sourceKindLabel("<script>")).toBe("Other");
    expect(sourceKindLabel(null)).toBeNull();
  });

  it("says an accepted item came from Claude, and where", () => {
    expect(sourceLabel({ ...dana, status: "open" }, null)).toEqual({ kind: "agent", text: "from Claude · Doc · Platform sync, 29 Sep" });
    expect(sourceLabel(data<Item>("agent-add"), null)).toEqual({ kind: "agent", text: "Added by Claude" });
  });

  it("names the owner when the CLI does", () => {
    expect(ownerLabel(priya)).toBe("→ Priya");
    expect(ownerLabel({ ...priya, owner_name: null })).toBe("→ Someone else");
    expect(ownerLabel(dana)).toBeNull();
  });

  it("opens https links only", () => {
    expect(httpsUrl("https://docs.example.com/d/platform-sync")).toBe("https://docs.example.com/d/platform-sync");
    for (const bad of ["javascript:alert(1)", "http://example.com", "file:///etc/passwd", "not a url", null]) {
      expect(httpsUrl(bad)).toBeNull();
    }
  });
});

describe("proposal events", () => {
  const item = proposals()[0];
  const at = "2026-10-04T00:00:00Z";

  it("upserts a proposal, never onto the list", () => {
    const s = { ...initialState, ...reduce(initialState, { type: "item.proposed", cursor: 1, at, item }) };
    expect(s.proposed[item.id]).toEqual(item);
    expect(s.items).toEqual({});
  });

  it("drops an accepted proposal; the item.added that follows lists it", () => {
    let s = { ...initialState, proposed: byId([item]) };
    s = { ...s, ...reduce(s, { type: "item.accepted", cursor: 2, at, item: { ...item, status: "open" } }) };
    expect(s.proposed).toEqual({});
    s = { ...s, ...reduce(s, { type: "item.added", cursor: 3, at, item: { ...item, status: "open" } }) };
    expect(s.items[item.id].status).toBe("open");
  });

  it("drops a dismissed proposal", () => {
    const s = { ...initialState, proposed: byId([item]) };
    expect(reduce(s, { type: "item.removed", cursor: 4, at, item: { id: item.id } }).proposed).toEqual({});
  });

  it("knows the new event types", () => {
    expect(parseEvent({ v: 1, cursor: 1, at, type: "item.proposed", item })).not.toBeNull();
    expect(parseEvent({ v: 1, cursor: 1, at, type: "item.accepted", item })).not.toBeNull();
  });
});

describe("accepting and dismissing proposals", () => {
  it("Accept all sends only the ids shown, never --all", async () => {
    const [a, b, c] = proposals();
    useStore.setState({ proposed: byId([a, b, c]) });
    const calls = answers({ "items accept": { v: 1, ok: true, data: { accepted: [a.id, b.id], skipped: [] } } });
    await acceptProposals([a.id, b.id]);
    expect(calls.map((x) => x.args)).toEqual([["items", "accept", String(a.id), String(b.id)]]);
    expect(Object.keys(useStore.getState().proposed).map(Number)).toEqual([c.id]);
  });

  it("refreshes quietly when Claude accepted it first", async () => {
    const [a, b] = proposals();
    useStore.setState({ proposed: byId([a, b]) });
    const calls = answers({
      "items accept": fixture("items-accept-again"),
      "items --status proposed": { v: 1, ok: true, data: [b] },
    });
    await acceptProposals([a.id]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((x) => x.args[1])).toEqual(["accept", "--status"]);
    expect(useStore.getState().rowErrors).toEqual({});
    expect(useStore.getState().panel).toBeNull();
    expect(Object.keys(useStore.getState().proposed).map(Number)).toEqual([b.id]);
  });

  it("puts a proposal back when dismissing fails for another reason", async () => {
    const [a] = proposals();
    useStore.setState({ proposed: byId([a]) });
    answers({ "items dismiss": fixture("error-invalid") });
    await dismissProposal(a.id);
    expect(useStore.getState().proposed[a.id]).toBeDefined();
    expect(useStore.getState().rowErrors[`p${a.id}`]).toBeTruthy();
  });
});

describe("connecting to Claude Desktop", () => {
  it("start-up only reads the status, and offers Repair for a stale entry", async () => {
    const calls = answers({ "claude status": fixture("claude-status-missing") });
    await checkClaudeAtStartup();
    expect(calls.map((c) => c.args)).toEqual([["claude", "status"]]);
    expect(useStore.getState().claudeRepairOffered).toBe(true);
  });

  it("start-up never connects, even when not connected", async () => {
    const calls = answers({ "claude status": fixture("claude-status-not-configured") });
    await checkClaudeAtStartup();
    expect(calls.some((c) => c.args[1] !== "status")).toBe(false);
  });

  it("connects with the bundled jotted, then says to restart Claude", async () => {
    let connected = false;
    const calls = answers({
      "claude connect": () => ((connected = true), fixture("claude-connect-admin")),
      "claude status": () => fixture(connected ? "claude-status-connected" : "claude-status-not-configured"),
    });
    expect(await connectClaude({ admin: false })).toBe(true);
    expect(calls[0].args).toEqual(["claude", "connect", "--command", BUNDLED]);
    expect(useStore.getState().claudeNote).toMatchObject({
      tone: "ok",
      text: "Connected. Quit and reopen Claude Desktop to use Jotted there.",
      details: expect.stringContaining("claude_desktop_config.json.bak-"),
    });
  });

  it("passes --admin only when that switch is on", async () => {
    const calls = answers({ "claude connect": fixture("claude-connect-admin"), "claude status": fixture("claude-status-connected-admin") });
    await connectClaude({ admin: true });
    expect(calls[0].args).toEqual(["claude", "connect", "--command", BUNDLED, "--admin"]);
  });

  it("says Already connected when nothing changed", async () => {
    answers({ "claude connect": fixture("claude-connect-unchanged"), "claude status": fixture("claude-status-connected") });
    await connectClaude();
    expect(useStore.getState().claudeNote?.text).toBe("Already connected.");
  });

  it("shows a settings file that isn't valid JSON in the Finder", async () => {
    useStore.setState({ claude: data("claude-status-connected") });
    answers({ "claude connect": fixture("claude-connect-bad-config") });
    expect(await connectClaude()).toBe(false);
    expect(useStore.getState().claudeNote).toMatchObject({
      tone: "error",
      reveal: "/Users/you/Library/Application Support/Claude/claude_desktop_config.json",
    });
  });

  it("sends a missing bundled jotted to the error panel", async () => {
    answers({ "claude connect": fixture("claude-connect-invalid") });
    await connectClaude();
    expect(useStore.getState().panel).toMatch(/Reinstall Jotted/);
  });

  it("doesn't connect from the disk image", async () => {
    const calls = answers({});
    setTransport({
      run: async (args) => {
        calls.push({ args });
        return fixture("claude-connect");
      },
      startBackground: async () => {},
      onEvent: () => () => {},
      onServe: () => () => {},
      logPath: async () => null,
      dataEnv: async () => ({ config: null, home: null }),
      bundlePath: async () => {
        throw new Error("Move Jotted to your Applications folder first, then open it from there.");
      },
    });
    expect(await connectClaude()).toBe(false);
    expect(calls).toEqual([]);
    expect(useStore.getState().claudeNote?.text).toMatch(/Applications folder/);
  });
});
