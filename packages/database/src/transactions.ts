import { sql } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm/relations";
import type { Database } from "./pool.js";
import type * as schema from "./schema/index.js";
import { matchSequences } from "./schema/index.js";

export type DatabaseTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface TransactionOptions {
  readonly isolationLevel?: "read committed" | "repeatable read" | "serializable";
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} deve ser um inteiro positivo.`);
  }
  return value;
}

export async function withTransaction<T>(
  database: Database,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const lockTimeoutMs = positiveInteger(
    "lockTimeoutMs",
    options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  );
  const statementTimeoutMs = positiveInteger(
    "statementTimeoutMs",
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  );

  return database.transaction(
    async (transaction) => {
      await transaction.execute(sql`
        select
          set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true),
          set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)
      `);
      return operation(transaction);
    },
    { isolationLevel: options.isolationLevel ?? "read committed" },
  );
}

export async function nextMatchSequence(
  transaction: DatabaseTransaction,
  matchId: string,
): Promise<bigint> {
  const [row] = await transaction
    .insert(matchSequences)
    .values({ lastSequence: 1n, matchId })
    .onConflictDoUpdate({
      target: matchSequences.matchId,
      set: {
        lastSequence: sql`${matchSequences.lastSequence} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ sequence: matchSequences.lastSequence });

  if (!row) {
    throw new Error("O PostgreSQL não retornou a sequence incrementada.");
  }

  return row.sequence;
}
