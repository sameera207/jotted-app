import { useEffect, useRef, useState } from "react";
import { Banner } from "./components/Banner";
import { PillButton } from "./components/PillButton";
import { Toast } from "./components/Toast";
import { transport } from "./jotted/transport";
import { onNavigate, setDockIcon, setKeepRunning, setTrayCount, setTrayState } from "./platform";
import { readPrefs } from "./store/prefs";
import { ago } from "./store/labels";
import { startup } from "./store/startup";
import { checkNow, closePanel, dismissBanner, requestPeek, reviewProposals, useStore } from "./store/store";
import { Notebooks } from "./screens/Notebooks";
import { Settings } from "./screens/Settings";
import { Setup } from "./screens/Setup";
import { Welcome } from "./screens/Welcome";
import { Todo } from "./screens/Todo";

type View = "todo" | "notebooks" | "settings";

export function App() {
  const phase = useStore((s) => s.phase);
  useEffect(() => void startup(), []);

  if (phase.kind === "starting") return <Gate title="Opening Jotted…" />;
  if (phase.kind === "needs-update")
    return (
      <Gate title="This version of Jotted needs updating">
        <p>
          The Jotted inside this app speaks contract {phase.contract}, which this app wasn't built for. Install the latest
          version of the app.
        </p>
      </Gate>
    );
  if (phase.kind === "failed")
    return (
      <Gate title="Jotted couldn't start">
        <p>{phase.message}</p>
        <PillButton onClick={() => void startup()}>Try again</PillButton>
      </Gate>
    );
  if (phase.kind === "welcome") return <Welcome />;
  if (phase.kind === "setup") return <Setup />;
  return <Main />;
}

function Gate({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="gate" data-tauri-drag-region>
      <div className="gate-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Settings' and the banner's Reconnect: the connect step, replacing the connection. */
function reconnect() {
  useStore.setState({ phase: { kind: "setup", step: "remarkable.connect", reconnect: true } });
}

function Main() {
  const [view, setView] = useState<View>("todo");
  const newRow = useRef<HTMLInputElement>(null);
  const banners = useStore((s) => s.banners);
  const panel = useStore((s) => s.panel);
  const openCount = useStore((s) => Object.values(s.items).filter((i) => i.status === "open").length);
  const syncing = useStore((s) => s.sync === "checking");
  const needsAttention = useStore((s) => s.banners.length > 0);

  // The menu bar: the open count by the icon, and whether closing the window keeps Jotted there.
  useEffect(() => void setTrayCount(openCount).catch(() => {}), [openCount]);
  useEffect(() => void setKeepRunning(readPrefs().keepRunning).catch(() => {}), []);
  useEffect(() => void setDockIcon(!readPrefs().hideDock).catch(() => {}), []);
  // The glyph: a problem to look at wins over a check in progress.
  useEffect(
    () => void setTrayState(needsAttention ? "attention" : syncing ? "syncing" : "idle").catch(() => {}),
    [syncing, needsAttention],
  );
  // The tray's "N proposed by Claude" opens this window at the panel.
  useEffect(() => {
    const stop = onNavigate((at) => {
      setView("todo");
      if (at === "proposals") reviewProposals();
      if (at?.startsWith("item:")) requestPeek(Number(at.slice(5)));
    });
    return () => void stop.then((f) => f());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault(); // ⌘R checks now, never reloads the window
        void checkNow();
      } else if (e.key.toLowerCase() === "n" && ((e.metaKey || e.ctrlKey) || (!typing && !e.altKey))) {
        e.preventDefault();
        setView("todo");
        requestAnimationFrame(() => newRow.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <WindowBar view={view} onView={setView} />
      <main className="content">
        {banners.length > 0 && (
          <div className="banners">
            {banners.map((b) => (
              <Banner
                key={b.id}
                banner={b}
                onDismiss={() => dismissBanner(b.id)}
                onAction={(action) => {
                  dismissBanner(b.id);
                  if (action === "reconnect") reconnect();
                  if (action === "check-key") setView("settings");
                }}
              />
            ))}
          </div>
        )}
        {view === "todo" && <Todo newRowRef={newRow} />}
        {view === "notebooks" && <Notebooks />}
        {view === "settings" && (
          <Settings
            onReconnect={reconnect}
            onReview={() => {
              setView("todo");
              reviewProposals();
            }}
          />
        )}
        <Toast />
      </main>
      {panel !== null && <ErrorPanel message={panel} />}
    </div>
  );
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** The window's one bar: the screens, then the device and when it was last read. */
function WindowBar({ view, onView }: { view: View; onView: (v: View) => void }) {
  const status = useStore((s) => s.status);
  const sync = useStore((s) => s.sync);
  const open = useStore((s) => Object.values(s.items).filter((i) => i.status === "open").length);
  const proposed = useStore((s) => Object.keys(s.proposed).length);
  const now = useNow(30_000);
  const when = ago(status?.last_collected_at ?? null, now);
  const device = status?.source.label ?? "reMarkable";
  const text = sync === "checking" ? "Checking…" : when ? `${device} · synced ${when}` : `${device} · not synced yet`;
  const nav: { id: View; label: string; count?: number; extra?: string }[] = [
    { id: "todo", label: "To-do", count: open, extra: proposed ? `${proposed} proposed` : undefined },
    { id: "notebooks", label: "Notebooks" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <header className="windowbar" data-tauri-drag-region>
      <nav className="nav" aria-label="Jotted">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`nav-item ${view === n.id ? "nav-on" : ""}`}
            aria-current={view === n.id ? "page" : undefined}
            onClick={() => onView(n.id)}
          >
            {n.label}
            {n.count !== undefined && <span className="nav-count">{n.count}</span>}
            {n.extra && <span className="nav-extra">· {n.extra}</span>}
          </button>
        ))}
      </nav>
      <span className="windowbar-gap" data-tauri-drag-region />
      <span className="windowbar-sync" role="status" data-tauri-drag-region>
        <span className={`sync-dot ${sync === "checking" ? "sync-dot-busy" : ""}`} aria-hidden="true" />
        {text}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Check now"
        title="Check now (⌘R)"
        disabled={sync === "checking"}
        onClick={() => void checkNow()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </header>
  );
}

function ErrorPanel({ message }: { message: string }) {
  const [log, setLog] = useState<string | null>(null);
  return (
    <div className="panel-backdrop" role="presentation">
      <div className="panel" role="alertdialog" aria-labelledby="panel-title" aria-describedby="panel-message">
        <h2 id="panel-title">Something went wrong</h2>
        <p id="panel-message">{message}</p>
        {log && (
          <p className="panel-log">
            The log is at <code>{log}</code>
          </p>
        )}
        <div className="panel-actions">
          <PillButton onClick={async () => setLog((await transport().logPath()) ?? "the app's log folder")}>Show log</PillButton>
          <PillButton primary autoFocus onClick={closePanel}>
            Close
          </PillButton>
        </div>
      </div>
    </div>
  );
}
