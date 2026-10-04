import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { jottedBridge } from "./dev/jotted-bridge";

// Tauri expects a fixed port, and its dev server must not clear the terminal.
export default defineConfig({
  plugins: [react(), jottedBridge(__dirname)],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
