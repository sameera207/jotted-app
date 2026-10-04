import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The screens in a browser, with the runner replaced by the fake jotted (dev/jotted-bridge.ts).
// One worker: the tests share the fake's state, and each starts by resetting it.
process.env.FAKE_JOTTED_STATE ??= join(tmpdir(), `fake-jotted-e2e-${process.pid}.json`);
process.env.FAKE_JOTTED_CHECK_MS ??= "300";
// Another port than `tauri dev`'s 1420, so the tests run while the app is open.
const PORT = Number(process.env.E2E_PORT ?? 1430);

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1000, height: 820 } },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { JOTTED_BIN: "tests/fake-jotted/jotted" },
  },
});
