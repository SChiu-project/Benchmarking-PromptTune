import { z } from "zod";
import { dimensionCampaignSchema } from "./dimension-contract";

export const REQUIREMENT_RUBRIC = "requirements-v2.0";
export const claimCategorySchema = z.enum([
  "contradiction",
  "unsupported_claim",
]);
const text = z.string().trim().min(1).max(5000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const referenceSchema = z
  .object({
    field: z.enum(["expected_answer", "evaluation_comments"]),
    quote: text,
  })
  .strict();
export const checkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("semantic") }).strict(),
  z
    .object({
      type: z.literal("contains"),
      value: text,
      caseSensitive: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("max_length"),
      characters: z.number().int().min(1).max(1000000),
    })
    .strict(),
  z.object({ type: z.literal("json") }).strict(),
  z
    .object({
      type: z.literal("numeric_json"),
      path: z.array(z.string().min(1).max(100)).min(1).max(10),
      expected: z.number().finite(),
      absoluteTolerance: z.number().finite().nonnegative(),
      relativeTolerance: z.number().finite().min(0).max(1),
      unitPath: z.array(z.string().min(1).max(100)).min(1).max(10),
      unit: text,
    })
    .strict(),
]);
export const requirementSchema = z
  .object({
    id,
    text,
    reference: referenceSchema,
    weight: z.number().finite().positive().max(1000),
    critical: z.boolean(),
    applicable: z.boolean(),
    applicabilityReason: text,
    partial: z
      .object({ credit: z.number().gt(0).lt(1), rule: text })
      .strict()
      .nullable(),
    check: checkSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.check.type !== "semantic" && r.partial)
      ctx.addIssue({
        code: "custom",
        message: "Deterministic checks do not allow partial credit.",
      });
  });
export const criteriaSchema = z
  .object({
    version: text,
    caseId: id,
    projectId: z.string().trim().min(1).max(500),
    language: z.string().trim().min(1).max(50),
    referenceVersion: text,
    approvedBy: z.string().trim().min(1).max(200),
    approvedAt: z.iso.datetime(),
    policy: z
      .object({
        version: text,
        passThreshold: z.number().min(0).max(100),
        checkAdditionalClaims: z.boolean(),
        blockingCategories: z.array(claimCategorySchema).max(2),
      })
      .strict(),
    requirements: z.array(requirementSchema).min(1).max(100),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (new Set(c.requirements.map((r) => r.id)).size !== c.requirements.length)
      ctx.addIssue({
        code: "custom",
        message: "Requirement IDs must be unique.",
      });
    if (
      new Set(c.policy.blockingCategories).size !==
      c.policy.blockingCategories.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Blocking categories must be unique.",
      });
  });
export type Criteria = z.infer<typeof criteriaSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export const judgmentSchema = z
  .object({
    requirementId: id,
    status: z.enum(["met", "partial", "unmet", "unknown"]),
    answerQuote: text.nullable(),
    referenceQuote: text,
    difference: text,
    correction: text.nullable(),
  })
  .strict();
export type Judgment = z.infer<typeof judgmentSchema>;
export const claimSchema = z
  .object({
    category: claimCategorySchema,
    status: z.enum(["established", "unknown"]),
    answerQuote: text,
    reference: referenceSchema.nullable(),
    explanation: text,
  })
  .strict();
export const groundingSchema = z
  .object({
    status: z.enum(["supported", "unsupported", "unknown"]),
    evidence: z
      .array(
        z
          .object({
            sourceIndex: z.number().int().nonnegative(),
            quote: text,
            answerQuote: text,
          })
          .strict(),
      )
      .max(100),
    explanation: text,
  })
  .strict();
export const requirementJudgeSchema = z
  .object({
    judgments: z.array(judgmentSchema).max(100),
    claims: z.array(claimSchema).max(100),
    grounding: groundingSchema,
  })
  .strict();
