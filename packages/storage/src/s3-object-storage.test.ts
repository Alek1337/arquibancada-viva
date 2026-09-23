import type { StorageConfig } from "@arquibancada-viva/config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createS3ObjectStorageForTesting, StorageValidationError } from "./s3-object-storage.js";

const config: StorageConfig = {
  S3_ACCESS_KEY_ID: "unit-test-access",
  S3_BUCKET: "unit-test-bucket",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_FORCE_PATH_STYLE: true,
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "unit-test-secret-with-32-characters",
};
const objectId = "018f47a0-7b21-7b42-8f65-6d2e1c34a123";

describe("S3-compatible object storage", () => {
  it("ignores a hostile source name and uploads only to quarantine", async () => {
    const commands: unknown[] = [];
    const storage = createS3ObjectStorageForTesting(config, {
      idFactory: () => objectId,
      send: async (command) => {
        commands.push(command);
        return { ETag: "fixture" };
      },
    });

    const reference = await storage.uploadQuarantinedObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      sourceFilename: "../../public/approved/owned.svg",
    });

    expect(reference).toEqual({
      key: `quarantine/originals/${objectId}`,
      stage: "quarantine",
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: config.S3_BUCKET,
      ContentLength: 3,
      ContentType: "image/png",
      Key: `quarantine/originals/${objectId}`,
    });
    expect((commands[0] as PutObjectCommand).input).not.toHaveProperty("ACL");
  });

  it("promotes only the validated source and deletes that exact quarantine key", async () => {
    const commands: unknown[] = [];
    const storage = createS3ObjectStorageForTesting(config, {
      send: async (command) => {
        commands.push(command);
        return {};
      },
    });
    const source = {
      key: `quarantine/originals/${objectId}`,
      stage: "quarantine",
    } as const;

    const promoted = await storage.promoteObject({ destination: "approved", source });

    expect(promoted).toEqual({ key: `public/approved/${objectId}`, stage: "approved" });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(CopyObjectCommand);
    expect((commands[0] as CopyObjectCommand).input).toMatchObject({
      Bucket: config.S3_BUCKET,
      CopySource: `${config.S3_BUCKET}/quarantine/originals/${objectId}`,
      Key: `public/approved/${objectId}`,
    });
    expect(commands[1]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[1] as DeleteObjectCommand).input.Key).toBe(source.key);
  });

  it("creates only short-lived signed GET URLs for managed keys", async () => {
    const commands: unknown[] = [];
    const signatures: [GetObjectCommand, number][] = [];
    const storage = createS3ObjectStorageForTesting(config, {
      clock: () => new Date("2026-09-23T12:00:00Z"),
      send: async (command) => {
        commands.push(command);
        return {};
      },
      sign: async (command, expiresInSeconds) => {
        signatures.push([command, expiresInSeconds]);
        return "https://signed.example.test/object?signature=fixture";
      },
    });
    const reference = { key: `private/processed/${objectId}`, stage: "private" } as const;

    const result = await storage.createReadUrl(reference, 60);

    expect(result).toEqual({
      expiresAt: new Date("2026-09-23T12:01:00Z"),
      url: "https://signed.example.test/object?signature=fixture",
    });
    expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
    expect(signatures[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(signatures[0]?.[1]).toBe(60);
    await expect(storage.createReadUrl(reference, 301)).rejects.toMatchObject({
      code: "INVALID_EXPIRY",
    });
  });

  it("rejects forged paths, mismatched stages and backward promotion", async () => {
    const storage = createS3ObjectStorageForTesting(config, { send: async () => ({}) });

    await expect(
      storage.deleteObject({ key: "../../production-secret", stage: "private" }),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      storage.deleteObject({ key: `public/approved/${objectId}`, stage: "quarantine" }),
    ).rejects.toMatchObject({ code: "INVALID_OBJECT" });
    await expect(
      storage.promoteObject({
        destination: "private",
        source: { key: `private/processed/${objectId}`, stage: "private" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROMOTION" });
  });
});
