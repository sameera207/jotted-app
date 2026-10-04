// What the app asks of the OS besides running jotted: links, the Finder, open at login, the
// menu bar, and its own windows. In a plain browser (dev, Playwright) links open in a new tab
// and the rest does nothing; callers hide what isn't there (`isTauri()`).

import { isTauri } from "./jotted/transport";
import { httpsUrl } from "./store/labels";

const core = () => import("@tauri-apps/api/core");

export async function openLink(url: string): Promise<void> {
  const safe = httpsUrl(url);
  if (!safe) return; // the opener's scope refuses anything else too (capabilities/default.json)
  if (!isTauri()) {
    window.open(safe, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(safe);
}

export async function showInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/** Open at login, or null where the app can't tell (a browser). */
export async function autostartEnabled(): Promise<boolean | null> {
  if (!isTauri()) return null;
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!isTauri()) return;
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  await (on ? enable() : disable());
}

/** Closing the window keeps Jotted in the menu bar (src-tauri/src/tray.rs). */
export async function setKeepRunning(on: boolean): Promise<void> {
  if (!isTauri()) return;
  await (await core()).invoke("set_keep_running", { on });
}

/** The menu bar glyph for what Jotted is doing (src-tauri/icons/tray). */
export type TrayState = "idle" | "syncing" | "attention";

export async function setTrayState(state: TrayState): Promise<void> {
  if (!isTauri()) return;
  await (await core()).invoke("set_tray_state", { state });
}

/** Only macOS has a Dock to hide; elsewhere the Settings row isn't shown. */
export function dockIconSupported(): boolean {
  return isTauri() && /Mac/i.test(navigator.platform);
}

/** Show the Dock icon (default), or live only in the menu bar. */
export async function setDockIcon(visible: boolean): Promise<void> {
  if (!dockIconSupported()) return;
  await (await core()).invoke("set_dock_icon", { visible });
}

/** The open count next to the menu bar icon. */
export async function setTrayCount(open: number): Promise<void> {
  if (!isTauri()) return;
  await (await core()).invoke("set_tray_title", { title: open > 0 ? String(open) : "" });
}

/** Bring the To-do window forward, optionally at a place in it: "proposals", or
 *  "item:ID" for that item's "Where it came from". */
export async function showMain(at?: "proposals" | `item:${number}`): Promise<void> {
  if (!isTauri()) return;
  await (await core()).invoke("show_main", { at: at ?? null });
}

/** Where the main window should go when the tray asks ("proposals"). */
export async function onNavigate(listener: (at: string | null) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string | null>("jotted://navigate", (e) => listener(e.payload));
}

export async function hideThisWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** CLI updates (src-tauri/src/cli_update.rs, specs/CLI-updates-spec.md). */
export type CliUpdate = {
  enabled: boolean;
  /** Why updates are off: "development" (JOTTED_BIN), "no-key" (a build without the release key). */
  off: "development" | "no-key" | null;
  auto: boolean;
  active: { version: string; contract: number; from_app: boolean; installed_at: number | null };
  bundled: { version: string; contract: number };
  available: { version: string; contract: number; compatible: boolean } | null;
  last_check: number | null;
  skipped: string[];
  problem: string | null;
  busy: boolean;
};

type CliCommand = "cli_update_status" | "cli_update_check" | "cli_update_install" | "cli_update_retry" | "cli_update_set_auto";

/** A CLI-update command; null in a browser, where there's nothing to update. */
export async function cliUpdate(command: CliCommand, args: Record<string, unknown> = {}): Promise<CliUpdate | null> {
  if (!isTauri()) return null;
  return (await core()).invoke<CliUpdate>(command, args);
}

/** Every change: the new status, and a note to show ("Jotted updated to 0.2.0."). */
export async function onCliUpdate(listener: (status: CliUpdate, note: string | null) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ status: CliUpdate; note: string | null }>("jotted://cli-update", (e) => listener(e.payload.status, e.payload.note));
}
