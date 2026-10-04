// A stand-in `jotted` for building and testing the app with no tablet, key or Python.
//
// It answers the commands the app uses with the envelopes recorded from the real CLI in
// tests/fixtures/ (scripts/record-fixtures.sh), and keeps a little state between runs in
// FAKE_JOTTED_STATE (a JSON file; default: a file in the temp folder) so ticks, adds,
// edits and dismissals stick, and `events --follow` prints them as they happen.
//
// Test hooks (not part of jotted; the app's runner can't call them):
//   jotted __fake reset                    start again from the fixtures
//   jotted __fake fail "items done" busy 2 the next 2 runs of that command fail with that code
//   jotted __fake setup incomplete|complete  incomplete: only the app folder is done
//   jotted __fake connected false          the reMarkable connection dropped
//   jotted __fake event TYPE JSON          append an event, e.g. source.error '{"message":"…"}'
//   jotted __fake claude STATE             Claude Desktop's entry: not-installed, not-configured,
//                                          connected, missing, other-app, another, other-data, bad-config
//
// Claude Desktop's settings are only ever this state: the fake never touches a real file.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const STATE = process.env.FAKE_JOTTED_STATE || path.join(os.tmpdir(), "fake-jotted-state.json");
const SEED = path.join(__dirname, "seed.json");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")).envelope;
const data = (name) => structuredClone(fixture(name).data);

// ---------------------------------------------------------------- state

function initialState() {
  const shape = data("items-add"); // the recorded item, the shape every item must have
  delete shape.created; // only `items add` says that
  const keys = Object.keys(shape).sort().join(",");
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  const items = seed.items.map((over, i) => {
    const item = { ...structuredClone(shape), ...over, id: i + 1 };
    item.source = { ...shape.source, ...(over.source || {}) };
    // Handwriting has a page to draw, as the real CLI gives it.
    if (item.origin === "remarkable") {
      item.page = { doc_id: item.source.doc_id, doc_name: item.source.name, page: item.source.page, page_count: 7, anchor: item.source.anchor };
    }
    if (Object.keys(item).sort().join(",") !== keys) throw new Error(`seed item ${i + 1} doesn't match the recorded shape`);
    return item;
  });
  const status = data("status");
  Object.assign(status.source, { connected: true, detail: "Connected" });
  status.last_collected_at = new Date(Date.now() - 2 * 60_000).toISOString();
  status.watch = seed.watch;
  status.todo = { ...status.todo, enabled: true, published_at: status.last_collected_at };
  const settings = { ...data("settings"), watch: seed.watch, from_now: seed.watch.slice(0, 1), todo_enabled: true };
  const ai = data("ai");
  ai.llm.key = { set: true, source: "saved", hint: "sk-ant-…3f2a" };
  return { items, settings, status, ai, library: seed.library, steps: allSteps(true), events: [], cursor: 0, failures: {}, claude: claudeState("not-configured") };
}

// ---------------------------------------------------------------- setup

const STEP_IDS = data("setup-status").steps.map((st) => st.id);

function allSteps(done) {
  return Object.fromEntries(STEP_IDS.map((id) => [id, done || id === "app_folder"]));
}

function setupStatus(s) {
  const d = data("setup-status");
  for (const step of d.steps) {
    // As the CLI does: the folders step is done once a folder is watched.
    step.done = step.id === "folders" ? s.settings.watch.length > 0 : s.steps[step.id];
    if (step.done) delete step.command;
  }
  d.complete = d.steps.every((st) => st.done || st.optional);
  return d;
}

const isComplete = (s) => setupStatus(s).complete;

function keyInfo(key) {
  return { set: true, source: "saved", hint: `${key.slice(0, 7)}…${key.slice(-4)}` };
}

// ---------------------------------------------------------------- Claude Desktop

const CURRENT = data("claude-status-connected").command; // the app's bundled jotted, as recorded
const CLAUDE_STATES = {
  "not-installed": { installed: false, configured: false },
  "not-configured": { installed: true, configured: false },
  connected: { installed: true, configured: true, command: CURRENT, exists: true },
  missing: { installed: true, configured: true, command: data("claude-status-missing").command, exists: false },
  "other-app": { installed: true, configured: true, command: data("claude-status-other-app").command, exists: true },
  another: { installed: true, configured: true, command: data("claude-status-another").command, exists: true },
  "bad-config": { installed: true, configured: false, bad: true },
  // Set up from a terminal in a jotted-cli checkout: same jotted, the checkout's data.
  "other-data": { installed: true, configured: true, command: CURRENT, exists: true, env: { JOTTED_CONFIG: "/Users/you/workspace/jotted-cli/config.toml" } },
};

