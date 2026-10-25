type Props<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** "strong": the chosen tab filled with ink, for the main filter; otherwise a light wash. */
  tone?: "strong";
};

/** A row of pill tabs; the chosen one is filled and heavier (never colour alone). */
export function FilterTabs<T extends string>({ label, options, value, onChange, tone }: Props<T>) {
  return (
    <div className={`tabs ${tone === "strong" ? "tabs-strong" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`tab ${o.value === value ? "tab-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
