import type { SourceLabel } from "../store/labels";

type Props = { label: SourceLabel; mark: string };

/** Where a row came from: the device's mark and the page, "Added in Jotted", or Claude and its source. */
export function SourceLine({ label, mark }: Props) {
  return (
    <span className="source">
      {label.kind === "added" ? (
        <span className="source-mark source-mark-added" aria-hidden="true">+</span>
      ) : label.kind === "agent" ? (
        <span className="source-mark source-mark-added" aria-hidden="true">✳</span>
      ) : (
        <span className="source-mark" aria-hidden="true">{mark}</span>
      )}
      <span>{label.text}</span>
    </span>
  );
}
