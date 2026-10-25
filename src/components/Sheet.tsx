import type { ReactNode } from "react";

/** A screen of the window: its title over a ruled bar, then its contents. */
export function Sheet({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <header className="toolbar">
        <h1 id="sheet-title">{title}</h1>
        <span className="toolbar-gap" />
        {meta && <span className="sheet-meta">{meta}</span>}
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  );
}
