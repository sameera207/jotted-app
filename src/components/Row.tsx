import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Item, Status } from "../jotted/types.gen";
import { ownerLabel, sourceLabel } from "../store/labels";
import { Checkbox } from "./Checkbox";
import { InkImage } from "./InkImage";
import { SourceLine } from "./SourceLine";

type Props = {
  item: Item;
  status: Status | null;
  error?: string;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDismiss: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => void;
  onFocus: () => void;
  /** Open "Where it came from"; omitted when there's nothing to show. */
  onPeek?: () => void;
  selected?: boolean;
};

export const Row = forwardRef<HTMLLIElement, Props>(function Row(
  { item, status, error, editing, onEditing, onToggle, onEdit, onDismiss, onKeyDown, onFocus, onPeek, selected },
  ref,
) {
  const done = item.status === "done";
  const owner = ownerLabel(item);
  const added = item.origin === "web";
  // Rows written on the To-do document show their ink, as the tablet does, until edited.
  const ink = item.written && !item.edited;

  return (
    <li
      ref={ref}
      className={`row ${done ? "row-done" : ""} ${item.id < 0 ? "row-pending" : ""} ${selected ? "row-selected" : ""}`}
      tabIndex={-1}
      data-id={item.id}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <Checkbox checked={done} label={done ? `Reopen: ${item.text}` : `Done: ${item.text}`} onChange={onToggle} tabIndex={-1} />
      <div className="row-body">
        {editing ? (
          <EditField text={item.text} onDone={(text) => (onEditing(false), text !== null && onEdit(text))} />
        ) : (
          <button type="button" className="row-text" tabIndex={-1} onClick={() => onEditing(true)} title="Edit">
            {ink ? <InkImage docId={item.source.doc_id} anchor={item.source.anchor} text={item.text} /> : item.text}
            {item.owner === "unclear" && (
              <span className="row-unclear" title="Not sure whose this is">
                {" "}?
              </span>
            )}
          </button>
        )}
        {onPeek ? (
          <button type="button" className="source-button" tabIndex={-1} onClick={onPeek} title="Where it came from">
            <SourceLine label={sourceLabel(item, status)} mark={status?.source.mark ?? "rM"} />
          </button>
        ) : (
          <SourceLine label={sourceLabel(item, status)} mark={status?.source.mark ?? "rM"} />
        )}
        {error && (
          <span className="row-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {owner && <span className="row-owner">{owner}</span>}
      <button
        type="button"
        className="row-dismiss"
        tabIndex={-1}
        aria-label={added ? `Delete: ${item.text}` : `Not an action: ${item.text}`}
        title={added ? "Delete" : "Not an action"}
        onClick={onDismiss}
      >
        ×
      </button>
    </li>
  );
});

/** Inline edit: Enter saves, Escape cancels, leaving the field saves. */
function EditField({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const [value, setValue] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (result: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  };
  return (
    <input
      ref={input}
      className="row-input"
      aria-label="Item text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}
