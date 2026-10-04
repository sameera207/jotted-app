import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTransport, type Envelope, type Transport } from "../../src/jotted/transport";

export const root = join(__dirname, "../..");
export const schema = JSON.parse(readFileSync(join(root, "vendor/jotted/schema.json"), "utf8"));

/** A recorded envelope from tests/fixtures (see scripts/record-fixtures.sh). */
export function fixture<T = any>(name: string): Envelope<T> {
  return JSON.parse(readFileSync(join(root, "tests/fixtures", `${name}.json`), "utf8")).envelope;
}

export function data<T = any>(name: string): T {
  const env = fixture<T>(name);
  if (!env.ok) throw new Error(`${name} is an error fixture`);
  return structuredClone(env.data);
}

/** A transport that answers from `answer` and remembers every call. */
export function fakeTransport(answer: (args: string[]) => Envelope | Promise<Envelope>) {
  const calls: { args: string[]; stdin?: string }[] = [];
  const t: Transport = {
    run: async (args, stdin) => {
      calls.push({ args, stdin });
      return answer(args);
    },
    startBackground: async () => {},
    onEvent: () => () => {},
    onServe: () => () => {},
    logPath: async () => null,
    bundlePath: async () => "/Applications/Jotted.app/Contents/Resources/jotted/jotted",
    dataEnv: async () => ({ config: null, home: null }),
  };
  setTransport(t);
  return calls;
}
