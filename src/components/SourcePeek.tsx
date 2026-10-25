// Where it came from (spec: Screens › 4; mockup "A · Focus — item selected" in specs/): beside
// the list, the notebook page with the line highlighted, how Jotted read it, and what to do
// about it. For an item Claude added, the excerpt and the link instead of a page
// (specs/Claude-Desktop-spec.md, Elsewhere).

import { useEffect, useRef, useState } from "react";
import type { Item } from "../jotted/types.gen";
import { openLink } from "../platform";
import { folderLabel, httpsUrl, sourceKindLabel } from "../store/labels";
import { dismiss, setOwner, useStore } from "../store/store";
import { PageImage } from "./PageImage";

/** Whether a row has anything to show here. */
export function canPeek(item: Item): boolean {
  if (item.page) return true;
  return item.origin === "agent" && !!(item.source.excerpt || item.source.title || item.source.url);
}

type Props = {
  id: number;
  onClose: () => void;
  /** "Edit text": edits the row in the list. */
  onEditText: () => void;
};

export function SourcePeek({ id, onClose, onEditText }: Props) {
  const item = useStore((s) => s.items[id]);
  const ai = useStore((s) => s.ai);
  const [naming, setNaming] = useState(false);
  // The page on show: the item's own, or one before or after it.
  const [shown, setShown] = useState<number | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    setShown(null);
    setNaming(false);
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !naming && !(e.target instanceof HTMLInputElement) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, naming]);
  useEffect(() => {
    if (!item) onClose(); // dismissed, here or elsewhere
  }, [item, onClose]);
  if (!item) return null;

  const page = item.page;
  const at = shown ?? page?.page ?? 1;
  const folder = page ? folderLabel(item.source.folder) : "";
  const judge = ai ? (ai.judge === "jev" ? ai.jev.name : ai.llm.family) : null;
  const sure = Math.round(item.p_action * 100);
  const owner =
    item.owner === "me" ? "You" : item.owner === "unclear" ? "Not sure" : item.owner_name ? item.owner_name : "Someone else";
  const url = httpsUrl(item.source.url);

  return (
    <aside className="peek" aria-labelledby="peek-title">
      <header className="peek-head">
        {page ? (
          <>
            {folder && <span className="peek-folder">{folder} ›</span>}
            <h2 id="peek-title">{page.doc_name}</h2>
            <span className="peek-page">
              p{at}
              {page.page_count ? ` of ${page.page_count}` : ""}
            </span>
          </>
        ) : (
          <>
            <span className="peek-folder">from Claude{item.source.kind ? ` · ${sourceKindLabel(item.source.kind)}` : ""} ›</span>
            <h2 id="peek-title">{item.source.title ?? "Where it came from"}</h2>
          </>
        )}
        <span className="toolbar-gap" />
        {page?.page_count && page.page_count > 1 && (
          <>
            <button type="button" className="icon-button" aria-label="Previous page" disabled={at <= 1} onClick={() => setShown(at - 1)}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next page"
              disabled={at >= page.page_count}
              onClick={() => setShown(at + 1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </>
        )}
        <button ref={close} type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="peek-body">
        {page ? (
          <PageImage
            className="peek-image"
            docId={page.doc_id}
            page={at}
            anchor={at === page.page ? page.anchor : undefined}
            alt={at === page.page ? `${page.doc_name}, page ${at}, with the line highlighted` : `${page.doc_name}, page ${at}`}
          />
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
      </div>
      <section className="peek-facts" aria-label="How Jotted read this line">
        <dl>
          <div>
            <dt>Owner</dt>
            <dd>
              {naming ? (
                <input
                  className="field-input peek-name"
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
                  onBlur={() => setNaming(false)}
                />
              ) : (
                owner
              )}
            </dd>
          </div>
          {item.origin !== "agent" && (
            <div>
              <dt>Action</dt>
              <dd>
                Yes · {sure}%{judge ? ` · ${judge}` : ""}
              </dd>
            </div>
          )}
        </dl>
        <div className="peek-actions">
          <button type="button" className="peek-button peek-button-main" onClick={onEditText}>
            Edit text
          </button>
          {item.owner === "someone_else" ? (
            <button type="button" className="peek-button" onClick={() => void setOwner(item.id, "mine")}>
              Mine
            </button>
          ) : (
            <button type="button" className="peek-button" onClick={() => setNaming(true)}>
              Someone else's
            </button>
          )}
          <button
            type="button"
            className="peek-button"
            onClick={() => {
              void dismiss(item.id);
              onClose();
            }}
          >
            Not an action
          </button>
        </div>
      </section>
    </aside>
  );
}
