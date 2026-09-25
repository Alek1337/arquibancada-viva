import type { ButtonHTMLAttributes } from "react";

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly description: string;
  readonly label: string;
  readonly symbol: string;
}

export function ActionButton({ description, label, symbol, type, ...props }: ActionButtonProps) {
  return (
    <button className="ui-action" type={type ?? "button"} {...props}>
      <span className="ui-action__symbol" aria-hidden="true">
        {symbol}
      </span>
      <span className="ui-action__copy">
        <strong className="ui-action__label">{label}</strong>
        <span className="ui-action__description">{description}</span>
      </span>
    </button>
  );
}
