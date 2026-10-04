// Settings (spec: Screens › 6, mockup 04; specs/Claude-Desktop-spec.md, Settings › Claude).

import { useEffect, useState, type ReactNode } from "react";
import { ClaudeNoteView } from "../components/Claude";
import { FilterTabs } from "../components/FilterTabs";
import { PillButton } from "../components/PillButton";
import { SecretField } from "../components/SecretField";
import { Sheet } from "../components/Sheet";
import { Toggle } from "../components/Toggle";
import type { Settings as SettingsData } from "../jotted/types.gen";
import { appVersion, autostartEnabled, dockIconSupported, openLink, setAutostart, setDockIcon, setKeepRunning } from "../platform";
import { cliUpdateAction } from "../store/cliUpdate";
import { ago, claudeState, folderLabel, REPAIR_MESSAGES } from "../store/labels";
import { readPrefs, writePrefs } from "../store/prefs";
import { chooseModel, removeJev, saveKey, setSetting } from "../store/settings";
import { connectClaude, disconnectClaude, loadClaude, setAddMode, showError, useStore } from "../store/store";

const ADD_MODES: { value: SettingsData["mcp_add_mode"]; label: string }[] = [
  { value: "auto", label: "Add what I ask for straight away" },
  { value: "propose_all", label: "Ask me first" },
];

const INTERVALS: [number, string][] = [
  [60, "Every minute"],
  [120, "Every 2 minutes"],
  [300, "Every 5 minutes"],
  [900, "Every 15 minutes"],
  [1800, "Every 30 minutes"],
  [3600, "Every hour"],
];

export function Settings({ onReview, onReconnect }: { onReview: () => void; onReconnect: () => void }) {
  useEffect(() => void loadClaude(), []);
  return (
    <div className="todo">
      <Sheet title="Settings">
        <DeviceSection onReconnect={onReconnect} />
        <TodoSection />
        <ReadingSection />
        <PluginsSection />
        <ClaudeSection onReview={onReview} />
        <AppSection />
      </Sheet>
    </div>
  );
}

