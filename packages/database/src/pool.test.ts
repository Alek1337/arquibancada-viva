import { describe, expect, it } from "vitest";
import { createPoolConfig } from "./pool.js";

describe("database pools", () => {
  it("isolates API and worker pools by name and limit", () => {
    const connectionString = "postgresql://app:app@localhost:5432/app";
    const api = createPoolConfig("api", connectionString, 10);
    const worker = createPoolConfig("worker", connectionString, 5);

    expect(api).toMatchObject({
      application_name: "arquibancada-viva-api",
      connectionString,
      max: 10,
    });
    expect(worker).toMatchObject({
      application_name: "arquibancada-viva-worker",
      connectionString,
      max: 5,
    });
    expect(api.application_name).not.toBe(worker.application_name);
  });

  it("keeps the migration pool single-connection", () => {
    expect(createPoolConfig("migration", "postgresql://local", 1)).toMatchObject({
      application_name: "arquibancada-viva-migration",
      max: 1,
    });
  });

  it("rejects invalid pool limits", () => {
    expect(() => createPoolConfig("api", "postgresql://local", 0)).toThrow(RangeError);
    expect(() => createPoolConfig("api", "postgresql://local", 1.5)).toThrow(RangeError);
  });
});
