import { sleep } from "workflow";
export async function benchmarkWorkflow(runId: string, generation: number) {
  "use workflow";
  const plan = await getPlan(runId, generation);
  if (!plan) return;
  const ready = plan.ids.map(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  try {
    await Promise.all([
      ...Array.from({ length: plan.concurrency }, async (_, lane) => {
        for (let i = lane; i < plan.ids.length; i += plan.concurrency) {
          while (!(await searchStep(runId, plan.ids[i], generation)))
            await sleep("2s");
          ready[i].resolve();
        }
      }),
      ...Array.from({ length: 2 }, async (_, lane) => {
        for (let i = lane; i < plan.ids.length; i += 2) {
          await ready[i].promise;
          while (!(await evaluationStep(runId, plan.ids[i], generation)))
            await sleep("2s");
        }
      }),
    ]);
  } catch {
    await interruptStep(runId, generation);
  }
}
async function getPlan(runId: string, generation: number) {
  "use step";
  const { readState } = await import("../lib/store");
  const run = (await readState()).runs.find((r) => r.id === runId);
  return run?.status === "active" && (run.generation ?? 0) === generation
    ? { concurrency: run.concurrency, ids: run.records.map((r) => r.id) }
    : null;
}
async function searchStep(runId: string, id: string, generation: number) {
  "use step";
  const { processCloudSearch } = await import("../lib/cloud-jobs");
  return processCloudSearch(runId, id, generation);
}
async function evaluationStep(runId: string, id: string, generation: number) {
  "use step";
  const { processCloudEvaluation } = await import("../lib/cloud-jobs");
  return processCloudEvaluation(runId, id, generation);
}
async function interruptStep(runId: string, generation: number) {
  "use step";
  const { interruptCloudRun } = await import("../lib/cloud-jobs");
  await interruptCloudRun(runId, generation);
}
