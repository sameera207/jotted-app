// The app's own small settings, kept in this window's storage: nothing jotted needs to know.
// Storage can be missing or throw (private mode, cleared data); every read has a default.

const KEY = "jotted.prefs";

export type Prefs = {
  /** "Not now" on the post-setup "Use Jotted from Claude Desktop" card: hidden for good. */
  claudeCardHidden: boolean;
  /** The jotted version Claude was last told about, to say "quit and reopen" once after an update. */
  claudeSeenVersion: string | null;
  /** Closing the window keeps Jotted in the menu bar (default on). */
  keepRunning: boolean;
  /** Hide the Dock icon so Jotted lives only in the menu bar (macOS; default off). */
  hideDock: boolean;
  /** The Welcome screen was seen: later launches with setup incomplete go straight to Setup. */
  welcomed: boolean;
};

const DEFAULTS: Prefs = { claudeCardHidden: false, claudeSeenVersion: null, keepRunning: true, hideDock: false, welcomed: false };

export function readPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePrefs(change: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // not kept: the default comes back next launch
  }
  return next;
}
