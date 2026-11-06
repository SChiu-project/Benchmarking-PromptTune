import postgres from "postgres";
import { stateSchema, type State } from "./schema";
import { workspaceNamespace } from "./runtime";
export type SnapshotQuery = (
  text: string,
  values?: string[],
) => Promise<{ payload?: unknown }[]>;
// Kept separate from the connection driver so real SQL semantics can be tested in isolation.
export async function mutateDatabaseSnapshot<T>(
  query: SnapshotQuery,
  namespace: string,
  fn: (s: State) => T | Promise<T>,
): Promise<T> {
  await query("SELECT pg_advisory_xact_lock(72419061)");
  await query(
    "CREATE TABLE IF NOT EXISTS doc_benchmark_state (workspace text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
  );
  await query(
    "INSERT INTO doc_benchmark_state (workspace, payload) VALUES ($1, $2::jsonb) ON CONFLICT (workspace) DO NOTHING",
    [namespace, JSON.stringify({ version: 1, runs: [] })],
  );
  const rows = await query(
    "SELECT payload FROM doc_benchmark_state WHERE workspace = $1 FOR UPDATE",
    [namespace],
  );
  const state = stateSchema.parse(rows[0]?.payload),
    before = JSON.stringify(state);
  const result = await fn(state),
    saved = JSON.stringify(stateSchema.parse(state));
  if (saved !== before)
    await query(
      "UPDATE doc_benchmark_state SET payload = $2::jsonb, updated_at = now() WHERE workspace = $1",
      [namespace, saved],
    );
  return structuredClone(result);
}
let client: ReturnType<typeof postgres> | undefined;
export async function databaseTransaction<T>(
  fn: (s: State) => T | Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is required in hosted mode. Local JSON storage is disabled on Vercel.",
    );
  client ??= postgres(url, {
    max: 2,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 20,
  });
  return (await client.begin(async (sql) =>
    mutateDatabaseSnapshot(
      async (text, values = []) => Array.from(await sql.unsafe(text, values)),
      workspaceNamespace(),
      fn,
    ),
  )) as T;
}
export async function closeDatabase() {
  await client?.end();
  client = undefined;
}
