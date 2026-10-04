import type { ReactNode } from "react";

/** A sheet of paper: a title with a hairline under it, then its contents. */
export function Sheet({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <h1 id="sheet-title">{title}</h1>
        {meta && <span className="sheet-meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
