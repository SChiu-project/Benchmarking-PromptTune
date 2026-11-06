import { z } from "zod";
export const DEFAULT_FOLDER = "Codex_Benchmark_tool";
export const questionSchema = z.object({
  query: z.string().trim().min(1).max(20000),
  folder: z.string().trim().min(1).max(500),
  expected_answer: z.string().trim().max(50000).default(""),
  evaluation_comments: z.string().trim().max(50000).default(""),
});
export type Question = z.infer<typeof questionSchema>;
export const executionSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "interrupted",
]);
export const evaluationStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);
export const dimensionNames = [
  "correctness",
  "coverage",
  "relevance",
  "compliance",
] as const;
export const weights = {
  correctness: 40,
  coverage: 30,
  relevance: 20,
  compliance: 10,
} as const;
const dimensionSchema = z
  .object({
    score: z.number().min(0).max(100).nullable(),
    explanation: z.string().min(1).max(5000),
  })
  .strict();
export const evaluatorOutputSchema = z
  .object({
    dimensions: z
      .object({
        correctness: dimensionSchema,
        coverage: dimensionSchema,
        relevance: dimensionSchema,
        compliance: dimensionSchema,
      })
      .strict(),
    assessment: z.string().min(1).max(5000),
    fulfilled: z.array(z.string()),
    missing: z.array(z.string()),
    contradictions: z.array(z.string()),
    unsupported_claims: z.array(z.string()),
    discrepancies: z.array(
      z
        .object({
          requirement: z.string(),
          response_evidence: z.string(),
          difference: z.string(),
        })
        .strict(),
    ),
    improvements: z.array(z.string()),
    limitations: z.array(z.string()),
  })
  .strict();
export const evaluationSchema = evaluatorOutputSchema.extend({
  score: z.number().min(0).max(100).nullable(),
  applicableWeights: z.record(z.string(), z.number().min(0).max(100)),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export const sourceSchema = z.object({
  id: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export const resultSchema = z.object({
  answer: z.string(),
  sources: z.array(sourceSchema).nullable(),
  traceId: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  rawRequest: z.unknown(),
  rawResponse: z.unknown(),
});
export type SearchResult = z.infer<typeof resultSchema>;
export const attemptSchema = z.object({
  id: z.uuid(),
  model: z.string(),
  endpoint: z.string(),
  rubricVersion: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  status: z.enum(["running", "succeeded", "failed", "skipped"]),
  error: z.string().optional(),
  result: evaluationSchema.optional(),
});
export const recordSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  question: questionSchema,
  execution: executionSchema,
  evaluationStatus: evaluationStatusSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  result: resultSchema.optional(),
  error: z.string().optional(),
  failureDetails: z
    .object({ rawRequest: z.unknown(), rawResponse: z.unknown() })
    .optional(),
  evaluationReason: z.string().optional(),
  evaluation: evaluationSchema.optional(),
  attempts: z.array(attemptSchema),
});
export type RecordData = z.infer<typeof recordSchema>;
export const configSchema = z.object({
  endpoint: z.url(),
  projectId: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(300000),
});
export type SearchConfig = z.infer<typeof configSchema>;
export const runSchema = z.object({
  id: z.uuid(),
  idempotencyKey: z.uuid(),
  requestHash: z.string(),
  kind: z.enum(["batch", "test"]),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  status: z.enum(["active", "completed", "interrupted"]),
  concurrency: z.number().int().min(1).max(5),
  config: configSchema,
  generation: z.number().int().nonnegative().optional(),
  workflowRunId: z.string().optional(),
  dispatchError: z.string().optional(),
  records: z.array(recordSchema),
});
export type Run = z.infer<typeof runSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  runs: z.array(runSchema),
});
export type State = z.infer<typeof stateSchema>;
export const createRunSchema = z
  .object({
    idempotencyKey: z.uuid(),
    concurrency: z.number().int().min(1).max(5),
    questions: z.array(questionSchema).min(1).max(1000),
  })
  .strict();
export type CreateRun = z.infer<typeof createRunSchema>;
export function summarize(run: Run) {
  const rs = run.records,
    successful = rs.filter((r) => r.execution === "succeeded" && r.result),
    scored = rs.filter(
      (r) => r.evaluationStatus === "succeeded" && r.evaluation?.score != null,
    );
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return {
    id: run.id,
    kind: run.kind,
    createdAt: run.createdAt,
    status: run.status,
    concurrency: run.concurrency,
    total: rs.length,
    completed: rs.filter((r) =>
      ["succeeded", "failed", "interrupted"].includes(r.execution),
    ).length,
    searchSucceeded: successful.length,
    searchFailed: rs.filter((r) => r.execution === "failed").length,
    interrupted: rs.filter((r) => r.execution === "interrupted").length,
    evaluated: rs.filter((r) => r.evaluationStatus === "succeeded").length,
    evaluationFailed: rs.filter((r) => r.evaluationStatus === "failed").length,
    skipped: rs.filter((r) => r.evaluationStatus === "skipped").length,
    averageLatency: mean(successful.map((r) => r.result!.latencyMs)),
    averageScore: mean(scored.map((r) => r.evaluation!.score!)),
    scoredCount: scored.length,
    dispatchError: run.dispatchError,
    workflowRunId: run.workflowRunId,
  };
}
export type RunSummary = ReturnType<typeof summarize>;
