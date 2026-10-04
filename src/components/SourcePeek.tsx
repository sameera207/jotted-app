// Where it came from (spec: Screens › 4, mockup 02): the notebook page with the line
// highlighted, how Jotted read it, and what to do about it. For an item Claude added, the
// excerpt and the link instead of a page (specs/Claude-Desktop-spec.md, Elsewhere).

import { useEffect, useRef, useState } from "react";
import type { Item } from "../jotted/types.gen";
import { openLink } from "../platform";
import { folderLabel, httpsUrl, sourceKindLabel } from "../store/labels";
import { dismiss, edit, setOwner, useStore } from "../store/store";
import { PageImage } from "./PageImage";
import { PillButton } from "./PillButton";

/** Whether a row has anything to show here. */
export function canPeek(item: Item): boolean {
  if (item.page) return true;
  return item.origin === "agent" && !!(item.source.excerpt || item.source.title || item.source.url);
}

export function SourcePeek({ id, onClose }: { id: number; onClose: () => void }) {
  const item = useStore((s) => s.items[id]);
  const ai = useStore((s) => s.ai);
  const [editing, setEditing] = useState(false);
  const [naming, setNaming] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => close.current?.focus(), [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !editing && !naming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing, naming]);
  useEffect(() => {
    if (!item) onClose(); // dismissed, here or elsewhere
  }, [item, onClose]);
  if (!item) return null;

  const page = item.page;
  const where = page ? [folderLabel(item.source.folder), page.doc_name].filter(Boolean) : [];
  const judge = ai ? (ai.judge === "jev" ? ai.jev.name : ai.llm.family) : null;
  const sure = Math.round(item.p_action * 100);
  const owner =
    item.owner === "me" ? "You" : item.owner === "unclear" ? "Not sure" : item.owner_name ? item.owner_name : "Someone else";
  const url = httpsUrl(item.source.url);

  return (
    <aside className="peek" aria-labelledby="peek-title">
      <section className="peek-sheet">
        <header className="peek-head">
          <div>
            {page ? (
              <>
                {where.length > 1 && <span className="peek-folder">{where[0]} ›</span>}
                <h2 id="peek-title">
                  {page.doc_name} <span className="peek-page">· page {page.page}{page.page_count ? ` of ${page.page_count}` : ""}</span>
                </h2>
              </>
            ) : (
              <>
                <span className="peek-folder">from Claude{item.source.kind ? ` · ${sourceKindLabel(item.source.kind)}` : ""}</span>
                <h2 id="peek-title">{item.source.title ?? "Where it came from"}</h2>
              </>
            )}
          </div>
          <button ref={close} type="button" className="peek-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {page ? (
          <PageImage className="peek-image" docId={page.doc_id} page={page.page} anchor={page.anchor} alt={`${page.doc_name}, page ${page.page}, with the line highlighted`} />
        ) : (
          <div className="peek-agent">
            {item.source.excerpt && <blockquote className="proposal-excerpt">{item.source.excerpt}</blockquote>}
            {url && (
              <button type="button" className="link-button" onClick={() => void openLink(url)} title={url}>
                Open the source
              </button>
            )}
          </div>
        )}
      </section>
      <section className="peek-facts" aria-label="How Jotted read this line">
        <dl>
          <dt>Read as</dt>
          <dd>
            {editing ? (
              <input
                className="field-input"
                aria-label="Item text"
                autoFocus
                defaultValue={item.text}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void edit(item.id, e.currentTarget.value);
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={(e) => {
                  void edit(item.id, e.currentTarget.value);
                  setEditing(false);
                }}
              />
            ) : (
              item.text
            )}
          </dd>
          <dt>Owner</dt>
          <dd>
            {naming ? (
              <input
                className="field-input"
                aria-label="Whose is it?"
                placeholder="Their name (optional)"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void setOwner(item.id, "others", e.currentTarget.value.trim() || undefined);
                    setNaming(false);
                  }
                  if (e.key === "Escape") setNaming(false);
                }}
              />
            ) : (
              owner
            )}
          </dd>
          {item.origin !== "agent" && (
            <>
              <dt>Action</dt>
              <dd>
                Yes, {sure}% sure{judge ? ` · judged by ${judge}` : ""}
              </dd>
            </>
          )}
        </dl>
        <div className="peek-actions">
          <PillButton onClick={() => setEditing(true)}>Edit text</PillButton>
          {item.owner === "someone_else" ? (
            <PillButton onClick={() => void setOwner(item.id, "mine")}>Mine</PillButton>
          ) : (
            <PillButton onClick={() => setNaming(true)}>Someone else's</PillButton>
          )}
          <PillButton
            onClick={() => {
              void dismiss(item.id);
              onClose();
            }}
          >
            Not an action
          </PillButton>
        </div>
      </section>
    </aside>
  );
}
