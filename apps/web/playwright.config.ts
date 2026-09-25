import { defineConfig, devices, type Project } from "@playwright/test";

const projects: Project[] = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
  { name: "chrome-android", use: { ...devices["Pixel 7"] } },
  { name: "safari-ios", use: { ...devices["iPhone 15"] } },
];

export default defineConfig({
  fullyParallel: false,
  projects:
    process.env.PLAYWRIGHT_SKIP_FIREFOX === "1"
      ? projects.filter((project) => project.name !== "firefox")
      : projects,
  reporter: process.env.CI ? "line" : "list",
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
    env: {
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
      NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:3001",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000/health",
  },
});
