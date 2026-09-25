import { expect, test } from "@playwright/test";

test("renders the connected shell with visible keyboard focus", async ({ browserName, page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: /faça a arquibancada pulsar/i }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Aguardando partida");
  await expect(page.getByRole("button", { name: /Bateria/i })).toBeDisabled();

  const skipLink = page.getByRole("link", { name: "Pular para a partida" });
  if (browserName === "webkit") {
    await skipLink.focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#arena")).toBeFocused();
});

test("announces offline state and never enables competitive actions", async ({ context, page }) => {
  await page.goto("/");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByRole("status")).toContainText("Sem conexão");
  await expect(page.getByRole("button", { name: /Bateria/i })).toBeDisabled();
  await expect(page.getByText(/comandos permanecem bloqueados/i)).toBeAttached();
});