export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {description && <span className="setting-description">{description}</span>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${id}`}>
      <h2 id={`settings-${id}`} className="settings-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- device, checking

function DeviceSection({ onReconnect }: { onReconnect: () => void }) {
  const status = useStore((s) => s.status);
  const settings = useStore((s) => s.settings);
  const source = status?.source;
  const interval = settings?.poll_interval_s ?? 60;
  const options = INTERVALS.some(([s]) => s === interval) ? INTERVALS : [...INTERVALS, [interval, `Every ${interval} s`] as [number, string]];
  return (
    <Section id="device" title="Device">
      <SettingRow
        title={source?.label ?? "Your tablet"}
        description={source ? (source.connected ? `Connected through ${source.label} Cloud` : source.detail) : "…"}
      >
        <PillButton onClick={onReconnect}>Reconnect</PillButton>
      </SettingRow>
      {settings && (
        <SettingRow title="Check for new writing" description="Only changed pages are downloaded">
          <select
            className="field-select"
            aria-label="Check for new writing"
            value={interval}
            onChange={(e) => void setSetting("poll_interval_s", Number(e.target.value))}
          >
            {options.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- To-do on the tablet

function TodoSection() {
  const settings = useStore((s) => s.settings);
  if (!settings) return null;
  const where = [folderLabel(settings.todo_folder), settings.todo_name].filter(Boolean).join(" › ");
  return (
    <Section id="todo" title="To-do on the tablet">
      <SettingRow title="Keep a To-do document on the tablet" description="Tick boxes or write in empty rows with the pen">
        <Toggle checked={settings.todo_enabled} label="Keep a To-do document on the tablet" onChange={(on) => void setSetting("todo_enabled", on)} />
      </SettingRow>
      <SettingRow title="Where it lives" description="2 pages, 40 rows; reprinted with open items when full">
        <code className="setting-value">/{where}</code>
      </SettingRow>
      <SettingRow title="Include others' items" description="Things you're waiting on">
        <Toggle checked={settings.include_others} label="Include others' items" onChange={(on) => void setSetting("include_others", on)} />
      </SettingRow>
    </Section>
  );
}

// ---------------------------------------------------------------- reading handwriting

function keyHint(key: { set: boolean; source: string | null; hint: string | null }): string {
  if (!key.set) return "Not set";
  if (key.source === "environment") return "From your shell";
  return key.hint ?? "Saved";
}

function ReadingSection() {
  const ai = useStore((s) => s.ai);
  const [editing, setEditing] = useState<"model" | "key" | null>(null);
  if (!ai) return null;
  const llm = ai.llm;
  return (
    <Section id="reading" title="Reading handwriting">
      <SettingRow title="Language model" description={`Reads each new line, and judges it unless ${ai.jev.name} is on`}>
        <span className="setting-value">
          {llm.family} · {llm.label} <span className="setting-sub">({llm.model})</span>
        </span>
        <PillButton onClick={() => setEditing(editing === "model" ? null : "model")}>Change model</PillButton>
      </SettingRow>
      {editing === "model" && <ModelEditor onDone={() => setEditing(null)} />}
      <SettingRow
        title="API key"
        description={llm.key.source === "environment" ? "Exported in your shell; it takes precedence over a saved key" : "Stored on this computer only"}
      >
        <code className="setting-value">{keyHint(llm.key)}</code>
        <PillButton onClick={() => setEditing(editing === "key" ? null : "key")}>{llm.key.set ? "Replace" : "Add key"}</PillButton>
      </SettingRow>
      {editing === "key" && (
        <div className="setting-editor">
          <SecretField
            label={`${llm.label} API key`}
            placeholder="sk-ant-…"
            autoFocus
            onSubmit={(key) => saveKey("llm", key)}
            onDone={() => setEditing(null)}
          />
          <button type="button" className="link-button" onClick={() => void openLink(llm.key_url)}>
            Get a key
          </button>
        </div>
      )}
    </Section>
  );
}

export function ModelEditor({ onDone }: { onDone?: () => void }) {
  const ai = useStore((s) => s.ai);
  const [provider, setProvider] = useState(ai?.llm.provider ?? "");
  const [model, setModel] = useState(ai?.llm.model ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ai) return null;
  return (
    <div className="setting-editor">
      <div className="provider-cards" role="radiogroup" aria-label="Provider">
        {ai.llm.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={provider === p.id}
            className={`provider-card ${provider === p.id ? "provider-card-on" : ""}`}
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
        <input className="field-input field-mono" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </label>
      {error && (
        <span className="row-error" role="alert">
          {error}
        </span>
      )}
      <div className="setting-editor-actions">
        <PillButton
          primary
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const problem = await chooseModel(provider, model);
            setBusy(false);
            setError(problem);
            if (!problem) onDone?.();
          }}
        >
          Save
        </PillButton>
        {onDone && <PillButton onClick={onDone}>Cancel</PillButton>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- plugins

function PluginsSection() {
  const ai = useStore((s) => s.ai);
  const settings = useStore((s) => s.settings);
  const [adding, setAdding] = useState(false);
  if (!ai || !settings) return null;
  const jev = ai.jev;
  return (
    <Section id="plugins" title="Plugins">
      <SettingRow
        title={`${jev.name}, from ${jev.by}`}
        description={
          jev.enabled ? `On: judges actions and owners instead of the language model · key ${keyHint(jev.key)}` : "Optional: judges actions and owners instead of the LLM"
        }
      >
        {jev.enabled ? (
          <PillButton onClick={() => void removeJev()}>Remove</PillButton>
        ) : (
          <PillButton onClick={() => setAdding(!adding)}>Add key</PillButton>
        )}
      </SettingRow>
      {adding && !jev.enabled && (
        <div className="setting-editor">
          <SecretField label={`${jev.by} API key`} placeholder="ts_…" autoFocus onSubmit={(key) => saveKey("jev", key)} onDone={() => setAdding(false)} />
          <button type="button" className="link-button" onClick={() => void openLink(jev.key_url)}>
            Get a key
          </button>
        </div>
      )}
      <ThresholdRow value={settings.action_threshold} />
    </Section>
  );
}

function ThresholdRow({ value }: { value: number }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  // Saved once the slider rests, not on every step of a drag.
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => void setSetting("action_threshold", local), 400);
    return () => clearTimeout(t);
  }, [local, value]);
  return (
    <SettingRow title="Action threshold" description="How sure a judge must be before a line becomes an item">
      <input
        type="range"
        className="slider"
        aria-label="Action threshold"
        min={0.5}
        max={0.95}
        step={0.05}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
      />
      <code className="setting-value">{local.toFixed(2)}</code>
    </SettingRow>
  );
}

// ---------------------------------------------------------------- Claude

function ClaudeSection({ onReview }: { onReview: () => void }) {
  const claude = useStore((s) => s.claude);
  const busy = useStore((s) => s.claudeBusy);
  const note = useStore((s) => s.claudeNote);
  const settings = useStore((s) => s.settings);
  const dataEnv = useStore((s) => s.dataEnv);
  const proposed = useStore((s) => Object.keys(s.proposed).length);
  const state = claude ? claudeState(claude, dataEnv) : null;
  // The admin switch: what Claude runs when connected, else the choice for the next Connect.
  const [adminChoice, setAdminChoice] = useState(false);
  const admin = state?.kind === "connected" ? state.admin : adminChoice;

  let description: ReactNode = "Checking…";
  let action: ReactNode = null;
  if (claude && state) {
    switch (state.kind) {
      case "not-connected":
        description = claude.installed ? "Not connected" : "Not connected. Claude Desktop doesn't seem to be installed.";
        action = (
          <PillButton primary disabled={busy} onClick={() => void connectClaude({ admin })}>
            Connect
          </PillButton>
        );
        break;
      case "connected":
        description = <>Connected{state.admin ? ", with admin tools" : ""}. Disconnect before you remove Jotted.</>;
        action = (
          <PillButton disabled={busy} onClick={() => void disconnectClaude()}>
            Disconnect
          </PillButton>
        );
        break;
      case "repair":
        description = `Needs repair: ${REPAIR_MESSAGES[state.reason]}`;
        action = (
          <PillButton primary disabled={busy} onClick={() => void connectClaude()}>
            Repair
          </PillButton>
        );
        break;
      case "another":
        description = (
          <>
            Claude runs a different <code>jotted</code> ({state.command}).
          </>
        );
        action = (
          <PillButton disabled={busy} onClick={() => void connectClaude()}>
            Use this app's Jotted
          </PillButton>
        );
        break;
      case "other-data":
        description = (
          <>
            Claude reads another Jotted data folder (<code>{state.config ?? state.home ?? "the default"}</code>), so it sees a different list.
          </>
        );
        action = (
          <PillButton disabled={busy} onClick={() => void connectClaude()}>
            Use this app's Jotted
          </PillButton>
        );
        break;
    }
  } else if (note) {
    description = "Couldn't read Claude Desktop's settings.";
  }

  return (
    <Section id="claude" title="Claude">
      <SettingRow title="Claude Desktop" description={description}>
        {action}
      </SettingRow>
      {note && <ClaudeNoteView note={note} />}
      {settings && (
        <SettingRow title="Items Claude adds" description="Ask me first: everything Claude adds waits in Proposed by Claude.">
          <FilterTabs label="Items Claude adds" options={ADD_MODES} value={settings.mcp_add_mode} onChange={(m) => void setAddMode(m)} />
        </SettingRow>
      )}
      <SettingRow
        title="Let Claude change what Jotted reads"
        description="Claude can change watched folders and settings. Only turn this on if you trust every document you ask Claude to read."
      >
        <Toggle
          checked={admin}
          label="Let Claude change what Jotted reads"
          disabled={busy}
          onChange={(on) => {
            setAdminChoice(on);
            // Connected: reconnect with (or without) --admin. Otherwise it applies at Connect.
            if (state?.kind === "connected") void connectClaude({ admin: on });
          }}
        />
      </SettingRow>
      {settings && (
        <SettingRow title="Proposals waiting" description={`${proposed} of ${settings.proposed_limit}`}>
          <PillButton disabled={proposed === 0} onClick={onReview}>
            Review
          </PillButton>
        </SettingRow>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- app

function AppSection() {
  const version = useStore((s) => s.version);
  const [login, setLogin] = useState<boolean | null>(null);
  const [keep, setKeep] = useState(readPrefs().keepRunning);
  const [hideDock, setHideDock] = useState(readPrefs().hideDock);
  const [app, setApp] = useState<string | null>(null);
  useEffect(() => {
    void autostartEnabled().then(setLogin, () => setLogin(null));
    void appVersion().then(setApp);
  }, []);
  const versions = [app ? `Jotted app ${app}` : null, version ? `jotted ${version.version}${version.bundled ? "" : " (development)"}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section id="app" title="App">
      <SettingRow title="Open at login" description={login === null ? "In the installed app" : "Starts in the menu bar, without a window"}>
        <Toggle
          checked={login ?? false}
          disabled={login === null}
          label="Open at login"
          onChange={async (on) => {
            try {
              await setAutostart(on);
              setLogin(on);
            } catch (e) {
              showError(e);
            }
          }}
        />
      </SettingRow>
      <SettingRow title="Keep running in the menu bar" description="Closing the window keeps Jotted checking">
        <Toggle
          checked={keep}
          label="Keep running in the menu bar"
          onChange={(on) => {
            writePrefs({ keepRunning: on });
            setKeep(on);
            void setKeepRunning(on);
          }}
        />
      </SettingRow>
      {dockIconSupported() && (
        <SettingRow title="Hide the Dock icon" description="Jotted lives only in the menu bar">
          <Toggle
            checked={hideDock}
            label="Hide the Dock icon"
            onChange={(on) => {
              writePrefs({ hideDock: on });
              setHideDock(on);
              void setDockIcon(!on).catch(showError);
            }}
          />
        </SettingRow>
      )}
      <JottedRows />
      {app && (
        <SettingRow title="The app" description={versions || undefined}>
          <span className="setting-value setting-sub">App updates arrive with signed release builds</span>
        </SettingRow>
      )}
    </Section>
  );
}

