import { z } from "zod";
import {
  dimensionNameSchema,
  dimensionJudgeSchema,
} from "./dimension-contract";

export const modelIdSchema = z.string().trim().min(1).max(200);
export const comparisonRowSchema = z.object({
  name: dimensionNameSchema,
  preferred: z.enum(["first", "second", "tie", "unassessable"]),
  reason: z.string().trim().min(1).max(5000),
});
export const comparisonConfigSchema = z.object({
  rubricVersion: z.literal("dimension-comparison-v1.0"),
  rubricStatus: z.literal("uncalibrated_draft"),
  prompt: z.string().min(1),
  promptHash: z.string().length(64),
  evaluationDate: z.string(),
  judge: dimensionJudgeSchema,
});
export const comparisonAttemptSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  status: z.enum(["running", "succeeded", "failed", "skipped"]),
  swapped: z.boolean(),
  rows: z.array(comparisonRowSchema).optional(),
  error: z.string().optional(),
  providerModel: z.string().optional(),
  evidenceHash: z.string().length(64),
  config: comparisonConfigSchema.optional(),
});
export const comparisonCaseSchema = z.object({
  id: z.uuid(),
  recordIds: z.tuple([z.uuid(), z.uuid()]),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  rows: z.array(comparisonRowSchema).optional(),
  reason: z.string().optional(),
  attempts: z.array(comparisonAttemptSchema),
});
export type ComparisonCase = z.infer<typeof comparisonCaseSchema>;
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;
