// Setup (spec: Screens › 2, mockups 06 and 07). Driven by `setup status`, never a hard-coded
// list: the steps, their order, "step n of m" and which are optional all come from it.
// Known step ids get their own screen; any other gets a generic one. Keys and one-time codes
// go on stdin and are cleared from the page as soon as they're sent.

import { useEffect, useState } from "react";
import { PillButton } from "../components/PillButton";
import { SecretField } from "../components/SecretField";
import * as jotted from "../jotted/client";
import { JottedError } from "../jotted/errors";
import type { SetupStatus, SetupStep } from "../jotted/types.gen";
import { openLink } from "../platform";
import { chooseModel, loadLibrary, reloadAi, saveKey } from "../store/settings";
import { finishSetup } from "../store/startup";
import { reloadStatus, useStore } from "../store/store";
import { FolderPicker } from "./Notebooks";

const GET_A_CODE = "https://my.remarkable.com/device/desktop/connect";

export function Setup() {
  const phase = useStore((s) => s.phase);
  const reconnect = phase.kind === "setup" && !!phase.reconnect;
  const [status, setStatus] = useState<SetupStatus | null>(phase.kind === "setup" ? (phase.setup ?? null) : null);
  const [preparing, setPreparing] = useState(!reconnect);
  const [problem, setProblem] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // `setup prepare` finished setup on its own: this computer already had jotted set up.
  const [already, setAlready] = useState(false);

  const refresh = async () => {
    try {
      const next = await jotted.setupStatus();
      setStatus(next);
      if (next.complete && !reconnect) {
        // Optional steps not yet seen still get their turn before the list opens.
        const pending = next.steps.find((s) => !s.done && s.optional && !skipped.has(s.id));
        if (!pending) await finishSetup();
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const prepare = async () => {
    setPreparing(true);
    setProblem(null);
    try {
      const prepared = await jotted.setupPrepare();
      setStatus({ complete: prepared.complete, steps: prepared.steps });
      setAlready(prepared.complete && !prepared.steps.some((s) => !s.done));
      await reloadAi();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      // Still show the steps, so it's clear which one failed.
      await jotted.setupStatus().then(setStatus, () => {});
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    if (!reconnect) void prepare();
  }, [reconnect]);

  if (reconnect) {
    return (
      <SetupCard title="Reconnect your reMarkable" meta={null}>
        <ConnectStep
          replacing
          onDone={async () => {
            await reloadStatus();
            useStore.setState({ phase: { kind: "ready" } });
          }}
        />
        <div className="setup-foot">
          <button type="button" className="link-button" onClick={() => useStore.setState({ phase: { kind: "ready" } })}>
            Back to Jotted
          </button>
        </div>
      </SetupCard>
    );
  }

  const steps = status?.steps ?? [];
  const current = steps.find((s) => !s.done && !skipped.has(s.id));
  const index = current ? steps.indexOf(current) + 1 : steps.length;
  const optionalLeft = current?.optional ?? false;

  return (
    <SetupCard title="Set up Jotted" meta={steps.length ? `step ${index} of ${steps.length}` : null}>
      <p className="setup-intro">A few steps, once. Everything stays on this computer.</p>
      {preparing && <p className="setup-note" role="status">Preparing this computer…</p>}
      {problem && (
        <p className="row-error" role="alert">
          {problem}{" "}
          <button type="button" className="link-button" onClick={() => void prepare()}>
            Try again
          </button>
        </p>
      )}
      <ol className="setup-steps">
        {steps.map((step) => (
          <li key={step.id} className={`setup-step ${step === current ? "setup-step-on" : ""} ${step.done ? "setup-step-done" : ""}`}>
            <span className={`setup-mark ${step.optional ? "setup-mark-optional" : ""}`} aria-hidden="true">
              {step.done ? "✓" : ""}
            </span>
            <div className="setup-body">
              <h2 className="setup-title">
                {step.title}
                {step.optional && <span className="setting-sub"> · optional</span>}
                <span className="visually-hidden">{step.done ? ": done" : skipped.has(step.id) ? ": skipped" : ""}</span>
              </h2>
              {step.done && step.detail && <span className="setup-detail">{step.detail}</span>}
              {step === current && <StepScreen step={step} onDone={() => void refresh()} />}
            </div>
          </li>
        ))}
      </ol>
      {already && !current && (
        <div className="setup-foot">
          <p className="setup-note">Everything was already set up on this computer, by jotted: the steps above say what it found.</p>
          <PillButton primary onClick={() => void finishSetup()}>
            Open Jotted
          </PillButton>
        </div>
      )}
      {optionalLeft && current && (
        <div className="setup-foot">
          <PillButton
            onClick={() => {
              setSkipped((s) => new Set(s).add(current.id));
              if (status?.complete) void finishSetup();
            }}
          >
            Skip this
          </PillButton>
        </div>
      )}
    </SetupCard>
  );
}

function SetupCard({ title, meta, children }: { title: string; meta: string | null; children: React.ReactNode }) {
  return (
    <div className="gate" data-tauri-drag-region>
      <div className="gate-card setup">
        <header className="sheet-head">
          <h1>{title}</h1>
          {meta && <span className="sheet-meta">{meta}</span>}
        </header>
        {children}
      </div>
    </div>
  );
}

function StepScreen({ step, onDone }: { step: SetupStep; onDone: () => void }) {
  switch (step.id) {
    case "remarkable.connect":
      return <ConnectStep onDone={onDone} />;
    case "llm":
      return <LlmStep onDone={onDone} />;
    case "jev":
      return <JevStep onDone={onDone} />;
    case "folders":
      return <FoldersStep onDone={onDone} />;
    default:
      return <GenericStep step={step} onDone={onDone} />;
  }
}

// ---------------------------------------------------------------- the reMarkable

function ConnectStep({ onDone, replacing = false }: { onDone: () => void; replacing?: boolean }) {
  const [code, setCode] = useState("");
  const [replace, setReplace] = useState(replacing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const submit = async () => {
    const sent = code.trim();
    if (sent.length !== 8 || busy) return;
    setCode(""); // a one-time code: never kept once sent
    setBusy(true);
    setError(null);
    try {
      await jotted.connect(sent, { replace });
      onDone();
    } catch (e) {
      if (e instanceof JottedError && e.code === "conflict") setConflict(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="step-screen">
      <p className="setup-detail">Sign in at my.remarkable.com, open "Connect a desktop app" and type the one-time code here.</p>
      <label className="field-label">
        One-time code
        <input
          className="field-input code-field"
          value={code}
          maxLength={8}
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="abcdefgh"
          disabled={busy}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^a-z]/gi, "").toLowerCase());
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
      </label>
      {error && (
        <span className="row-error" role="alert">
          {error}
        </span>
      )}
      <div className="setting-editor-actions">
        <PillButton primary disabled={busy || code.trim().length !== 8} onClick={() => void submit()}>
          {busy ? "Connecting…" : replace ? "Replace the connection" : "Connect"}
        </PillButton>
        {conflict && !replace && (
          <PillButton
            onClick={() => {
              setReplace(true);
              setError("Get a new code, then press Replace the connection.");
            }}
          >
            Replace the connection
          </PillButton>
        )}
        <button type="button" className="link-button" onClick={() => void openLink(GET_A_CODE)}>
          Get a code
        </button>
      </div>
      <p className="setup-note">The code works once. Jotted keeps the token it gets in your app folder, readable by your user only.</p>
    </div>
  );
}

// ---------------------------------------------------------------- the language model

function LlmStep({ onDone }: { onDone: () => void }) {
  const ai = useStore((s) => s.ai);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => void (ai ? undefined : reloadAi()), [ai]);
  if (!ai) return <p className="setup-note">Loading…</p>;
  const llm = ai.llm;
  const chosen = provider ?? llm.provider;
  const label = llm.providers.find((p) => p.id === chosen)?.label ?? llm.label;
  return (
    <div className="step-screen">
      <p className="setup-detail">
        Jotted sends the model a picture of each new line you wrote; the model turns it into text. It also decides whether the line
        is a task, unless a plugin does that.
      </p>
      <div className="provider-cards" role="radiogroup" aria-label="Provider">
        {llm.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={chosen === p.id}
            className={`provider-card ${chosen === p.id ? "provider-card-on" : ""}`}
            onClick={() => setProvider(p.id)}
          >
            <span className="provider-dot" aria-hidden="true" />
            {p.label}
          </button>
        ))}
        <div className="provider-card provider-card-more" aria-hidden="true">
          More providers arrive as plugins
        </div>
      </div>
      <label className="field-label">
        Model · needs to read images
        <input className="field-input field-mono" value={model ?? llm.model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
      </label>
      <SecretField
        label={`${label} API key`}
        placeholder="sk-ant-…"
        onSubmit={async (key) => (await chooseModel(chosen, model ?? llm.model)) ?? (await saveKey("llm", key))}
        onDone={onDone}
      />
      <div className="setting-editor-actions">
        <button type="button" className="link-button" onClick={() => void openLink(llm.key_url)}>
          Get a key
        </button>
      </div>
      <p className="setup-note">Saved on this computer only, readable by your user. A key exported in your shell takes precedence.</p>
    </div>
  );
}

// ---------------------------------------------------------------- plugins

function JevStep({ onDone }: { onDone: () => void }) {
  const ai = useStore((s) => s.ai);
  const jev = ai?.jev;
  return (
    <div className="step-screen">
      <p className="setup-detail">Plugins can take over a job from the language model. Add a key to turn one on; remove it to turn it off.</p>
      <div className="plugin-card">
        <div className="plugin-head">
          <span>
            <strong>{jev?.name ?? "Jev"}</strong> from {jev?.by ?? "TypeSafe"}
          </span>
          <span className="setting-sub">Judges actions and owners</span>
        </div>
        <SecretField label={`${jev?.by ?? "TypeSafe"} API key`} placeholder="ts_…" onSubmit={(key) => saveKey("jev", key)} onDone={onDone} />
      </div>
      <p className="setup-note">Plugins you install later show up here and in Settings.</p>
    </div>
  );
}

// ---------------------------------------------------------------- folders

function FoldersStep({ onDone }: { onDone: () => void }) {
  const library = useStore((s) => s.library);
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    void loadLibrary();
    if (!useStore.getState().settings) void jotted.settings().then((s) => useStore.setState({ settings: s }), () => {});
  }, []);
  if (!library || !settings) return <p className="setup-note">Loading your notebooks…</p>;
  return (
    <div className="step-screen">
      <p className="setup-detail">Tick what Jotted should read. You can change these any time in Notebooks.</p>
      <FolderPicker folders={library.folders} settings={settings} compact />
      <div className="setting-editor-actions">
        <PillButton primary disabled={settings.watch.length === 0} onClick={onDone}>
          Continue
        </PillButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- anything else

/** A step this app has no screen for: a field when its command reads stdin, else a terminal. */
function GenericStep({ step, onDone }: { step: SetupStep; onDone: () => void }) {
  const command = (step.command ?? "").replace(/^jotted\s+/, "");
  if (command.endsWith("--stdin")) {
    return (
      <div className="step-screen">
        <SecretField
          label={step.title}
          action="Save"
          onSubmit={async (secret) => {
            try {
              await jotted.run(command.split(/\s+/), secret);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : String(e);
            }
          }}
          onDone={onDone}
        />
      </div>
    );
  }
  return (
    <div className="step-screen">
      <p className="setup-detail">
        Run <code>jotted {command || "setup"}</code> in a terminal, then check again.
      </p>
      <PillButton onClick={onDone}>Check again</PillButton>
    </div>
  );
}
