import { describe, expect, it } from "vitest";
import { parseApiConfig } from "../src/api.js";
import { parseWorkerConfig } from "../src/worker.js";
import { parseClientConfig } from "../src/client.js";

const base = {
  DATABASE_URL: "postgres://synthetic:synthetic@localhost/test",
  REDIS_URL: "redis://localhost:6379",
  AUTH_BASE_URL: "http://localhost:3001",
  WEB_ORIGIN: "http://localhost:3000",
  AUTH_SECRET: "synthetic-auth-key-for-configuration-tests",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "local",
  S3_BUCKET: "synthetic",
  S3_ACCESS_KEY_ID: "synthetic",
  S3_SECRET_ACCESS_KEY: "synthetic-config-tests-only-long-secret",
};
const keyring = JSON.stringify({ "synthetic-v1": "ab".repeat(32) });

describe("private match engine configuration", () => {
  for (const parse of [parseApiConfig, parseWorkerConfig]) {
    it(`${parse.name}: defaults disabled without private keys`, () => {
      expect(parse(base)).toMatchObject({
        MATCH_ENGINE_ENABLED: false,
        MATCH_RNG_KEYRING_JSON: {},
      });
    });
    it(`${parse.name}: supports all existing NODE_ENV values`, () => {
      for (const NODE_ENV of ["development", "test", "production"]) {
        const result = parse({
          ...base,
          NODE_ENV,
          MATCH_ENGINE_ENABLED: "true",
          MATCH_RNG_ACTIVE_KEY_VERSION: "synthetic-v1",
          MATCH_RNG_KEYRING_JSON: keyring,
        });
        expect(result.MATCH_ENGINE_ENABLED).toBe(true);
        expect(Object.isFrozen(result.MATCH_RNG_KEYRING_JSON)).toBe(true);
      }
    });
    it(`${parse.name}: enabled requires current key and fails closed`, () => {
      for (const input of [
        {},
        { MATCH_RNG_ACTIVE_KEY_VERSION: "missing" },
        { MATCH_RNG_ACTIVE_KEY_VERSION: "other", MATCH_RNG_KEYRING_JSON: keyring },
      ]) {
        expect(() => parse({ ...base, MATCH_ENGINE_ENABLED: "true", ...input })).toThrow();
      }
    });
    it(`${parse.name}: rejects malformed keys without leaking raw input`, () => {
      for (const raw of [
        "synthetic-sensitive-invalid-json",
        JSON.stringify({ bad: "synthetic-private-invalid-key" }),
        "[]",
        "null",
        JSON.stringify({ bad: "AB".repeat(32) }),
      ]) {
        let failure: unknown;
        try {
          parse({ ...base, MATCH_RNG_KEYRING_JSON: raw });
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).not.toContain(raw);
        expect(String(failure)).not.toContain("synthetic-private-invalid-key");
      }
    });
  }
  it("never exposes flag, key version, or private keyring in client result", () => {
    expect(
      parseClientConfig({
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
        NEXT_PUBLIC_SOCKET_URL: "http://localhost:3001",
        MATCH_ENGINE_ENABLED: "true",
        MATCH_RNG_ACTIVE_KEY_VERSION: "synthetic-v1",
        MATCH_RNG_KEYRING_JSON: keyring,
      }),
    ).toEqual({
      NEXT_PUBLIC_API_URL: "http://localhost:3001",
      NEXT_PUBLIC_SOCKET_URL: "http://localhost:3001",
    });
  });
});
