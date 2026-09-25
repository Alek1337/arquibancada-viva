import { createTestPublicId } from "@arquibancada-viva/testing";
import { request, type FullConfig } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const foundationArtifacts = {
  fixture: path.resolve("test-results/foundation-fixture.json"),
  storageState: path.resolve("test-results/foundation-storage-state.json"),
};

export default async function foundationSetup(_config: FullConfig): Promise<void> {
  await mkdir(path.dirname(foundationArtifacts.fixture), { recursive: true });
  const api = await request.newContext({
    baseURL: "http://127.0.0.1:3001",
    extraHTTPHeaders: { origin: "http://127.0.0.1:3000" },
  });
  try {
    const signUp = await api.post("/v1/auth/sign-up/email", {
      data: {
        email: `playwright-${Date.now()}@example.test`,
        name: "Playwright TFT-016",
        password: "Strong-password-42",
      },
    });
    if (!signUp.ok()) {
      throw new Error(`E2E_SIGN_UP_FAILED:${signUp.status()}`);
    }
    const matchId = createTestPublicId();
    const seed = await api.post(`/v1/technical/matches/${matchId}/actions`, {
      data: { action: "battery", version: 1 },
      headers: { "idempotency-key": `playwright-seed-${createTestPublicId()}` },
    });
    if (seed.status() !== 202) {
      throw new Error(`E2E_MATCH_SEED_FAILED:${seed.status()}`);
    }
    await api.storageState({ path: foundationArtifacts.storageState });
    await writeFile(foundationArtifacts.fixture, JSON.stringify({ matchId }), "utf8");
  } finally {
    await api.dispose();
  }
}