/** What `claude connect` writes into the entry's env: the data variables it runs with. */
function connectEnv() {
  const env = { JOTTED_BUNDLED: "1" };
  for (const k of ["JOTTED_CONFIG", "JOTTED_HOME"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function claudeState(name) {
  return { command: null, exists: false, admin: false, bad: false, env: connectEnv(), ...CLAUDE_STATES[name] };
}

function claudeStatus(c) {
  if (c.bad) return { code: 2, env: fixture("claude-status-bad-config") };
  const d = data("claude-status-not-configured");
  Object.assign(d, {
    installed: c.installed,
    configured: c.configured,
    command: c.configured ? c.command : null,
    command_exists: c.configured && c.exists,
    matches_current: c.configured && c.exists && c.command === CURRENT,
    admin: c.configured && c.admin,
    env: c.configured ? c.env : {},
  });
  return ok(d);
}

function claudeConnect(s, args) {
  const c = s.claude;
  if (!c.installed) return { code: 2, env: fixture("claude-connect-not-installed") };
  if (c.bad) return { code: 2, env: fixture("claude-connect-bad-config") };
  const command = opt(args, "--command") ?? CURRENT;
  if (command !== CURRENT) return { code: 1, env: fixture("claude-connect-invalid") };
  const admin = args.includes("--admin");
  const changed = !(c.configured && c.exists && c.command === command && c.admin === admin && JSON.stringify(c.env) === JSON.stringify(connectEnv()));
  const d = data(changed ? "claude-connect" : "claude-connect-unchanged");
  if (changed) d.backup_path = data("claude-connect-admin").backup_path;
  d.entry.args = admin ? ["mcp", "--admin"] : ["mcp"];
  d.entry.env = connectEnv();
  const sameEnv = JSON.stringify(c.env) === JSON.stringify(d.entry.env);
  if (!sameEnv && !changed) Object.assign(d, data("claude-connect"), { entry: d.entry });
  if (!args.includes("--dry-run")) s.claude = { ...c, configured: true, command, exists: true, admin, env: d.entry.env };
  save(s);
  return ok(d);
}

function claudeDisconnect(s) {
  const c = s.claude;
  if (c.bad) return { code: 2, env: fixture("claude-connect-bad-config") };
  const d = data(c.configured ? "claude-disconnect" : "claude-disconnect-unchanged");
  s.claude = { ...c, configured: false, command: null, exists: false, admin: false };
  save(s);
  return ok(d);
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    const s = initialState();
    save(s);
    return s;
  }
}

function save(s) {
  const tmp = `${STATE}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE);
}

function addEvent(s, type, fields) {
  s.cursor += 1;
  s.events.push({ cursor: s.cursor, at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), type, ...fields });
}

function counts(s) {
  return {
    open: s.items.filter((i) => i.status === "open").length,
    done: s.items.filter((i) => i.status === "done").length,
    proposed: s.items.filter((i) => i.status === "proposed").length,
  };
}

// ---------------------------------------------------------------- output

const ok = (d) => ({ code: 0, env: { v: 1, ok: true, data: d } });
const EXIT = { busy: 4, config: 2, conflict: 1, internal: 1, invalid: 1, model_error: 6, not_connected: 5, not_found: 1, not_set_up: 3, usage: 2 };
const fail = (code, message, extra = {}) => ({ code: EXIT[code] ?? 1, env: { v: 1, ok: false, error: { code, message, ...extra } } });

// ---------------------------------------------------------------- commands

function opt(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!["--follow", "--stdin", "--replace", "--no-browser", "--force", "--dry-run", "--propose", "--agent", "--admin", "--all"].includes(args[i])) i++;
    } else out.push(args[i]);
  }
  return out;
}

function findItem(s, id) {
  return s.items.find((i) => i.id === Number(id));
}

function changeItem(s, id, change) {
  const item = findItem(s, id);
  if (!item) return fail("not_found", `no item ${id}`);
  const before = JSON.stringify(item);
  change(item);
  if (JSON.stringify(item) !== before) addEvent(s, "item.changed", { item: structuredClone(item) });
  save(s);
  return ok(item);
}

function libraryData(s) {
  const watched = (path) => s.settings.watch.some((w) => path === w || path.startsWith(`${w}/`));
  const documents = s.library.documents.map((d) => ({ ...d, watched: watched(d.folder) }));
  const folders = s.library.folders.map((f) => ({
    path: f.path, watched: watched(f.path), documents: documents.filter((d) => d.folder === f.path).length,
  }));
  return { folders, documents };
}

/** A page of made-up ink: a heading and lines, the anchored one highlighted. */
function svgPage(doc, page, anchor) {
  const lines = [];
  for (let n = 0; n < 9; n++) {
    const y = 150 + n * 70;
    const hl = anchor && n === 3 ? `<rect class="highlight" x="40" y="${y - 40}" width="560" height="56" fill="#f1e38a"/>` : "";
    lines.push(`${hl}<g transform="translate(50 ${y - 30}) scale(1.2)">${svgLine(`${doc.id}${page}${n}`).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 702 936"><rect width="702" height="936" fill="#f6f5f1"/>${lines.join("")}</svg>`;
}

function svgLine(seed) {
  let x = 6, d = "";
  let r = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let w = 0; w < 4; w++) {
    d += `M${x.toFixed(1)} 30 `;
    for (let l = 0; l < 3 + Math.floor(rand() * 4); l++) {
      const h = 14 + rand() * 12;
      d += `q4 -${h.toFixed(1)} 7 0 t7 -${(h * 0.5).toFixed(1)} `;
      x += 14;
    }
    x += 14;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x.toFixed(0)} 40"><path d="${d}" fill="none" stroke="#1d1d1b" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function run(args, stdin) {
  const s = load();
  const words = positional(args);
  const name = [words[0], words[1]].join(" ");
  const cmd = ["items", "settings", "setup", "image", "ai", "claude"].includes(words[0]) && words[1] && !/^\d+$/.test(words[1]) ? name : words[0];

  const f = s.failures[cmd];
  if (f && f.times > 0) {
    f.times -= 1;
    save(s);
    const messages = {
      busy: "Your reMarkable is busy; try again in a moment",
      not_connected: "Couldn't reach the reMarkable cloud. Reconnect.",
      model_error: "The language model refused the key",
    };
    return fail(f.code, messages[f.code] || `fake ${f.code}`, f.code === "busy" ? { retry: true } : {});
  }

  const SETUP_COMMANDS = ["version", "setup status", "setup prepare", "events", "serve", "items", "items list", "connect",
    "ai", "ai key", "ai remove", "ai provider", "ai model", "library", "watch", "settings", "claude status"];
  if (!isComplete(s) && !SETUP_COMMANDS.includes(cmd)) {
    return { code: 3, env: fixture("library") }; // the recorded not_set_up answer
  }

  switch (cmd) {
    case "version":
      return ok(data("version"));
    case "setup status":
      return ok(setupStatus(s));
    case "setup prepare": {
      const prepared = STEP_IDS.filter((id) => !s.steps[id] && (id === "app_folder" || id === "remarkable.rmapi"));
      for (const id of prepared) s.steps[id] = true;
      save(s);
      return ok({ ...setupStatus(s), prepared: prepared.map((id) => ({ id, detail: null })) });
    }
    case "connect": {
      const code = (stdin || "").trim();
      if (s.steps["remarkable.connect"] && s.status.source.connected && !args.includes("--replace")) {
        return fail("conflict", "Already connected to a reMarkable. Replace the connection to use another.");
      }
      if (!/^[a-z]{8}$/i.test(code) || code === "badcodes") return fail("invalid", "That code didn't work. Codes work once and expire after a few minutes: get a new one.");
      s.steps["remarkable.connect"] = true;
      Object.assign(s.status.source, { connected: true, detail: "Connected" });
      save(s);
      return ok({ connected: true, documents: s.library.documents.length, replaced: args.includes("--replace") });
    }
    case "ai":
      return ok(s.ai);
    case "ai key": {
      const which = words[2];
      const key = (stdin || "").trim();
      const good = which === "llm" ? key.startsWith("sk-") : key.startsWith("ts_");
      if (!good) return fail("model_error", which === "llm" ? "Anthropic refused the key: invalid x-api-key" : "TypeSafe refused the key");
      if (which === "llm") { s.ai.llm.key = keyInfo(key); s.steps.llm = true; }
      else { s.ai.jev.key = keyInfo(key); s.ai.jev.enabled = true; s.ai.judge = "jev"; s.steps.jev = true; }
      save(s);
      return ok(s.ai);
    }
    case "ai remove":
      s.ai.jev = { ...s.ai.jev, key: { set: false, source: null, hint: null }, enabled: false };
      s.ai.judge = "llm";
      save(s);
      return ok(s.ai);
    case "ai provider":
      if (!s.ai.llm.providers.some((p) => p.id === words[2])) return fail("invalid", `no provider ${words[2]}`);
      s.ai.llm.provider = words[2];
      save(s);
      return ok(s.ai);
    case "ai model":
      if (!words[2]) return fail("invalid", "name a model");
      s.ai.llm.model = words[2];
      save(s);
      return ok(s.ai);
    case "items":
    case "items list": {
      const status = opt(args, "--status") || "open";
      const owner = opt(args, "--owner");
      const statuses = { all: ["open", "done"], any: ["open", "done", "proposed", "dismissed"] }[status] || [status];
      return ok(s.items.filter((i) =>
        statuses.includes(i.status) &&
        (!owner || (owner === "mine" ? i.owner !== "someone_else" : i.owner === "someone_else"))));
    }
    case "items add": {
      const text = words.slice(2).join(" ").trim();
      if (!text) return fail("invalid", "an item needs some text");
      const url = opt(args, "--source-url");
      if (url && !url.startsWith("https://")) return { code: 1, env: fixture("proposal-bad-url") };
      const item = { ...data("items-add"), id: Math.max(0, ...s.items.map((i) => i.id)) + 1, text, paper_text: text, created_at: new Date().toISOString() };
      delete item.created;
      if (args.includes("--agent")) {
        const owner = opt(args, "--owner");
        Object.assign(item, {
          origin: "agent",
          status: args.includes("--propose") || s.settings.mcp_add_mode === "propose_all" ? "proposed" : "open",
          owner: owner === "others" ? "someone_else" : "me",
          owner_name: opt(args, "--owner-name") ?? null,
        });
        item.source = { ...item.source, doc_id: "agent", name: opt(args, "--source-title") ?? "", kind: opt(args, "--source-kind") ?? null,
          key: opt(args, "--source-key") ?? null, title: opt(args, "--source-title") ?? null, url: url ?? null, excerpt: opt(args, "--excerpt") ?? null };
      }
      s.items.push(item);
      addEvent(s, item.status === "proposed" ? "item.proposed" : "item.added", { item });
      save(s);
      return ok({ ...item, created: true });
    }
    case "items get": {
      const item = findItem(s, words[2]);
      return item ? ok(item) : fail("not_found", `no item ${words[2]}`);
    }
    case "items accept": {
      const ids = words.slice(2).map(Number);
      const accepted = [], skipped = [];
      for (const id of ids) {
        const item = findItem(s, id);
        if (!item) { skipped.push({ id, reason: "not_found" }); continue; }
        if (item.status !== "proposed") { skipped.push({ id, reason: "not_proposed" }); continue; }
        item.status = "open";
        accepted.push(id);
        addEvent(s, "item.accepted", { item: structuredClone(item) });
        addEvent(s, "item.added", { item: structuredClone(item) });
      }
      save(s);
      // One id that can't be accepted is an error, as recorded; several report what was skipped.
      if (ids.length === 1 && skipped.length === 1) return skipped[0].reason === "not_found" ? fail("not_found", `no item ${ids[0]}`) : { code: 1, env: fixture("items-accept-again") };
      return ok({ accepted, skipped });
    }
    case "items edit":
      return changeItem(s, words[2], (i) => {
        const text = words.slice(3).join(" ");
        if (text) { i.text = text; i.edited = true; }
        const owner = opt(args, "--owner");
        if (owner) { i.owner = owner === "mine" ? "me" : "someone_else"; i.owner_name = owner === "mine" ? null : opt(args, "--owner-name") ?? null; }
      });
    case "items done":
      return changeItem(s, words[2], (i) => { i.status = "done"; });
    case "items reopen":
      return changeItem(s, words[2], (i) => { i.status = "open"; });
    case "items dismiss": {
      const item = findItem(s, words[2]);
      if (!item) return fail("not_found", `no item ${words[2]}`);
      s.items = s.items.filter((i) => i !== item);
      addEvent(s, "item.removed", { item: { id: item.id } });
      save(s);
      return ok(data("items-dismiss"));
    }
    case "settings":
      return ok(s.settings);
    case "settings set": {
      const [key, value] = [words[2], words.slice(3).join(" ")];
      if (!(key in s.settings) || key === "watch" || key === "from_now") return fail("invalid", `no setting ${key}`);
      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      if (typeof parsed !== typeof s.settings[key]) return fail("invalid", `${key} needs a ${typeof s.settings[key]}`);
      s.settings[key] = parsed;
      addEvent(s, "settings.changed", { settings: s.settings });
      save(s);
      return ok(s.settings);
    }
    case "status":
      return ok({ ...s.status, items: counts(s) });
    case "ai":
      return ok(s.ai);
    case "check": {
      addEvent(s, "check.started", {});
      save(s);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_JOTTED_CHECK_MS || 1200));
      const s2 = load();
      s2.status.last_collected_at = new Date().toISOString();
      addEvent(s2, "check.finished", { new: 0, updated: 0, missing: 0, pages_read: 0, errors: 0 });
      save(s2);
      return ok(data("check"));
    }
    case "image line":
      return ok({ svg: svgLine(`${words[2]}${words[3]}`) });
    case "image page": {
      const doc = s.library.documents.find((d) => d.id === words[2]);
      if (!doc || !doc.read) return fail("not_found", "Jotted hasn't read that page");
      return ok({ svg: svgPage(doc, Number(words[3]), opt(args, "--anchor")) });
    }
    case "events": {
      const since = Number(opt(args, "--since") ?? s.cursor);
      return ok({ cursor: s.cursor, events: s.events.filter((e) => e.cursor > since) });
    }
    case "claude status":
      return claudeStatus(s.claude);
    case "claude connect":
      return claudeConnect(s, args);
    case "claude disconnect":
      return claudeDisconnect(s);
    case "library":
      if (!s.status.source.connected) return fail("not_connected", "Couldn't reach the reMarkable cloud. Reconnect.");
      return ok(libraryData(s));
    case "watch": {
      const [action, path] = [words[1], words.slice(2).join(" ")];
      const known = s.library.folders.some((f) => f.path === path);
      if (!known) return fail("not_found", `no folder ${path}`);
      const st = s.settings;
      if (action === "add" && !st.watch.includes(path)) st.watch.push(path); // as recorded: from_now unchanged
      if (action === "remove") { st.watch = st.watch.filter((p) => p !== path); st.from_now = st.from_now.filter((p) => p !== path); }
      if (action === "from-now" && !st.from_now.includes(path)) st.from_now.push(path);
      if (action === "read-all") st.from_now = st.from_now.filter((p) => p !== path);
      s.status.watch = st.watch;
      if (st.watch.length) s.steps.folders = true;
      addEvent(s, "settings.changed", { settings: st });
      save(s);
      if (action === "add" || action === "remove") return ok(st);
      const docs = s.library.documents.filter((d) => d.folder === path).map((d) => d.path);
      return ok({ settings: st, documents: docs, already_read: [] });
    }
    default:
      return fail("usage", `the fake jotted doesn't know \`${args.join(" ")}\``);
  }
}

