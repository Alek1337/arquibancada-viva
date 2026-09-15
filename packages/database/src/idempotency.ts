import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createPublicId } from "./identifiers.js";
import type { Database } from "./pool.js";
import { idempotencyRecords } from "./schema/index.js";
import { type DatabaseTransaction, withTransaction } from "./transactions.js";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/u;

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT";

  constructor() {
    super("A chave de idempotência já foi usada com outro conteúdo.");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyStateError extends Error {
  readonly code = "IDEMPOTENCY_STATE_INVALID";

  constructor() {
    super("O registro de idempotência não possui resultado concluído.");
    this.name = "IdempotencyStateError";
  }
}

export interface IdempotentCommandInput<Response extends JsonObject> {
  readonly expiresAt?: Date;
  readonly key: string;
  readonly now?: Date;
  readonly operation: (transaction: DatabaseTransaction) => Promise<Response>;
  readonly request: JsonValue;
  readonly scope: string;
}

export interface IdempotentCommandResult<Response extends JsonObject> {
  readonly replayed: boolean;
  readonly value: Response;
}

export async function deleteExpiredIdempotencyRecords(
  database: Database,
  options: { readonly before: Date; readonly limit?: number },
): Promise<number> {
  const limit = options.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) {
    throw new RangeError("limit deve ser um inteiro entre 1 e 5000.");
  }
  if (!Number.isFinite(options.before.getTime())) {
    throw new TypeError("before deve ser um instante válido.");
  }

  return withTransaction(database, async (transaction) => {
    const deleted = await transaction.execute<{ recordId: string } & Record<string, unknown>>(sql`
      with expired as (
        select record_id
        from app.idempotency_records
        where expires_at <= ${options.before}
        order by expires_at, record_id
        for update skip locked
        limit ${limit}
      )
      delete from app.idempotency_records as record
      using expired
      where record.record_id = expired.record_id
      returning record.record_id as "recordId"
    `);
    return deleted.rows.length;
  });
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("O conteúdo idempotente deve usar apenas números JSON finitos.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateInput(scope: string, key: string, now: Date, expiresAt: Date): void {
  if (!SCOPE_PATTERN.test(scope)) {
    throw new TypeError("O escopo de idempotência é inválido.");
  }
  if (key.length < 8 || key.length > 200) {
    throw new TypeError("A chave de idempotência deve conter entre 8 e 200 caracteres.");
  }
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new TypeError("Os instantes de idempotência devem ser válidos.");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new RangeError("A expiração deve ocorrer após a criação do registro.");
  }
}

export async function executeIdempotentCommand<Response extends JsonObject>(
  database: Database,
  input: IdempotentCommandInput<Response>,
): Promise<IdempotentCommandResult<Response>> {
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_RETENTION_MS);
  validateInput(input.scope, input.key, now, expiresAt);
  const keyHash = sha256(input.key);
  const requestHash = sha256(canonicalize(input.request));

  return withTransaction(database, async (transaction) => {
    const [inserted] = await transaction
      .insert(idempotencyRecords)
      .values({
        createdAt: now,
        expiresAt,
        keyHash,
        recordId: createPublicId(now.getTime()),
        requestHash,
        scope: input.scope,
      })
      .onConflictDoNothing({
        target: [idempotencyRecords.scope, idempotencyRecords.keyHash],
      })
      .returning({ recordId: idempotencyRecords.recordId });

    if (!inserted) {
      const [existing] = await transaction
        .select({
          requestHash: idempotencyRecords.requestHash,
          response: idempotencyRecords.response,
        })
        .from(idempotencyRecords)
        .where(
          and(eq(idempotencyRecords.scope, input.scope), eq(idempotencyRecords.keyHash, keyHash)),
        )
        .limit(1);

      if (!existing || existing.response === null) {
        throw new IdempotencyStateError();
      }
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      return { replayed: true, value: existing.response as Response };
    }

    const value = JSON.parse(canonicalize(await input.operation(transaction))) as Response;
    const updated = await transaction
      .update(idempotencyRecords)
      .set({ completedAt: now, response: value })
      .where(eq(idempotencyRecords.recordId, inserted.recordId))
      .returning({ recordId: idempotencyRecords.recordId });
    if (updated.length !== 1) {
      throw new IdempotencyStateError();
    }
    return { replayed: false, value };
  });
}
