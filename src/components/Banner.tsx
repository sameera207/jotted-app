import type { Banner as BannerData } from "../store/store";

const ACTIONS = { reconnect: "Reconnect", "check-key": "Check your key" } as const;

type Props = { banner: BannerData; onAction: (action: NonNullable<BannerData["action"]>) => void; onDismiss: () => void };

export function Banner({ banner, onAction, onDismiss }: Props) {
  return (
    <div className="banner" role="status">
      <span className="banner-mark" aria-hidden="true">!</span>
      <span className="banner-message">{banner.message}</span>
      {banner.action && (
        <button type="button" className="banner-action" onClick={() => onAction(banner.action!)}>
          {ACTIONS[banner.action]}
        </button>
      )}
      <button type="button" className="banner-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
