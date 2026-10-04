// An 18 px printed box; ticked, a pen stroke that runs past its edges.

type Props = {
  checked: boolean;
  label: string;
  onChange: () => void;
  tabIndex?: number;
};

export function Checkbox({ checked, label, onChange, tabIndex }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="checkbox"
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      <span className="checkbox-box" aria-hidden="true" />
      {checked && (
        <svg className="checkbox-tick" viewBox="0 0 28 26" aria-hidden="true">
          <path d="M3 14.5c2.4 1.6 4.6 4.2 6.4 7.4C13.2 13.6 18.4 6.6 25.4 1.8" />
        </svg>
      )}
    </button>
  );
}