export const requirementResultSchema = z.object({
  rubricVersion: z.literal(REQUIREMENT_RUBRIC),
  criteriaVersion: text,
  policyVersion: text,
  caseId: id,
  decision: z.enum(["pass", "fail", "review"]),
  lowerBound: z.number().min(0).max(100),
  upperBound: z.number().min(0).max(100),
  earnedWeight: z.number().nonnegative(),
  applicableWeight: z.number().nonnegative(),
  criticalFailures: z.array(id),
  rows: z.array(
    judgmentSchema.extend({
      credit: z.number().min(0).max(1).nullable(),
      weight: z.number().positive(),
      critical: z.boolean(),
      applicable: z.boolean(),
    }),
  ),
  claims: z.array(claimSchema),
  grounding: groundingSchema,
  evidenceValidation: z.literal("quotes_verified"),
  semanticSupport: z.literal("judge_assessed_not_human_verified"),
});
export type RequirementResult = z.infer<typeof requirementResultSchema>;
export const evaluatorSnapshotSchema = z.object({
  rubricVersion: z.literal(REQUIREMENT_RUBRIC),
  prompt: z.string().min(1),
  promptHash: z.string().length(64),
  model: z.string().min(1),
  endpoint: z.url(),
  timeoutMs: z.number().int().min(100).max(300000),
  temperature: z.literal(0),
  codeVersion: z.string().min(1),
});
export type EvaluatorSnapshot = z.infer<typeof evaluatorSnapshotSchema>;
export const campaignSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  rubricVersion: z.literal(REQUIREMENT_RUBRIC),
  datasetHash: z.string().length(64),
  criteriaHash: z.string().length(64),
  referenceHash: z.string().length(64),
  evaluator: evaluatorSnapshotSchema.nullable(),
  dimensions: dimensionCampaignSchema.optional(),
});
export type Campaign = z.infer<typeof campaignSchema>;
export const sidecarSchema = z
  .object({
    version: z.literal(1),
    cases: z
      .array(
        z
          .object({
            query: z.string().trim().min(1),
            folder: z.string().trim().min(1),
            criteria: criteriaSchema,
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export function validateCriteriaReferences(q: {
  expected_answer: string;
  evaluation_comments: string;
  criteria?: Criteria;
}) {
  for (const r of q.criteria?.requirements ?? []) {
    if (!q[r.reference.field].includes(r.reference.quote))
      throw new Error(
        `${r.id}: approved reference quote is absent from ${r.reference.field}.`,
      );
  }
}

export function attachCriteria<
  T extends {
    query: string;
    folder: string;
    expected_answer: string;
    evaluation_comments: string;
  },
>(
  questions: T[],
  raw: unknown,
  projectId: string,
): (T & { criteria: Criteria })[] {
  const sidecar = sidecarSchema.parse(raw);
  const key = (q: { query: string; folder: string }) =>
    JSON.stringify([q.query, q.folder]);
  const byKey = new Map(sidecar.cases.map((c) => [key(c), c.criteria]));
  if (byKey.size !== sidecar.cases.length)
    throw new Error("Duplicate query/folder in criteria.");
  if (
    new Set(sidecar.cases.map((c) => c.criteria.caseId)).size !==
    sidecar.cases.length
  )
    throw new Error("Case IDs must be unique.");
  if (
    byKey.size !== questions.length ||
    sidecar.cases.some((c) => !questions.some((q) => key(q) === key(c)))
  )
    throw new Error(
      "Criteria must match every uploaded query/folder exactly, without extra cases.",
    );
  return questions.map((q) => {
    const criteria = byKey.get(key(q))!;
    if (criteria.projectId !== projectId)
      throw new Error(
        `${criteria.caseId}: criteria project does not match the selected project.`,
      );
    const attached = { ...q, criteria };
    validateCriteriaReferences(attached);
    return attached;
  });
}

export function needsJudge(q: { criteria?: Criteria }) {
  return (
    !q.criteria ||
    q.criteria.policy.checkAdditionalClaims ||
    q.criteria.requirements.some(
      (r) => r.applicable && r.check.type === "semantic",
    )
  );
}
