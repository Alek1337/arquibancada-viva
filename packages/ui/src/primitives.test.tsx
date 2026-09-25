import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton } from "./action-button.js";
import { InlineNotice } from "./inline-notice.js";
import { StatusIndicator } from "./status-indicator.js";

describe("accessible UI primitives", () => {
  it("announces status with text and a non-color symbol", () => {
    const markup = renderToStaticMarkup(
      <StatusIndicator label="Conectado" detail="Placar sincronizado" tone="online" />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Conectado");
    expect(markup).toContain("✓");
  });

  it("uses an assertive alert for errors", () => {
    const markup = renderToStaticMarkup(
      <InlineNotice kind="error" title="Falha segura">
        Tente novamente.
      </InlineNotice>,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
  });

  it("preserves native disabled semantics for actions", () => {
    const markup = renderToStaticMarkup(
      <ActionButton disabled description="Instrumentos e ritmo" label="Bateria" symbol="B" />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("Bateria");
  });
});
