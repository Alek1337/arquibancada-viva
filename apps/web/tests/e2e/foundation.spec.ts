import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { foundationArtifacts } from "./foundation.setup";

const execFileAsync = promisify(execFile);

test("runs the authenticated technical journey and reconciles after reconnect", async ({
  context,
  page,
}) => {
  const fixture = JSON.parse(await readFile(foundationArtifacts.fixture, "utf8")) as {
    readonly matchId: string;
  };
  await page.goto("/");
  await page.getByLabel("ID da partida técnica").fill(fixture.matchId);
  await page.getByRole("button", { name: "Sincronizar" }).click();

  await expect(page.locator(".ui-status")).toContainText("Placar sincronizado");
  const battery = page.getByRole("button", { name: /Bateria/i });
  await expect(battery).toBeEnabled();
  await battery.click();
  await expect(page.getByText("Ação confirmada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Bateria foi confirmada pela API/u)).toBeVisible();
  await expect(page.locator(".scoreboard__item").filter({ hasText: "Bateria" })).toContainText("2");

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".ui-status")).toContainText("Sem conexão");
  await expect(battery).toBeDisabled();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".ui-status")).toContainText("Placar sincronizado");
  await expect(battery).toBeEnabled();

  if (process.env.FOUNDATION_RESTART_REDIS === "1") {
    await execFileAsync("docker", ["compose", "restart", "redis"], {
      cwd: path.resolve("../.."),
      timeout: 120_000,
    });
    await expect
      .poll(
        async () => {
          const response = await fetch("http://127.0.0.1:3001/v1/ready");
          return response.status;
        },
        { timeout: 30_000 },
      )
      .toBe(200);
    const mosaic = page.getByRole("button", { name: /Mosaico/i });
    await mosaic.click();
    await expect(page.locator(".scoreboard__item").filter({ hasText: "Mosaico" })).toContainText(
      "3",
    );
  }
});
