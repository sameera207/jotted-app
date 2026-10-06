// A short note after a change, at the bottom of the content: ink on paper, inverted, for 5 s,
// one at a time, with Undo when the change can be undone.

import { useEffect } from "react";
import { dismissToast, useStore } from "../store/store";

const SHOWN_MS = 5000;

export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dismissToast(toast.id), SHOWN_MS);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="toast-undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
