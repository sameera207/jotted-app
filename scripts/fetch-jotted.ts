// Download the pinned jotted release named in jotted.lock and put it where the app bundle
// picks it up.
//
//   npm run fetch-jotted            every target in the lock
//   npm run fetch-jotted -- --host  only this machine's target (local `tauri build`)
//
// For each target: download the build, check its SHA-256 against the lock (a mismatch
// stops everything), and unpack it into src-tauri/binaries/jotted-<target-triple>/.
// Then copy that release's schema.json and cli-contract.md, and the release signing key, into
// vendor/jotted/ and regenerate src/jotted/types.gen.ts. See docs/bundling.md.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./gen-types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type Lock = {
  version: string;
  contract: number;
  repo: string;
  targets: Record<string, { asset: string; sha256: string | null }>;
};

export function hostTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
}

function releaseUrl(lock: Lock, asset: string): string {
  return `https://github.com/${lock.repo}/releases/download/v${lock.version}/${asset}`;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const lock: Lock = JSON.parse(readFileSync(join(root, "jotted.lock"), "utf8"));
  const onlyHost = process.argv.includes("--host");
  const triples = onlyHost ? [hostTriple()] : Object.keys(lock.targets);

  for (const triple of triples) {
    const target = lock.targets[triple];
    if (!target) throw new Error(`jotted.lock has no build for ${triple}`);
    if (!target.sha256) {
      throw new Error(
        `jotted.lock has no checksum for ${triple}: jotted-cli v${lock.version} has no release build yet.\n` +
          `Until it does, run the app with JOTTED_BIN (see docs/bundling.md).`,
      );
    }
    const bytes = await download(releaseUrl(lock, target.asset));
    const sum = createHash("sha256").update(bytes).digest("hex");
    if (sum !== target.sha256) {
      throw new Error(`${target.asset}: checksum ${sum} doesn't match the lock (${target.sha256})`);
    }
    const dest = join(root, "src-tauri/binaries", `jotted-${triple}`);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const archive = join(tmpdir(), target.asset);
    writeFileSync(archive, bytes);
    // The archive holds one folder, `jotted/` (PyInstaller onedir): its contents go in dest.
    execFileSync("tar", ["-xzf", archive, "-C", dest, "--strip-components", "1"]);
    rmSync(archive);
    if (!existsSync(join(dest, "jotted"))) throw new Error(`${target.asset} has no jotted/jotted inside`);
    console.log(`${triple}: jotted ${lock.version}, checksum ok → ${dest.replace(root + "/", "")}`);
  }

  for (const name of ["schema.json", "cli-contract.md"]) {
    writeFileSync(join(root, "vendor/jotted", name), await download(releaseUrl(lock, name)));
  }
  const schema = JSON.parse(readFileSync(join(root, "vendor/jotted/schema.json"), "utf8"));
  if (schema.version !== lock.version || schema.contract !== lock.contract) {
    throw new Error(`schema.json is ${schema.version}/contract ${schema.contract}; the lock says ${lock.version}/${lock.contract}`);
  }
  // The key jotted-cli signs release.json with, from the pinned tag: the app checks every CLI
  // update against it (src-tauri/build.rs builds it in; specs/CLI-updates-spec.md).
  const key = `https://raw.githubusercontent.com/${lock.repo}/v${lock.version}/docs/release-key.pub`;
  writeFileSync(join(root, "vendor/jotted/release-key.pub"), await download(key));
  writeFileSync(join(root, "src/jotted/types.gen.ts"), generate(schema));
  console.log(`vendor/jotted and src/jotted/types.gen.ts updated for ${lock.version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
}
