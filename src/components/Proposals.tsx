// "Proposed by Claude": items an agent found in documents, mail and meetings, waiting for the
// person (specs/Claude-Desktop-spec.md, Proposals in the app). Above the sheet, never on it:
// no checkboxes, no rule lines, since they have no row on the tablet. Everything an agent
// copied (text, titles, excerpts) is shown as plain text.

import { useEffect, useRef, useState } from "react";
import type { Item } from "../jotted/types.gen";
import { openLink } from "../platform";
import { httpsUrl, ownerLabel, sourceKindLabel } from "../store/labels";
import { acceptProposals, dismissProposal, useStore } from "../store/store";
import { PillButton } from "./PillButton";

/** More than this many and the panel starts collapsed to one line. */
const COLLAPSE_OVER = 3;

export function Proposals() {
  const proposed = useStore((s) => s.proposed);
  const focus = useStore((s) => s.proposalsFocus);
  const rowErrors = useStore((s) => s.rowErrors);
  const list = Object.values(proposed).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const [open, setOpen] = useState<boolean | null>(null); // null: by the count
  const expanded = open ?? list.length <= COLLAPSE_OVER;
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus === 0) return;
    setOpen(true);
    requestAnimationFrame(() => {
      panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      panel.current?.focus();
    });
  }, [focus]);

  if (list.length === 0) return null;
  const title = `Proposed by Claude (${list.length})`;

  return (
    <section className="proposals" id="proposals" ref={panel} tabIndex={-1} aria-label={title}>
      <header className="proposals-head">
        <h2>{title}</h2>
        {expanded && (
          <PillButton onClick={() => void acceptProposals(list.map((p) => p.id))}>
            Accept all
          </PillButton>
        )}
        <button type="button" className="proposals-toggle" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
          {expanded ? "Hide" : "Review"}
        </button>
      </header>
      {expanded && (
        <ul className="proposals-list">
          {list.map((item) => (
            <Proposal key={item.id} item={item} error={rowErrors[`p${item.id}`]} />
          ))}
        </ul>
      )}
      {expanded && (
        <p className="proposals-foot">Claude found these in what you asked it to read. Accepted items go on your list and the tablet.</p>
      )}
    </section>
  );
}

function Proposal({ item, error }: { item: Item; error?: string }) {
  const owner = ownerLabel(item);
  const kind = sourceKindLabel(item.source.kind);
  const where = [kind, item.source.title].filter(Boolean).join(" · ");
  const url = httpsUrl(item.source.url);
  return (
    <li className="proposal" data-proposal={item.id}>
      <div className="proposal-body">
        <span className="proposal-text">{item.text}</span>
        {owner && <span className="proposal-owner">{owner}</span>}
        {where && (
          <span className="proposal-source">
            {where}
            {url && (
              <button type="button" className="proposal-open" onClick={() => void openLink(url)} title={url}>
                Open
              </button>
            )}
          </span>
        )}
        {item.source.excerpt && <blockquote className="proposal-excerpt">{item.source.excerpt}</blockquote>}
        {error && (
          <span className="row-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="proposal-actions">
        <PillButton primary aria-label={`Accept: ${item.text}`} onClick={() => void acceptProposals([item.id])}>
          Accept
        </PillButton>
        <PillButton aria-label={`Dismiss: ${item.text}`} onClick={() => void dismissProposal(item.id)}>
          Dismiss
        </PillButton>
      </div>
    </li>
  );
}
