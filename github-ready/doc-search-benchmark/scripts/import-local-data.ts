import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stateSchema } from "../lib/schema";
import { databaseTransaction, closeDatabase } from "../lib/postgres-store";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL and BENCHMARK_NAMESPACE in your local environment before importing.",
    );
  if (!process.env.BENCHMARK_NAMESPACE)
    throw new Error(
      "Set BENCHMARK_NAMESPACE explicitly (for example production) to choose the destination.",
    );
  const source = stateSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          process.env.DATA_DIR || path.join(process.cwd(), "data"),
          "state.json",
        ),
        "utf8",
      ),
    ),
  );
  if (source.runs.some((r) => r.status === "active"))
    throw new Error("Stop/finish active runs before importing.");
  const count = await databaseTransaction((s) => {
    if (s.runs.length)
      throw new Error(
        "Destination is not empty. Existing hosted records will not be overwritten.",
      );
    s.runs = source.runs.map(
      ({ workflowRunId: _, dispatchError: __, ...run }) => {
        void _;
        void __;
        return run;
      },
    );
    return s.runs.length;
  });
  console.log(
    `Imported ${count} completed/interrupted runs. No searches or evaluations were scheduled.`,
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Import failed");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
