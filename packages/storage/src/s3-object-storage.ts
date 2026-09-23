import type { StorageConfig } from "@arquibancada-viva/config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { v7 as uuidV7 } from "uuid";

export type ObjectStage = "approved" | "private" | "quarantine";

export interface ObjectReference {
  readonly key: string;
  readonly stage: ObjectStage;
}

export interface UploadQuarantinedObjectInput {
  readonly body: Readable | Uint8Array | string;
  readonly contentLength?: number;
  readonly contentType: string;
  readonly sourceFilename?: string;
}

export interface PromoteObjectInput {
  readonly destination: Exclude<ObjectStage, "quarantine">;
  readonly source: ObjectReference;
}

export interface SignedObjectUrl {
  readonly expiresAt: Date;
  readonly url: string;
}

export interface ObjectStorage {
  checkConnection(): Promise<void>;
  close(): Promise<void>;
  createReadUrl(reference: ObjectReference, expiresInSeconds?: number): Promise<SignedObjectUrl>;
  deleteObject(reference: ObjectReference): Promise<void>;
  promoteObject(input: PromoteObjectInput): Promise<ObjectReference>;
  uploadQuarantinedObject(input: UploadQuarantinedObjectInput): Promise<ObjectReference>;
}

type StorageCommand =
  | CopyObjectCommand
  | DeleteObjectCommand
  | HeadBucketCommand
  | HeadObjectCommand
  | PutObjectCommand;

export interface S3ObjectStorageOptions {
  readonly clock?: () => Date;
  readonly destroy?: () => void;
  readonly idFactory?: () => string;
  readonly send?: (command: StorageCommand) => Promise<unknown>;
  readonly sign?: (command: GetObjectCommand, expiresInSeconds: number) => Promise<string>;
}

export class StorageValidationError extends Error {
  readonly code: "INVALID_CONTENT" | "INVALID_EXPIRY" | "INVALID_OBJECT" | "INVALID_PROMOTION";

  constructor(code: StorageValidationError["code"], message: string) {
    super(message);
    this.name = "StorageValidationError";
    this.code = code;
  }
}

const DEFAULT_READ_URL_SECONDS = 120;
const MAX_READ_URL_SECONDS = 300;
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(
  `^(quarantine/originals|private/processed|public/approved)/(${UUID_PATTERN})$`,
  "u",
);
const ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`, "u");
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;

const prefixes: Readonly<Record<ObjectStage, string>> = {
  approved: "public/approved",
  private: "private/processed",
  quarantine: "quarantine/originals",
};

function stageFromPrefix(prefix: string): ObjectStage | undefined {
  return (Object.entries(prefixes) as [ObjectStage, string][]).find(
    ([, value]) => value === prefix,
  )?.[0];
}

function validateReference(reference: ObjectReference): {
  id: string;
  key: string;
  stage: ObjectStage;
} {
  const match = KEY_PATTERN.exec(reference.key);
  const stage = match?.[1] ? stageFromPrefix(match[1]) : undefined;
  const id = match?.[2];
  if (!stage || !id || stage !== reference.stage) {
    throw new StorageValidationError("INVALID_OBJECT", "Referência de objeto inválida.");
  }
  return { id, key: reference.key, stage };
}

function validateContent(input: UploadQuarantinedObjectInput): number | undefined {
  if (!CONTENT_TYPE_PATTERN.test(input.contentType) || input.contentType.length > 200) {
    throw new StorageValidationError("INVALID_CONTENT", "Content-Type inválido.");
  }
  const inferredLength =
    input.contentLength ??
    (typeof input.body === "string"
      ? Buffer.byteLength(input.body)
      : input.body instanceof Uint8Array
        ? input.body.byteLength
        : undefined);
  if (
    inferredLength !== undefined &&
    (!Number.isSafeInteger(inferredLength) ||
      inferredLength < 1 ||
      inferredLength > MAX_OBJECT_BYTES)
  ) {
    throw new StorageValidationError("INVALID_CONTENT", "Tamanho de objeto inválido.");
  }
  return inferredLength;
}

function copySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function createS3ObjectStorageRuntime(
  config: StorageConfig,
  options: S3ObjectStorageOptions = {},
): ObjectStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    region: config.S3_REGION,
  });
  const send =
    options.send ??
    ((command: StorageCommand) => client.send(command as never) as Promise<unknown>);
  const sign =
    options.sign ??
    ((command: GetObjectCommand, expiresInSeconds: number) =>
      getSignedUrl(client, command, { expiresIn: expiresInSeconds }));
  const destroy = options.destroy ?? (() => client.destroy());
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? uuidV7;
  let closed = false;

  function nextReference(stage: ObjectStage, id = idFactory()): ObjectReference {
    if (!ID_PATTERN.test(id)) {
      throw new StorageValidationError("INVALID_OBJECT", "Gerador produziu ID inválido.");
    }
    return { key: `${prefixes[stage]}/${id}`, stage };
  }

  return {
    async checkConnection() {
      await send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    },
    async close() {
      if (!closed) {
        closed = true;
        destroy();
      }
    },
    async createReadUrl(reference, expiresInSeconds = DEFAULT_READ_URL_SECONDS) {
      const object = validateReference(reference);
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > MAX_READ_URL_SECONDS
      ) {
        throw new StorageValidationError(
          "INVALID_EXPIRY",
          `A URL assinada deve expirar entre 1 e ${MAX_READ_URL_SECONDS} segundos.`,
        );
      }
      await send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: object.key }));
      const url = await sign(
        new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: object.key }),
        expiresInSeconds,
      );
      return {
        expiresAt: new Date(clock().getTime() + expiresInSeconds * 1_000),
        url,
      };
    },
    async deleteObject(reference) {
      const object = validateReference(reference);
      await send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: object.key }));
    },
    async promoteObject(input) {
      const source = validateReference(input.source);
      if (
        source.stage === "approved" ||
        (source.stage === "private" && input.destination !== "approved")
      ) {
        throw new StorageValidationError("INVALID_PROMOTION", "Transição de promoção inválida.");
      }
      const destination = nextReference(input.destination, source.id);
      await send(
        new CopyObjectCommand({
          Bucket: config.S3_BUCKET,
          CopySource: copySource(config.S3_BUCKET, source.key),
          Key: destination.key,
        }),
      );
      await send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: source.key }));
      return destination;
    },
    async uploadQuarantinedObject(input) {
      const contentLength = validateContent(input);
      const reference = nextReference("quarantine");
      await send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: config.S3_BUCKET,
          ContentLength: contentLength,
          ContentType: input.contentType,
          Key: reference.key,
        }),
      );
      return reference;
    },
  };
}

export function createS3ObjectStorage(config: StorageConfig): ObjectStorage {
  return createS3ObjectStorageRuntime(config);
}

export function createS3ObjectStorageForTesting(
  config: StorageConfig,
  options: S3ObjectStorageOptions,
): ObjectStorage {
  return createS3ObjectStorageRuntime(config, options);
}