// ---------------------------------------------------------------- long-running

function follow(since) {
  let cursor = since ?? load().cursor;
  const tick = () => {
    for (const e of load().events.filter((e) => e.cursor > cursor)) {
      process.stdout.write(JSON.stringify({ v: 1, ...e }) + "\n");
      cursor = e.cursor;
    }
  };
  tick();
  setInterval(tick, 150);
}

function control(args) {
  const [what, ...rest] = args;
  if (what === "reset") { save(initialState()); return; }
  const s = load();
  if (what === "fail") s.failures[rest[0]] = { code: rest[1], times: Number(rest[2] || 1) };
  if (what === "setup") {
    s.steps = allSteps(rest[0] === "complete");
    if (rest[0] !== "complete") {
      Object.assign(s.status.source, { connected: false, detail: "not connected" });
      Object.assign(s.settings, { watch: [], from_now: [] });
      s.ai.llm.key = { set: false, source: null, hint: null };
    }
  }
  if (what === "connected") Object.assign(s.status.source, { connected: rest[0] !== "false", detail: rest[0] !== "false" ? "Connected" : "not connected" });
  if (what === "event") addEvent(s, rest[0], JSON.parse(rest[1] || "{}"));
  if (what === "claude") s.claude = claudeState(rest[0]);
  save(s);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--json" && a !== "--local");
  if (args[0] === "__fake") return control(args.slice(1));
  if (args[0] === "serve") {
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (args[0] === "events" && args.includes("--follow")) {
    const since = opt(args, "--since");
    return follow(since === undefined ? undefined : Number(since));
  }
  const stdin = args.includes("--stdin") ? fs.readFileSync(0, "utf8") : undefined;
  const { code, env } = run(args, stdin);
  process.stdout.write(JSON.stringify(env, null, 2) + "\n");
  process.exitCode = code;
}

main();
