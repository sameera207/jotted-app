import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { PillButton } from "./PillButton";

type Props = {
  title: string;
  children: ReactNode;
  confirm: string;
  cancel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A modal question. Focus starts on Cancel and stays inside; Escape cancels; focus goes back after. */
export function ConfirmDialog({ title, children, confirm, cancel = "Cancel", onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => before?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keep the window's shortcuts (N, Escape on the peek) from acting behind the dialog.
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div className="panel-backdrop" role="presentation">
      <div
        ref={dialog}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onKeyDown={onKeyDown}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message">{children}</p>
        <div className="panel-actions">
          <PillButton ref={cancelRef} onClick={onCancel}>
            {cancel}
          </PillButton>
          <PillButton primary onClick={onConfirm}>
            {confirm}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
