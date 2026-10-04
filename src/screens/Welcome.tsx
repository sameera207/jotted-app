// Welcome (spec: Screens › 1, mockup 05): what you need before setting up. The ticks are a
// checklist for the person; nothing is checked. No commands.

import { useState } from "react";
import { Checkbox } from "../components/Checkbox";
import { PillButton } from "../components/PillButton";
import { openLink } from "../platform";
import { startSetup } from "../store/startup";

const NEEDS = [
  {
    id: "cloud",
    title: "A reMarkable with cloud sync",
    text: "Your notes have to reach reMarkable Cloud, which needs a Connect subscription. Jotted works with any tablet that syncs.",
    link: ["About Connect", "https://remarkable.com/store/connect"],
    required: true,
  },
  {
    id: "account",
    title: "Your reMarkable account",
    text: "You sign in at my.remarkable.com once to get a one-time code that connects this computer.",
    link: ["my.remarkable.com", "https://my.remarkable.com"],
    required: true,
  },
  {
    id: "llm",
    title: "An API key for a language model",
    text: "Anthropic (Claude) today. The model reads your handwriting; you pay the provider directly for what it reads, usually cents a day.",
    link: ["Get an Anthropic key", "https://console.anthropic.com/settings/keys"],
    required: true,
  },
  {
    id: "jev",
    title: "A TypeSafe key, for the Jev plugin",
    text: "Jev judges which lines are tasks and whose they are. Skip it and the language model does that too. You can add it later in Settings.",
    link: null,
    required: false,
  },
] as const;

export function Welcome() {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const ready = NEEDS.filter((n) => n.required).every((n) => ticked.has(n.id));
  return (
    <div className="gate" data-tauri-drag-region>
      <div className="gate-card welcome">
        <p className="welcome-hello" aria-hidden="true">
          hello —
        </p>
        <h1>Your handwriting, as a to-do list</h1>
        <p className="welcome-intro">
          Jotted reads the notebooks you choose on your reMarkable, picks out the lines that are tasks and whose they are, and keeps
          one list: here, and on the tablet where you can tick it with the pen.
        </p>
        <h2 className="settings-heading">Before you start</h2>
        <ul className="needs">
          {NEEDS.map((n) => (
            <li key={n.id} className="need">
              <Checkbox
                checked={ticked.has(n.id)}
                label={n.title}
                onChange={() =>
                  setTicked((t) => {
                    const next = new Set(t);
                    next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                    return next;
                  })
                }
              />
              <div className="need-body">
                <span className="need-title">{n.title}</span>
                <span className="need-text">{n.text}</span>
                {n.link && (
                  <button type="button" className="link-button need-link" onClick={() => void openLink(n.link[1])}>
                    {n.link[0]}
                  </button>
                )}
              </div>
              <span className="need-tag">{n.required ? "Required" : "Optional"}</span>
            </li>
          ))}
        </ul>
        <p className="privacy">
          <svg className="privacy-lock" viewBox="0 0 16 18" aria-hidden="true">
            <rect x="2" y="8" width="12" height="9" rx="1.5" />
            <path d="M5 8V5.5a3 3 0 0 1 6 0V8" />
          </svg>
          Jotted runs on this computer. Images of new lines go straight to the model provider you pick,
          with your own key. Nothing passes through a server of ours.
        </p>
        <div className="welcome-go">
          {ready ? (
            <PillButton primary onClick={startSetup}>
              I have these. Set up
            </PillButton>
          ) : (
            <span className="welcome-wait">Tick the three you need to continue</span>
          )}
          <span className="setting-sub">About 5 minutes</span>
        </div>
      </div>
    </div>
  );
}
