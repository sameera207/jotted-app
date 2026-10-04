type Props = { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean };

/** An on/off switch, as in the Settings mockup. */
export function Toggle({ checked, label, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "toggle-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  );
}
