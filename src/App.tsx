import { useEffect, useRef, useState } from "react";
import { Banner } from "./components/Banner";
import { PillButton } from "./components/PillButton";
import { transport } from "./jotted/transport";
import { onNavigate, setDockIcon, setKeepRunning, setTrayCount, setTrayState } from "./platform";
import { readPrefs } from "./store/prefs";
import { ago, folderLabel } from "./store/labels";
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
      } else if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
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
      <TitleBar />
      <div className="app-body">
        <Sidebar view={view} onView={setView} />
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
        </main>
      </div>
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

function TitleBar() {
  const status = useStore((s) => s.status);
  const sync = useStore((s) => s.sync);
  const now = useNow(30_000);
  const when = ago(status?.last_collected_at ?? null, now);
  const device = status?.source.device ?? "your reMarkable";
  const text =
    sync === "checking" ? "Checking…" : when ? `Synced with ${device} ${when}` : `Not synced with ${device} yet`;
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        Jotted
      </span>
      <span className="titlebar-sync" role="status" data-tauri-drag-region>
        <span className={`sync-dot ${sync === "checking" ? "sync-dot-busy" : ""}`} aria-hidden="true" />
        {text}
      </span>
      <PillButton
        icon={<span aria-hidden="true">↻</span>}
        onClick={() => void checkNow()}
        disabled={sync === "checking"}
        title="Check now (⌘R)"
      >
        Check now
      </PillButton>
    </header>
  );
}

function Sidebar({ view, onView }: { view: View; onView: (v: View) => void }) {
  const items = useStore((s) => s.items);
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const proposed = useStore((s) => Object.keys(s.proposed).length);
  const open = Object.values(items).filter((i) => i.status === "open");
  const perFolder = (path: string) => open.filter((i) => i.source.folder === path || i.source.folder.startsWith(`${path}/`)).length;
  const nav: { id: View; label: string; icon: string; count?: number; extra?: string }[] = [
    { id: "todo", label: "To-do", icon: "☰", count: open.length, extra: proposed ? `${proposed} proposed` : undefined },
    { id: "notebooks", label: "Notebooks", icon: "▯" },
    { id: "settings", label: "Settings", icon: "☼" },
  ];
  const source = status?.source;
  return (
    <nav className="sidebar" aria-label="Jotted">
      <ul className="nav">
        {nav.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={`nav-item ${view === n.id ? "nav-on" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => onView(n.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              <span className="nav-label">
                {n.label}
                {n.extra && <span className="nav-extra"> · {n.extra}</span>}
              </span>
              {n.count !== undefined && <span className="nav-count">{n.count}</span>}
            </button>
          </li>
        ))}
      </ul>
      {settings && settings.watch.length > 0 && (
        <section className="watching">
          <h2>Watching</h2>
          <ul>
            {settings.watch.map((path) => (
              <li key={path} className="watching-item">
                <span className="nav-icon" aria-hidden="true">
                  ⌸
                </span>
                <span className="nav-label">{folderLabel(path) || "Everything"}</span>
                <span className="nav-count" aria-label={`${perFolder(path)} open`}>
                  {perFolder(path)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {source && (
        <footer className="device">
          <span className="device-mark" aria-hidden="true" />
          <span>
            <strong>{source.label}</strong>
            <br />
            {source.connected ? "Connected" : "Not connected"}
            {status?.todo.enabled ? " · To-do on tablet" : ""}
          </span>
        </footer>
      )}
    </nav>
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
