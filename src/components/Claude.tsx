// Claude Desktop on the To-do window: the one-time "Use Jotted from Claude Desktop" card after
// setup, and the Repair banner when the start-up check finds a stale entry. Both act only on a
// button press (specs/Claude-Desktop-spec.md, Connecting).

import { useState } from "react";
import { showInFinder } from "../platform";
import { claudeState } from "../store/labels";
import { connectClaude, hideClaudeCard, hideClaudeRepair, useStore, type ClaudeNote } from "../store/store";
import { PillButton } from "./PillButton";

/** What the last connect or disconnect said: the message, the backup under Details, Show in Finder. */
export function ClaudeNoteView({ note }: { note: ClaudeNote }) {
  return (
    <div className={`claude-note ${note.tone === "error" ? "claude-note-error" : ""}`} role={note.tone === "error" ? "alert" : "status"}>
      <span>{note.text}</span>
      {note.reveal && (
        <button type="button" className="link-button" onClick={() => void showInFinder(note.reveal!)}>
          Show in Finder
        </button>
      )}
      {note.details && (
        <details>
          <summary>Details</summary>
          Claude Desktop's settings were backed up to <code>{note.details}</code>
        </details>
      )}
    </div>
  );
}

export function ClaudePrompts() {
  const claude = useStore((s) => s.claude);
  const hidden = useStore((s) => s.claudeCardHidden);
  const repair = useStore((s) => s.claudeRepairOffered);
  const busy = useStore((s) => s.claudeBusy);
  const note = useStore((s) => s.claudeNote);
  const dataEnv = useStore((s) => s.dataEnv);
  // The note shows here only for an action taken here.
  const [acted, setActed] = useState<"card" | "repair" | null>(null);
  if (!claude) return acted && note ? <ClaudeNoteView note={note} /> : null;
  const state = claudeState(claude, dataEnv);

  if (repair && state.kind === "repair") {
    return (
      <div className="banner claude-banner" role="status">
        <span className="banner-mark" aria-hidden="true">!</span>
        <span className="banner-message">
          Claude Desktop can't find Jotted ({state.reason === "missing" ? "the app was moved or reinstalled" : "it runs another copy of the app"}).
          {acted === "repair" && note && <ClaudeNoteView note={note} />}
        </span>
        <button
          type="button"
          className="banner-action"
          disabled={busy}
          onClick={() => {
            setActed("repair");
            void connectClaude();
          }}
        >
          Repair
        </button>
        <button type="button" className="banner-action" onClick={hideClaudeRepair}>
          Not now
        </button>
      </div>
    );
  }

  if (claude.installed && state.kind === "not-connected" && !hidden) {
    return (
      <section className="claude-card" aria-labelledby="claude-card-title">
        <h2 id="claude-card-title">Use Jotted from Claude Desktop</h2>
        <p>
          Ask Claude to show your list, add to it, or find to-dos in a document or a thread. You review what it finds before it
          reaches your tablet.
        </p>
        {acted === "card" && note && <ClaudeNoteView note={note} />}
        <div className="claude-card-actions">
          <PillButton
            primary
            disabled={busy}
            onClick={() => {
              setActed("card");
              void connectClaude({ admin: false });
            }}
          >
            Connect
          </PillButton>
          <PillButton onClick={hideClaudeCard}>Not now</PillButton>
        </div>
      </section>
    );
  }

  // Just connected from here: say to restart Claude.
  if (acted && note) return <ClaudeNoteView note={note} />;
  return null;
}
