import type { ReactNode } from "react";

export interface InlineNoticeProps {
  readonly children: ReactNode;
  readonly kind?: "error" | "info";
  readonly title: string;
}

export function InlineNotice({ children, kind = "info", title }: InlineNoticeProps) {
  return (
    <div
      className={`ui-notice ui-notice--${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      <span className="ui-notice__symbol" aria-hidden="true">
        {kind === "error" ? "!" : "i"}
      </span>
      <span>
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </div>
  );
}
