// Seed a synthetic queued comparison to exercise compiled Workflow steps without CMS login.
// The catalog/auth boundary is covered independently by model-catalog.test.ts.
import { randomUUID } from "node:crypto";
import { createRun, transaction } from "../lib/store";
import { createCampaign } from "../lib/evaluation-snapshot";
import { createComparisonConfig } from "../lib/comparison";
import { evaluatorConfig } from "../lib/evaluator";
import { closeDatabase } from "../lib/postgres-store";
async function main() {
  for (const url of [
    process.env.DOC_SEARCH_ENDPOINT,
    process.env.EVALUATOR_ENDPOINT,
  ]) {
    if (!url || new URL(url).hostname !== "127.0.0.1")
      throw new Error("Smoke fixture requires loopback mock services.");
  }
  const question = {
    query: "Synthetic paired smoke question",
    folder: "ROOT",
    expected_answer: "",
    evaluation_comments: "",
  };
  const id = await createRun({
    idempotencyKey: randomUUID(),
    concurrency: 2,
    projectId: "mock-project",
    questions: [question],
  });
  await transaction((s) => {
    const run = s.runs.find((r) => r.id === id)!;
    run.config.generationModels = ["mock-model-a", "mock-model-b"];
    run.campaign = createCampaign([question], evaluatorConfig(), {
      names: ["completeness"],
    });
    run.comparisonConfig = createComparisonConfig(run.campaign.dimensions!);
    const template = run.records[0];
    run.records = run.config.generationModels.map((generationModel) => ({
      ...template,
      id: randomUUID(),
      generationModel,
      attempts: [],
    }));
    run.comparisons = [
      {
        id: randomUUID(),
        recordIds: [run.records[0].id, run.records[1].id],
        status: "pending",
        attempts: [],
      },
    ];
  });
  console.log(id);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
