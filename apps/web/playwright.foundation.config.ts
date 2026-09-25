import { defineConfig, devices } from "@playwright/test";
import { foundationArtifacts } from "./tests/e2e/foundation.setup";

const commonEnvironment = {
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://app:app@127.0.0.1:5432/arquibancada_viva",
  LOG_LEVEL: "warn",
  NODE_ENV: "development",
  REDIS_URL: process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "local-development",
  S3_BUCKET: "arquibancada-viva-local",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_FORCE_PATH_STYLE: "true",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "change-me-development-only-32-characters",
};

export default defineConfig({
  fullyParallel: false,
  globalSetup: "./tests/e2e/foundation.setup.ts",
  projects: [{ name: "foundation-chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: process.env.CI ? "line" : "list",
  testDir: "./tests/e2e",
  testMatch: "foundation.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    storageState: foundationArtifacts.storageState,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --dir ../api exec tsx src/main.ts",
      env: {
        ...commonEnvironment,
        API_DATABASE_POOL_MAX: "10",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        AUTH_BASE_URL: "http://127.0.0.1:3001",
        AUTH_SECRET: "e2e-only-auth-secret-32-characters",
        RATE_LIMIT_AUTH_MAX: "100",
        RATE_LIMIT_GENERAL_MAX: "1000",
        RATE_LIMIT_MUTATION_MAX: "1000",
        TECHNICAL_HARNESS_ENABLED: "true",
        WEB_ORIGIN: "http://127.0.0.1:3000",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3001/v1/ready",
    },
    {
      command: "pnpm --dir ../worker exec tsx src/main.ts",
      env: {
        ...commonEnvironment,
        WORKER_CONCURRENCY: "20",
        WORKER_DATABASE_POOL_MAX: "5",
        WORKER_PROBE_HOST: "127.0.0.1",
        WORKER_PROBE_PORT: "3002",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3002/ready",
    },
    {
      command: "node ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
      env: {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:3001",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3000/health",
    },
  ],
  workers: 1,
});
