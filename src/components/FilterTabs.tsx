type Props<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** A row of word tabs; the chosen one is bold and underlined (never colour alone). */
export function FilterTabs<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="tabs" role="radiogroup" aria-label={label}>
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
