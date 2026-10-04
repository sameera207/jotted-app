// Development only: lets the front end run in a plain browser (Playwright, `npm run dev`)
// with the runner replaced by `jotted` spawned from the Vite dev server.
//
//   POST /__jotted/run     {args, stdin?} → the envelope (like the Tauri runner)
//   GET  /__jotted/events?since=N          → server-sent events from `events --follow`
//   POST /__jotted/fake    {args}          → `jotted __fake ARGS` (test hooks of the fake CLI)
//   GET  /__jotted/env                     → the JOTTED_CONFIG / JOTTED_HOME jotted runs with
//
// It runs JOTTED_BIN, defaulting to the fake CLI. The real app never uses this.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

const FAKE = "tests/fake-jotted/jotted";

function body(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      try {
        ok(JSON.parse(text || "{}"));
      } catch (e) {
        fail(e);
      }
    });
  });
}

function run(bin: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((ok) => {
    const child = spawn(bin, args, { env: { ...process.env, JOTTED_BUNDLED: "1" } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => ok(out));
    child.stdin.end(stdin ?? "");
  });
}

export function jottedBridge(root: string): Plugin {
  const bin = resolve(root, process.env.JOTTED_BIN || FAKE);
  return {
    name: "jotted-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__jotted/run", async (req, res) => {
        const { args, stdin } = await body(req);
        const out = await run(bin, ["--json", ...args], stdin);
        let envelope: unknown;
        try {
          envelope = JSON.parse(out);
        } catch {
          envelope = { v: 1, ok: false, error: { code: "internal", message: "Jotted didn't answer as expected" } };
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(envelope));
      });
      server.middlewares.use("/__jotted/env", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ config: process.env.JOTTED_CONFIG || null, home: process.env.JOTTED_HOME || null }));
      });
      server.middlewares.use("/__jotted/fake", async (req, res) => {
        const { args } = await body(req);
        await run(bin, ["__fake", ...args]);
        res.end("{}");
      });
      server.middlewares.use("/__jotted/events", (req, res) => {
        const since = new URL(req.url ?? "", "http://x").searchParams.get("since");
        const args = ["--json", "events", "--follow", ...(since ? ["--since", since] : [])];
        const child = spawn(bin, args);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        let rest = "";
        child.stdout.on("data", (chunk) => {
          const lines = (rest + chunk).split("\n");
          rest = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) res.write(`data: ${line}\n\n`);
        });
        req.on("close", () => child.kill());
      });
    },
  };
}
