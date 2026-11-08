import postgres from "postgres";
import { stateSchema, type State } from "./schema";
import { workspaceNamespace } from "./runtime";
export class StoredStateError extends Error {
  constructor(reason: string) {
    super(
      "Saved benchmark data could not be read. Existing data has been preserved. Check the server logs.",
      { cause: new Error(reason) },
    );
    this.name = "StoredStateError";
  }
}
function validateSnapshot(value: unknown): State {
  const result = stateSchema.safeParse(value);
  if (!result.success)
    throw new StoredStateError("Snapshot schema validation failed.");
  return result.data;
}
export type SnapshotQuery = (
  text: string,
  values?: string[],
) => Promise<{ payload?: unknown }[]>;
const emptyState = (): State => ({ version: 1, runs: [] });

export function decodeSnapshot(payload: unknown): State {
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new StoredStateError("Legacy snapshot is not valid JSON.");
    }
  }
  return validateSnapshot(payload);
}

// Only first-time schema creation takes the cross-workspace advisory lock.
// Call within a transaction so a failed bootstrap releases it automatically.
export async function initializeDatabaseSchema(query: SnapshotQuery) {
  await query("SELECT pg_advisory_xact_lock(72419061)");
  await query(
    "CREATE TABLE IF NOT EXISTS doc_benchmark_state (workspace text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
  );
}

// Kept separate from the connection driver so real SQL semantics can be tested in isolation.
// The schema must exist before entering this transaction.
export async function mutateDatabaseSnapshot<T>(
  query: SnapshotQuery,
  namespace: string,
  fn: (s: State) => T | Promise<T>,
): Promise<T> {
  // Text parameters prevent the driver from applying a second JSON serialization.
  await query(
    "INSERT INTO doc_benchmark_state (workspace, payload) VALUES ($1, $2::text::jsonb) ON CONFLICT (workspace) DO NOTHING",
    [namespace, JSON.stringify(emptyState())],
  );
  const rows = await query(
    "SELECT payload FROM doc_benchmark_state WHERE workspace = $1 FOR UPDATE",
    [namespace],
  );
  const payload = rows[0]?.payload;
  const legacyEncoded = typeof payload === "string";
  const state = decodeSnapshot(payload),
    before = JSON.stringify(state);
  const result = await fn(state),
    saved = JSON.stringify(validateSnapshot(state));
  if (saved !== before || legacyEncoded)
    await query(
      "UPDATE doc_benchmark_state SET payload = $2::text::jsonb, updated_at = now() WHERE workspace = $1",
      [namespace, saved],
    );
  return structuredClone(result);
}
let client: ReturnType<typeof postgres> | undefined;
let schemaReady: Promise<void> | undefined;
// This is only a transfer optimization. PostgreSQL remains the source of truth:
// every read checks the row's MVCC revision before reusing a local snapshot.
let snapshotCache:
  { namespace: string; revision: string; state: State } | undefined;
// Client-side deadlines also cover pool queues and a server/network that stops replying.
// These options are supported by the pinned postgres.js 4.x driver.
export const databaseConnectionOptions = {
  max: 2,
  prepare: false,
  fetch_types: false,
  connect_timeout: 8,
  queue_timeout: 5,
  query_timeout: 8,
  cancel_timeout: 2,
  idle_timeout: 5,
  max_lifetime: 60,
} as const;

function databaseClient() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is required in hosted mode. Local JSON storage is disabled on Vercel.",
    );
  return (client ??= postgres(url, databaseConnectionOptions));
}

async function transactionLimits(sql: postgres.TransactionSql) {
  // SET LOCAL is scoped to this transaction, including with transaction poolers.
  // Bound lock waits and release locks if an invocation disappears mid-transaction.
  await sql.unsafe("SET LOCAL lock_timeout = '2s'");
  await sql.unsafe("SET LOCAL statement_timeout = '5s'");
  await sql.unsafe("SET LOCAL idle_in_transaction_session_timeout = '10s'");
}

async function ensureSchema(sql: ReturnType<typeof postgres>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const [row] = await sql.unsafe(
        "SELECT to_regclass('doc_benchmark_state') IS NOT NULL AS present",
      );
      if (row.present) return;
      await sql.begin(async (tx) => {
        await transactionLimits(tx);
        await initializeDatabaseSchema(async (text, values = []) =>
          Array.from(await tx.unsafe(text, values)),
        );
      });
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

export async function readDatabaseSnapshot(): Promise<State> {
  const sql = databaseClient();
  await ensureSchema(sql);
  const namespace = workspaceNamespace();
  const cached =
    snapshotCache?.namespace === namespace ? snapshotCache : undefined;
  // MVCC reads see the last committed state even while a writer holds the row lock.
  // Do not INSERT, take an advisory lock, or run DDL during routine polling.
  const [row] = await sql.unsafe(
    "SELECT xmin::text AS revision, CASE WHEN xmin::text = $2 THEN NULL ELSE payload END AS payload FROM doc_benchmark_state WHERE workspace = $1",
    [namespace, cached?.revision ?? ""],
  );
  if (!row) {
    snapshotCache = undefined;
    return emptyState();
  }
  if (row.payload === null && cached && row.revision === cached.revision)
    return structuredClone(cached.state);
  if (typeof row.payload === "string") {
    decodeSnapshot(row.payload); // Reject invalid data before attempting a repair.
    return databaseTransaction((state) => state);
  }
  const state = decodeSnapshot(row.payload);
  snapshotCache = { namespace, revision: row.revision, state };
  return structuredClone(state);
}

export async function databaseTransaction<T>(
  fn: (s: State) => T | Promise<T>,
): Promise<T> {
  const client = databaseClient();
  await ensureSchema(client);
  return (await client.begin(async (sql) => {
    await transactionLimits(sql);
    return mutateDatabaseSnapshot(
      async (text, values = []) => Array.from(await sql.unsafe(text, values)),
      workspaceNamespace(),
      fn,
    );
  })) as T;
}
export async function closeDatabase() {
  const previous = client;
  client = undefined;
  schemaReady = undefined;
  snapshotCache = undefined;
  await previous?.end({ timeout: 2 });
}