const day = (secs: number) => new Date(secs * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** The jotted CLI the app runs, and its updates (specs/CLI-updates-spec.md, Settings). */
function JottedRows() {
  const update = useStore((s) => s.cliUpdate);
  const version = useStore((s) => s.version);
  if (!update) {
    // A browser: no updates, just what runs.
    return version ? <SettingRow title="Jotted" description={`Jotted ${version.version} (contract ${version.contract})`} /> : null;
  }
  const { active, bundled, available } = update;
  const origin = active.from_app
    ? "came with the app"
    : `installed ${active.installed_at ? day(active.installed_at) : "here"}; came with the app: ${bundled.version}`;
  const checked = update.last_check ? `checked ${ago(new Date(update.last_check * 1000).toISOString())}` : "not checked yet";
  const off =
    update.off === "development" ? "Updates are off while JOTTED_BIN is set." : update.off === "no-key" ? "Updates are off in this build (no release key)." : null;
  return (
    <>
      <SettingRow title="Jotted" description={<>Jotted {active.version} (contract {active.contract}) · {origin}<br />{off ?? checked}</>}>
        {!off && (
          <PillButton disabled={update.busy} onClick={() => void cliUpdateAction("cli_update_check")}>
            {update.busy ? "Updating…" : "Check now"}
          </PillButton>
        )}
      </SettingRow>
      {!off && (
        <SettingRow title="Update automatically" description="New Jotted releases install on their own, checked and signed">
          <Toggle checked={update.auto} label="Update automatically" onChange={(on) => void cliUpdateAction("cli_update_set_auto", { on })} />
        </SettingRow>
      )}
      {available && available.compatible && !update.auto && (
        <SettingRow title={`Jotted ${available.version} is available`}>
          <PillButton primary disabled={update.busy} onClick={() => void cliUpdateAction("cli_update_install")}>
            Install
          </PillButton>
        </SettingRow>
      )}
      {available && !available.compatible && (
        <SettingRow title={`Jotted ${available.version} needs a newer app`} description="It speaks a newer contract; an app update brings it." />
      )}
      {update.problem && <SettingRow title={update.problem} description="Nothing was downloaded. The log has the details." />}
      {update.skipped.map((v) => (
        <SettingRow key={v} title={`${v} didn't start and was skipped`}>
          <PillButton onClick={() => void cliUpdateAction("cli_update_retry", { version: v })}>Try again</PillButton>
        </SettingRow>
      ))}
    </>
  );
}
