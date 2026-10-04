// Every command and option the client uses exists in the vendored schema.json, and the
// generated types are up to date with it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "../../scripts/gen-types";
import * as client from "../../src/jotted/client";
import { fakeTransport, root, schema } from "./helpers";

type Arg = { name: string; flags?: string[]; positional?: boolean; many?: boolean; enum?: string[]; type?: string };
type Command = { command: string; arguments: Arg[] };

function commandOf(args: string[]): Command | undefined {
  return (schema.commands as Command[])
    .filter((c) => c.command.split(" ").every((w, i) => args[i] === w))
    .sort((a, b) => b.command.length - a.command.length)[0];
}

/** Check args against the command's arguments; returns the problems. */
function check(args: string[]): string[] {
  const command = commandOf(args);
  if (!command) return [`no command for ${args.join(" ")}`];
  const rest = args.slice(command.command.split(" ").length);
  const problems: string[] = [];
  const positionals = command.arguments.filter((a) => a.positional);
  let p = 0;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("-")) {
      const def = command.arguments.find((a) => a.flags?.includes(arg));
      if (!def) problems.push(`${command.command}: no option ${arg}`);
      else if (def.type !== undefined || def.enum) {
        const value = rest[++i];
        if (def.enum && !def.enum.includes(value)) problems.push(`${command.command} ${arg}: ${value} isn't one of ${def.enum}`);
      }
    } else {
      const def = positionals[Math.min(p, positionals.length - 1)];
      if (!def || (p >= positionals.length && !def.many)) problems.push(`${command.command}: too many arguments`);
      else if (def.enum && !def.enum.includes(arg)) problems.push(`${command.command} ${def.name}: ${arg} isn't one of ${def.enum}`);
      p++;
    }
  }
  const required = positionals.filter((a) => (a as Arg & { required?: boolean }).required).length;
  if (p < required) problems.push(`${command.command}: needs ${required} arguments, got ${p}`);
  return problems;
}

describe("the client against schema.json", () => {
  it("only runs commands and options the pinned CLI has", async () => {
    const calls = fakeTransport(() => ({ v: 1, ok: true, data: { cursor: 0, svg: "" } }));
    await Promise.all([
      client.version(),
      client.setupStatus(),
      client.items(),
      client.items({ status: "all", owner: "others", folder: "/Work" }),
      client.itemsAdd("Book the room"),
      client.itemsEdit(1, "Book the big room"),
      client.itemsDone(1),
      client.itemsReopen(1),
      client.itemsDismiss(1),
      client.settings(),
      client.ai(),
      client.status(),
      client.check(),
      client.latestCursor(),
      client.imageLine("3f6c2a10-8d1e-4f5b-9a77-1c2d3e4f5a01", "1:212"),
      client.itemsProposed(),
      client.itemsGet(4),
      client.itemsAccept([4, 5]),
      client.settingsSet("mcp_add_mode", "propose_all"),
      client.claudeStatus(),
      client.claudeConnect({ command: "/Applications/Jotted.app/Contents/Resources/jotted/jotted", admin: true, dryRun: true }),
      client.claudeConnect(),
      client.claudeDisconnect(),
      client.itemsSetOwner(1, "others", "Priya"),
      client.itemsSetOwner(1, "mine"),
      client.setupPrepare(),
      client.connect("abcdefgh", { replace: true }),
      client.aiKey("llm", "sk-ant-xyz"),
      client.aiKey("jev", "ts_xyz"),
      client.aiRemove("jev"),
      client.aiProvider("anthropic"),
      client.aiModel("claude-opus-5"),
      client.library(),
      client.watch("add", "/Work"),
      client.watch("from-now", "/Work"),
      client.watch("read-all", "/Work"),
      client.watch("remove", "/Work"),
      client.imagePage("3f6c2a10-8d1e-4f5b-9a77-1c2d3e4f5a01", 3, { anchor: "1:212", width: 600 }),
    ]);
    expect(calls.length).toBe(38);
    // Secrets went on stdin, never in the arguments.
    expect(calls.filter((c) => c.stdin).map((c) => c.stdin)).toEqual(["abcdefgh", "sk-ant-xyz", "ts_xyz"]);
    expect(calls.flatMap((c) => check(c.args))).toEqual([]);
  });

  it("catches a command or option the CLI doesn't have", () => {
    expect(check(["items", "--colour", "red"])).not.toEqual([]);
    expect(check(["items", "--status", "later"])).not.toEqual([]);
    expect(check(["items", "done"])).not.toEqual([]);
    expect(check(["nope"])).not.toEqual([]);
  });

  it("has generated types up to date with schema.json", () => {
    const current = readFileSync(join(root, "src/jotted/types.gen.ts"), "utf8");
    expect(current).toBe(generate(schema));
  });
});
