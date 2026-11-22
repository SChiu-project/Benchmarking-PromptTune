// CMS benchmark export fixture contract and saved-answer run builder.
// The export contains answers and CMS labels but NO passage content, so
// passage-dependent dimensions are N/A when these answers are regraded.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { configSchema, type Run } from "./schema";
import { createCampaign, hash, type JudgeConfig } from "./evaluation-snapshot";
import {
  DIMENSION_NAMES,
  dimensionSelectionSchema,
  type DimensionSelectionInput,
} from "./dimension-contract";

const dimensionLabelSchema = z
  .object({
    passed: z.enum(["PASS", "FAIL"]),
    reason: z.string().nullable(),
    cmsError: z.boolean(),
    confidence: z.number().nullable().optional(),
    averageScore: z.number().nullable().optional(),
  })
  .strict();
const answerSchema = z
  .object({
    answer: z.string().min(1),
    answerSource: z.string().nullable(),
    usedSections: z.string().nullable(),
    totalTimeMs: z.number().int().nonnegative().nullable(),
    labels: z
      .object({
        overallPassed: z.enum(["PASS", "FAIL"]),
        passRate: z.string(),
        dimensions: z.record(z.string(), dimensionLabelSchema),
      })
      .strict(),
  })
  .strict();
export const cmsFixtureSchema = z
  .object({
    source: z.string().min(1),
    note: z.string().optional(),
    models: z.array(z.string().min(1)).min(1),
    dimensions: z.array(z.string().min(1)).min(1),
    cases: z
      .array(
        z
          .object({
            caseId: z.string().min(1),
            folder: z.string().min(1),
            query: z.string().min(1),
            traceId: z.string().nullable(),
            runtimeTags: z.array(z.string()),
            preferredModel: z.string().nullable(),
            preferredReasoning: z.string().nullable(),
            answers: z.record(z.string(), answerSchema),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((f, ctx) => {
    const keys = f.cases.map((c) => JSON.stringify([c.folder, c.query]));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message: "Fixture query/folder keys must be unique.",
        path: ["cases"],
      });
    for (const c of f.cases)
      for (const m of f.models)
        if (!c.answers[m])
          ctx.addIssue({
            code: "custom",
            message: `${c.caseId}: missing answers for model ${m}.`,
            path: ["cases"],
          });
  });
export type CmsFixture = z.infer<typeof cmsFixtureSchema>;
export const DEFAULT_IMPORTED_PROJECT_ID = "cms-export-widget";
export function buildImportedRun(
  fixture: CmsFixture,
  model: string,
  opts: {
    projectId?: string;
    judge: JudgeConfig | null;
    pending: boolean;
    limit?: number;
    selection?: DimensionSelectionInput;
  },
): Run {
  const parsed = cmsFixtureSchema.parse(fixture);
  if (!parsed.models.includes(model))
    throw new Error(`Fixture has no answers for model ${model}.`);
  const cases = opts.limit ? parsed.cases.slice(0, opts.limit) : parsed.cases;
  const now = new Date().toISOString();
  const questions = cases.map((c) => ({
    query: c.query,
    folder: c.folder,
    expected_answer: "",
    evaluation_comments: "",
  }));
  const selection = dimensionSelectionSchema.parse(
    opts.selection ?? { names: [...DIMENSION_NAMES], naPolicy: "strict" },
  );
  const id = randomUUID();
  const records = cases.map((c) => {
    const a = c.answers[model];
    return {
      id: randomUUID(),
      runId: id,
      question: {
        query: c.query,
        folder: c.folder,
        expected_answer: "",
        evaluation_comments: "",
      },
      execution: "succeeded" as const,
      evaluationStatus: opts.pending ? ("pending" as const) : ("skipped" as const),
      ...(opts.pending
        ? {}
        : {
            evaluationReason:
              "Imported saved answer. Regrade to evaluate with current settings.",
          }),
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      result: {
        answer: a.answer,
        sources: null,
        traceId: c.traceId,
        latencyMs: a.totalTimeMs ?? 0,
        rawRequest: { importedFrom: parsed.source, model },
        rawResponse: {
          answerSource: a.answerSource,
          usedSections: a.usedSections,
          runtimeTags: c.runtimeTags,
          cmsLabels: a.labels,
        },
      },
      attempts: [],
    };
  });
  return {
    id,
    idempotencyKey: randomUUID(),
    requestHash: hash({
      importedFrom: parsed.source,
      model,
      caseIds: cases.map((c) => c.caseId),
      selection,
    }),
    kind: "batch",
    createdAt: now,
    ...(opts.pending ? {} : { finishedAt: now }),
    status: opts.pending ? "active" : "completed",
    concurrency: 2,
    config: configSchema.parse({
      endpoint: "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
      projectId: opts.projectId ?? DEFAULT_IMPORTED_PROJECT_ID,
      timeoutMs: 60000,
    }),
    campaign: createCampaign(questions, opts.judge, selection),
    records,
  };
}
