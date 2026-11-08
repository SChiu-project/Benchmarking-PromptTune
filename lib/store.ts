import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { randomUUID, createHash } from "node:crypto";
import {
  stateSchema,
  createRunSchema,
  configSchema,
  type State,
  type Run,
  type CreateRun,
} from "./schema";
import { databaseMode, workflowMode, isVercel } from "./runtime";
import { databaseTransaction, readDatabaseSnapshot } from "./postgres-store";
import { searchConfig } from "./doc-search";
export const dataDir = () =>
  process.env.DATA_DIR || path.join(process.cwd(), "data");
export class ConflictError extends Error {}
export async function transaction<T>(
  fn: (state: State) => T | Promise<T>,
): Promise<T> {
  if (databaseMode()) return databaseTransaction(fn);
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(path.join(dir, "state.json"), {
    realpath: false,
    lockfilePath: path.join(dir, ".state.lock"),
    stale: 15000,
    update: 3000,
    retries: { retries: 100, minTimeout: 20, maxTimeout: 100 },
  });
  try {
    let state: State;
    let saved: string | null = null;
    try {
      saved = await readFile(path.join(dir, "state.json"), "utf8");
      state = stateSchema.parse(JSON.parse(saved));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      state = { version: 1, runs: [] };
    }
    const result = await fn(state);
    const serialized = JSON.stringify(stateSchema.parse(state));
    if (serialized === saved) return structuredClone(result);
    const temp = path.join(dir, `.${randomUUID()}.tmp`);
    await writeFile(temp, serialized, { mode: 0o600 });
    const handle = await open(temp, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path.join(dir, "state.json"));
    return structuredClone(result);
  } finally {
    await release();
  }
}
export async function readState() {
  if (databaseMode()) return readDatabaseSnapshot();
  return transaction((s) => s);
}
export function finishRuns(s: State) {
  for (const r of s.runs) {
    if (
      r.status === "active" &&
      r.records.every(
        (x) =>
          ["succeeded", "failed", "interrupted"].includes(x.execution) &&
          ["succeeded", "failed", "skipped"].includes(x.evaluationStatus),
      )
    ) {
      r.status = r.records.some((x) => x.execution === "interrupted")
        ? "interrupted"
        : "completed";
      r.finishedAt = new Date().toISOString();
    }
  }
}
export function recover(s: State) {
  for (const run of s.runs) {
    if (run.status !== "active") continue;
    for (const r of run.records) {
      if (["queued", "running"].includes(r.execution)) {
        r.execution = "interrupted";
        r.error = "Server restarted before this request completed. Not resent.";
        r.finishedAt = new Date().toISOString();
      }
      if (["pending", "running"].includes(r.evaluationStatus)) {
        r.evaluationStatus = "skipped";
        r.evaluationReason =
          "Server restarted; retry evaluation against the saved answer.";
        for (const a of r.attempts)
          if (a.status === "running") {
            a.status = "failed";
            a.error = "Worker interrupted by restart.";
            a.finishedAt = new Date().toISOString();
          }
      }
    }
    run.status = "interrupted";
    run.finishedAt = new Date().toISOString();
  }
}
export async function createRun(input: CreateRun, kind: Run["kind"] = "batch") {
  const body = createRunSchema.parse(input),
    config = configSchema.parse({
      ...searchConfig(),
      ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
    });
  if (isVercel() && config.timeoutMs > 180000)
    throw new ConflictError(
      "Hosted Doc Search timeout must not exceed 180000 ms.",
    );
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        questions: body.questions,
        concurrency: body.concurrency,
        kind,
        ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
      }),
    )
    .digest("hex");
  return transaction((s) => {
    const prior = s.runs.find((r) => r.idempotencyKey === body.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictError(
          "This submission key was already used for a different batch.",
        );
      return prior.id;
    }
    if (s.runs.some((r) => r.status === "active"))
      throw new ConflictError(
        "A run or connectivity test is active. Wait for both queues to finish.",
      );
    // Defense in depth: clients cannot bypass upload normalization or duplicate checks.
    const keys = body.questions.map((q) => JSON.stringify([q.query, q.folder]));
    if (new Set(keys).size !== keys.length)
      throw new ConflictError(
        "Duplicate query/folder pairs. Review the CSV again.",
      );
    const id = randomUUID(),
      now = new Date().toISOString();
    s.runs.push({
      id,
      idempotencyKey: body.idempotencyKey,
      requestHash,
      kind,
      createdAt: now,
      status: "active",
      concurrency: kind === "test" ? 1 : body.concurrency,
      config,
      records: body.questions.map((question) => ({
        id: randomUUID(),
        runId: id,
        question,
        execution: "queued",
        evaluationStatus: kind === "test" ? "skipped" : "pending",
        evaluationReason:
          kind === "test" ? "Connectivity test only." : undefined,
        createdAt: now,
        attempts: [],
      })),
    });
    return id;
  });
}
export async function retryEvaluation(id: string) {
  return transaction((s) => {
    const run = s.runs.find((r) => r.records.some((x) => x.id === id)),
      record = run?.records.find((r) => r.id === id);
    if (!run || !record) throw new Error("Record not found.");
    if (record.execution !== "succeeded")
      throw new ConflictError(
        "Only saved successful answers can be evaluated.",
      );
    if (workflowMode() && run.status === "active")
      throw new ConflictError(
        "Wait until this run finishes before retrying its evaluation.",
      );
    if (["pending", "running"].includes(record.evaluationStatus))
      throw new ConflictError("Evaluation is already queued.");
    if (s.runs.some((r) => r.status === "active" && r.id !== run.id))
      throw new ConflictError("Another run is active. Wait for it to finish.");
    run.generation = (run.generation ?? 0) + 1;
    delete run.workflowRunId;
    delete run.dispatchError;
    record.evaluationStatus = "pending";
    delete record.evaluation;
    delete record.evaluationReason;
    run.status = "active";
    delete run.finishedAt;
    return record.id;
  });
}
