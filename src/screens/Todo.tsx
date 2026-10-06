// The To-do sheet (spec: Screens › 3). The same rows as the To-do document on the tablet:
// with the document on, its pages (20 rows each, by slot); with it off, one sheet.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClaudePrompts } from "../components/Claude";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilterTabs } from "../components/FilterTabs";
import { PillButton } from "../components/PillButton";
import { Proposals } from "../components/Proposals";
import { canPeek, SourcePeek } from "../components/SourcePeek";
import { Row } from "../components/Row";
import { Sheet } from "../components/Sheet";
import type { Item } from "../jotted/types.gen";
import { paginate, passes, sortItems, type OwnerFilter, type StatusFilter } from "../store/labels";
import { add, clearRowError, dismiss, edit, printFresh, reopen, tick, useStore } from "../store/store";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];
const OWNER_TABS: { value: OwnerFilter; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "mine", label: "Mine" },
  { value: "others", label: "Others" },
];
/** Ruled lines under the last row, so a short list still looks like a sheet. */
const MIN_LINES = 8;

export function Todo({ newRowRef }: { newRowRef: React.RefObject<HTMLInputElement | null> }) {
  const items = useStore((s) => s.items);
  const status = useStore((s) => s.status);
  const settings = useStore((s) => s.settings);
  const rowErrors = useStore((s) => s.rowErrors);
  const printingFresh = useStore((s) => s.printingFresh);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("everyone");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [peek, setPeek] = useState<number | null>(null);
  const peekRequest = useStore((s) => s.peekRequest);
  // The menu bar popover asked for an item's page.
  useEffect(() => {
    if (peekRequest && items[peekRequest.id]) setPeek(peekRequest.id);
  }, [peekRequest]);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  const paged = settings?.todo_enabled ?? false;
  const shown = useMemo(
    () => Object.values(items).filter((i) => passes(i, statusFilter, ownerFilter)),
    [items, statusFilter, ownerFilter],
  );
  const pages = useMemo(() => (paged ? paginate(shown) : [sortItems(shown)]), [paged, shown]);
  const current = Math.min(page, pages.length - 1);
  const rows = pages[current];
  const openCount = Object.values(items).filter((i) => i.status === "open").length;
  const doneCount = Object.values(items).filter((i) => i.status === "done").length;

  useEffect(() => setPage((p) => Math.min(p, pages.length - 1)), [pages.length]);

  const focusRow = (id: number | undefined) => {
    if (id === undefined) return;
    rowRefs.current.get(id)?.focus();
  };

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, item: Item, index: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (index + 1 < rows.length) focusRow(rows[index + 1].id);
      else newRowRef.current?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(rows[index - 1]?.id);
    } else if (e.key === " ") {
      e.preventDefault();
      void (item.status === "done" ? reopen(item.id) : tick(item.id));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setEditing(item.id);
    } else if (e.key.toLowerCase() === "o" && canPeek(item)) {
      e.preventDefault();
      setPeek(item.id);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      focusRow((rows[index + 1] ?? rows[index - 1])?.id);
      void dismiss(item.id);
    }
  };

  const meta = [
    paged ? `page ${current + 1} of ${pages.length}` : null,
    `${openCount} open`,
  ].filter(Boolean).join(" · ");

  // The roving focus target: the focused row, or the first one.
  const tabTarget = rows.some((r) => r.id === focused) ? focused : rows[0]?.id;

  return (
    <div className={`todo ${peek !== null ? "todo-peeking" : ""}`}>
      <div className="todo-main">
      <ClaudePrompts />
      <Proposals />
      <Sheet title="To-do" meta={meta}>
        <div className="filters">
          <FilterTabs label="Status" options={STATUS_TABS} value={statusFilter} onChange={(v) => (setStatusFilter(v), setPage(0))} />
          <span className="filters-dot" aria-hidden="true">·</span>
          <FilterTabs label="Whose" options={OWNER_TABS} value={ownerFilter} onChange={(v) => (setOwnerFilter(v), setPage(0))} />
          {paged && (
            <PillButton
              className="filters-end"
              disabled={doneCount === 0 || printingFresh}
              title="Print the To-do document again with open items only"
              onClick={() => setConfirmFresh(true)}
            >
              {printingFresh ? "Printing…" : "Clear done"}
            </PillButton>
          )}
        </div>
        <ul className="rows" aria-label="To-do items">
          {rows.map((item, index) => (
            <Row
              key={item.id}
              ref={(el) => {
                if (el) {
                  rowRefs.current.set(item.id, el);
                  el.tabIndex = item.id === tabTarget ? 0 : -1;
                } else rowRefs.current.delete(item.id);
              }}
              item={item}
              status={status}
              error={rowErrors[String(item.id)]}
              editing={editing === item.id}
              onEditing={(on) => {
                setEditing(on ? item.id : null);
                if (!on) requestAnimationFrame(() => focusRow(item.id));
              }}
              onToggle={() => void (item.status === "done" ? reopen(item.id) : tick(item.id))}
              onEdit={(text) => void edit(item.id, text)}
              onDismiss={() => void dismiss(item.id)}
              onKeyDown={(e) => onRowKey(e, item, index)}
              onFocus={() => setFocused(item.id)}
              onPeek={canPeek(item) ? () => setPeek(item.id) : undefined}
              selected={peek === item.id}
            />
          ))}
          {statusFilter !== "done" && (
            <NewRow inputRef={newRowRef} error={rowErrors.new} onUp={() => focusRow(rows[rows.length - 1]?.id)} />
          )}
          {Array.from({ length: Math.max(0, MIN_LINES - rows.length - 1) }, (_, i) => (
            <li key={`blank-${i}`} className="row row-blank" aria-hidden="true" />
          ))}
        </ul>
        {rows.length === 0 && statusFilter !== "open" && <p className="empty">Nothing here.</p>}
        <p className="sheet-foot">
          Tick a box to mark it done, or write a new item in an empty row.
          {paged && " Same list, same rows as the To-do document on your tablet."}
        </p>
      </Sheet>
      {paged && pages.length > 1 && (
        <nav className="pager" aria-label="Pages">
          <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
            ‹
          </button>
          <span>
            {current + 1} of {pages.length}
          </span>
          <button type="button" aria-label="Next page" disabled={current === pages.length - 1} onClick={() => setPage(current + 1)}>
            ›
          </button>
        </nav>
      )}
      </div>
      {confirmFresh && (
        <ConfirmDialog
          title="Print a fresh list?"
          confirm="Print fresh list"
          onCancel={() => setConfirmFresh(false)}
          onConfirm={() => {
            setConfirmFresh(false);
            void printFresh();
          }}
        >
          Your reMarkable gets a new To-do list with only the {openCount} open item{openCount === 1 ? "" : "s"}. Ticks and
          handwriting on the current list are read first, then it's replaced.
        </ConfirmDialog>
      )}
      {peek !== null && (
        <SourcePeek
          id={peek}
          onClose={() => {
            const id = peek;
            setPeek(null);
            requestAnimationFrame(() => focusRow(id));
          }}
        />
      )}
    </div>
  );
}

function NewRow({ inputRef, error, onUp }: { inputRef: React.RefObject<HTMLInputElement | null>; error?: string; onUp: () => void }) {
  const [text, setText] = useState("");
  return (
    <li className="row row-new">
      <span className="checkbox-box checkbox-box-new" aria-hidden="true" />
      <div className="row-body">
        <input
          ref={inputRef}
          className="row-input row-input-new"
          aria-label="New item"
          placeholder="Write a new item…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) clearRowError("new");
          }}
          onKeyDown={async (e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onUp();
            }
            if (e.key === "Enter" && text.trim()) {
              const sent = text;
              setText("");
              if (!(await add(sent))) setText(sent);
            }
          }}
        />
        {error && (
          <span className="row-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}
