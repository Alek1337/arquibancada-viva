import { storageConfigSchema } from "@arquibancada-viva/config";
import { afterAll, describe, expect, it } from "vitest";
import { createS3ObjectStorage, type ObjectReference } from "./s3-object-storage.js";

const endpoint = process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9000";
const endpointUrl = new URL(endpoint);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(endpointUrl.hostname)) {
  throw new Error("A integração de storage aceita somente endpoint S3 em loopback.");
}

const config = storageConfigSchema.parse({
  S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? "local-development",
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? "arquibancada-viva-local",
  S3_ENDPOINT: endpoint,
  S3_FORCE_PATH_STYLE: "true",
  S3_REGION: process.env.TEST_S3_REGION ?? "us-east-1",
  S3_SECRET_ACCESS_KEY:
    process.env.TEST_S3_SECRET_ACCESS_KEY ?? "change-me-development-only-32-characters",
});

describe("private S3-compatible storage", () => {
  const storage = createS3ObjectStorage(config);
  const cleanup: ObjectReference[] = [];

  afterAll(async () => {
    await Promise.allSettled(cleanup.map((reference) => storage.deleteObject(reference)));
    await storage.close();
  });

  it("keeps uploads private and promotes only the selected object", async () => {
    await storage.checkConnection();
    const selected = await storage.uploadQuarantinedObject({
      body: "selected-object",
      contentType: "text/plain",
      sourceFilename: "../../approved/selected.txt",
    });
    const untouched = await storage.uploadQuarantinedObject({
      body: "untouched-object",
      contentType: "text/plain",
      sourceFilename: "untouched.txt",
    });
    cleanup.push(selected, untouched);

    const anonymous = await fetch(`${config.S3_ENDPOINT}/${config.S3_BUCKET}/${selected.key}`, {
      redirect: "manual",
    });
    expect(anonymous.status).not.toBe(200);

    const privateObject = await storage.promoteObject({
      destination: "private",
      source: selected,
    });
    const approvedObject = await storage.promoteObject({
      destination: "approved",
      source: privateObject,
    });
    cleanup.push(privateObject, approvedObject);

    const selectedUrl = await storage.createReadUrl(approvedObject, 30);
    const untouchedUrl = await storage.createReadUrl(untouched, 30);
    expect(await (await fetch(selectedUrl.url)).text()).toBe("selected-object");
    expect(await (await fetch(untouchedUrl.url)).text()).toBe("untouched-object");
    await expect(storage.createReadUrl(selected, 30)).rejects.toBeTruthy();
    await expect(storage.createReadUrl(privateObject, 30)).rejects.toBeTruthy();
  });
});
