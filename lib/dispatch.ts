import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import { benchmarkWorkflow } from "../workflows/benchmark";
import { readState, transaction, ConflictError } from "./store";
import { workflowMode, isVercel } from "./runtime";
export async function dispatchRun(id: string) {
  if (!workflowMode()) return;
  const run = (await readState()).runs.find((r) => r.id === id);
  if (!run || run.status !== "active" || run.workflowRunId) return;
  const generation = run.generation ?? 0;
  try {
    if (isVercel() && !process.env.VERCEL_DEPLOYMENT_ID)
      throw new Error(
        "Enable Vercel System Environment Variables and redeploy before starting workflows.",
      );
    let workflowRunId: string;
    try {
      workflowRunId = (
        await start(benchmarkWorkflow, [id, generation], {
          experimental_hook: {
            token: `benchmark:${id}:${generation}`,
            experimental_minRetention: "7 days",
          },
        })
      ).runId;
    } catch (e) {
      if (HookConflictError.is(e) && e.conflictingRunId)
        workflowRunId = e.conflictingRunId;
      else throw e;
    }
    await transaction((s) => {
      const r = s.runs.find((r) => r.id === id);
      if (r && (r.generation ?? 0) === generation) {
        r.workflowRunId = workflowRunId;
        delete r.dispatchError;
      }
    });
  } catch {
    await transaction((s) => {
      const r = s.runs.find((r) => r.id === id);
      if (
        r?.status === "active" &&
        (r.generation ?? 0) === generation &&
        !r.workflowRunId
      )
        r.dispatchError =
          isVercel() && !process.env.VERCEL_DEPLOYMENT_ID
            ? "Enable Vercel System Environment Variables and redeploy, then retry queue dispatch."
            : "Queue dispatch could not be confirmed. Use Retry queue dispatch; saved questions will not be duplicated.";
    });
  }
}

export async function recoverStoppedWorkflow(id: string) {
  const run = (await readState()).runs.find((r) => r.id === id);
  if (!run?.workflowRunId || run.status !== "active")
    throw new ConflictError("No active hosted workflow to recover.");
  const { getRun } = await import("workflow/api");
  const status = await getRun(run.workflowRunId).status;
  if (!["completed", "failed", "cancelled"].includes(status))
    throw new ConflictError(
      "The workflow is still active. Inspect it in Vercel before recovering.",
    );
  const now = Date.now();
  if (
    run.comparisons?.some(
      (p) =>
        p.status === "running" &&
        p.attempts.at(-1) &&
        now - Date.parse(p.attempts.at(-1)!.startedAt) < 330000,
    ) ||
    run.records.some(
      (r) =>
        (r.execution === "running" &&
          r.startedAt &&
          now - Date.parse(r.startedAt) < run.config.timeoutMs + 30000) ||
        (r.evaluationStatus === "running" &&
          r.attempts.at(-1) &&
          now - Date.parse(r.attempts.at(-1)!.startedAt) < 330000),
    )
  )
    throw new ConflictError(
      "Wait for in-flight request leases to expire before recovering this stopped workflow.",
    );
  const { interruptCloudRun } = await import("./cloud-jobs");
  await interruptCloudRun(id, run.generation ?? 0);
}
