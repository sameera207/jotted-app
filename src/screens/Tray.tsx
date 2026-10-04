// The menu bar popover (spec: Screens › 7, mockup 08): a separate small window. Open count,
// Check now, quick add, your open items (all of them, scrolling; the spec's "first five" left
// the rest of the count with nowhere to show), what Claude proposed, who you're waiting on,
// last sync, Open Jotted.

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "../components/Checkbox";
import { canPeek } from "../components/SourcePeek";
import type { Item } from "../jotted/types.gen";
import { hideThisWindow, showMain } from "../platform";
import { ago, isOnTodoDocument, sortItems } from "../store/labels";
import { startupTray } from "../store/startup";
import { add, checkNow, reopen, tick, useStore } from "../store/store";

export function Tray() {
  const phase = useStore((s) => s.phase);
  const items = useStore((s) => s.items);
  const proposed = useStore((s) => Object.keys(s.proposed).length);
  const status = useStore((s) => s.status);
  const sync = useStore((s) => s.sync);
  const [text, setText] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => void startupTray(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void hideThisWindow();
    window.addEventListener("keydown", onKey);
    return () => (clearInterval(t), window.removeEventListener("keydown", onKey));
  }, []);

  const all = Object.values(items);
  const open = all.filter((i) => i.status === "open");
  const mine = useMemo(() => sortItems(open.filter((i) => i.owner !== "someone_else")), [items]);
  const waiting = open.filter((i) => i.owner === "someone_else");
  const names = [...new Set(waiting.map((i) => i.owner_name?.trim()).filter(Boolean))];
  const when = ago(status?.last_collected_at ?? null, now);

  if (phase.kind !== "ready") {
    return (
      <div className="tray">
        <p className="empty">{phase.kind === "starting" ? "Opening…" : "Finish setting up Jotted in its window."}</p>
        <footer className="tray-foot">
          <span />
          <button type="button" className="link-button" onClick={() => void showMain()}>
            Open Jotted
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div className="tray">
      <header className="tray-head">
        <h1>
          To-do <span className="tray-count">· {open.length} open</span>
        </h1>
        <button type="button" className="tray-check" aria-label="Check now" disabled={sync === "checking"} onClick={() => void checkNow()}>
          ↻
        </button>
      </header>
      <input
        className="tray-add"
        aria-label="Quick add"
        placeholder="Quick add…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter" && text.trim()) {
            const sent = text;
            setText("");
            if (!(await add(sent))) setText(sent);
          }
        }}
      />
      <ul className="tray-list" aria-label="Open items">
        {mine.map((item) => (
          <TrayRow key={item.id} item={item} />
        ))}
        {proposed > 0 && (
          <li className="tray-row">
            <span className="tray-mark" aria-hidden="true">✳</span>
            <button type="button" className="tray-link" onClick={() => void showMain("proposals")}>
              {proposed} proposed by Claude
            </button>
          </li>
        )}
        {waiting.length > 0 && (
          <li className="tray-row tray-waiting">
            <span className="checkbox-box tray-faint" aria-hidden="true" />
            <span className="tray-text">
              Waiting on {names.length > 0 ? `${names.length} ${names.length === 1 ? "person" : "people"}` : `${waiting.length} item${waiting.length === 1 ? "" : "s"}`}
              {names.length > 0 && <span className="tray-sub">{names.join(", ")}</span>}
            </span>
          </li>
        )}
      </ul>
      <footer className="tray-foot">
        <span>{sync === "checking" ? "Checking…" : when ? `Synced ${when}` : "Not synced yet"}</span>
        <button type="button" className="link-button" onClick={() => void showMain()}>
          Open Jotted
        </button>
      </footer>
    </div>
  );
}

function TrayRow({ item }: { item: Item }) {
  const status = useStore((s) => s.status);
  const done = item.status === "done";
  const where =
    item.origin === "web"
      ? "Added here"
      : item.origin === "agent"
        ? "from Claude"
        : isOnTodoDocument(item, status)
          ? "On the To-do"
          : `${item.source.name} · p${item.source.page}`;
  return (
    <li className={`tray-row ${done ? "row-done" : ""}`}>
      <Checkbox checked={done} label={done ? `Reopen: ${item.text}` : `Done: ${item.text}`} onChange={() => void (done ? reopen(item.id) : tick(item.id))} />
      <span className="tray-text">
        {item.text}
        {canPeek(item) ? (
          <button type="button" className="tray-sub tray-source" title="Where it came from" onClick={() => void showMain(`item:${item.id}`)}>
            {where}
          </button>
        ) : (
          <span className="tray-sub">{where}</span>
        )}
      </span>
    </li>
  );
}
