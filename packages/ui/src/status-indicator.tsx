export type StatusTone = "neutral" | "offline" | "online" | "syncing";

export interface StatusIndicatorProps {
  readonly detail?: string;
  readonly label: string;
  readonly tone: StatusTone;
}

const symbols: Record<StatusTone, string> = {
  neutral: "—",
  offline: "×",
  online: "✓",
  syncing: "↻",
};

export function StatusIndicator({ detail, label, tone }: StatusIndicatorProps) {
  return (
    <div
      className={`ui-status ui-status--${tone}`}
      role="status"
      aria-atomic="true"
      aria-live="polite"
    >
      <span className="ui-status__symbol" aria-hidden="true">
        {symbols[tone]}
      </span>
      <span>
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </span>
    </div>
  );
}
