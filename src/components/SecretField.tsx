// A key field: masked, pasted, sent on stdin by whoever handles `onSubmit`, then cleared
// whether it worked or not, so the key never stays in the page.

import { useState } from "react";
import { PillButton } from "./PillButton";

type Props = {
  label: string;
  placeholder?: string;
  action?: string;
  /** Resolves to an error to show by the field, or null when saved. */
  onSubmit: (secret: string) => Promise<string | null>;
  onDone?: () => void;
  autoFocus?: boolean;
};

export function SecretField({ label, placeholder, action = "Check key", onSubmit, onDone, autoFocus }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    const secret = value;
    setValue("");
    setBusy(true);
    setError(null);
    const problem = await onSubmit(secret);
    setBusy(false);
    if (problem) setError(problem);
    else onDone?.();
  };
  return (
    <div className="secret">
      <label className="field-label">
        {label}
        <span className="secret-row">
          <input
            className="field-input field-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={value}
            autoFocus={autoFocus}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <PillButton disabled={busy || !value.trim()} onClick={() => void submit()}>
            {busy ? "Checking…" : action}
          </PillButton>
        </span>
      </label>
      {error && (
        <span className="row-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
