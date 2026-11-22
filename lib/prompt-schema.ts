import { z } from "zod";

export const promptSections = [
  ["agent_background_dto", "Agent background"],
  ["custom_instruction_dto", "Custom instructions"],
  ["tool_call_context_dto", "Tool-call context"],
] as const;
export const promptLanguages = [
  ["en", "English"],
  ["zh", "Traditional Chinese"],
  ["sc", "Simplified Chinese"],
] as const;
export const localizedPromptSchema = z
  .object({
    en: z.string().max(50000),
    zh: z.string().max(50000),
    sc: z.string().max(50000),
  })
  .strict();
export const promptBaselineSchema = z
  .object({
    agent_background_dto: localizedPromptSchema.optional(),
    custom_instruction_dto: localizedPromptSchema.optional(),
    tool_call_context_dto: localizedPromptSchema.optional(),
  })
  .strict();
export const promptOverridesSchema = promptBaselineSchema.refine(
  (value) => Object.keys(value).length > 0,
  "Select at least one changed prompt section.",
);
export type PromptOverrides = z.infer<typeof promptOverridesSchema>;
export type PromptBaseline = z.infer<typeof promptBaselineSchema>;
export const cmsFolderListSchema = z.object({
  projectId: z.string().min(1).max(500),
  folders: z.array(z.string().min(1).max(500)).max(10001),
});
export const promptSnapshotSchema = z.object({
  id: z.uuid(),
  workspace: z.string(),
  accessSessionHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  environment: z.url(),
  searchEndpoint: z.url(),
  projectId: z.string().min(1).max(500),
  documentFolder: z.string().min(1).max(500),
  promptFolder: z.string().min(1).max(500),
  isBase: z.boolean(),
  version: z.number().int().nonnegative(),
  versionId: z.string().nullable(),
  isActive: z.boolean(),
  retrievedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  baseline: promptBaselineSchema,
  fingerprint: z.string(),
  unavailable: z.record(z.string(), z.string()),
});
export type PromptSnapshot = z.infer<typeof promptSnapshotSchema>;
export const promptSelectionSchema = z
  .object({
    snapshotId: z.uuid(),
    allowStale: z.boolean().default(false),
  })
  .strict();
export type PromptSelection = z.input<typeof promptSelectionSchema>;
export const promptProvenanceSchema = z.object({
  snapshot: promptSnapshotSchema,
  checkedAt: z.iso.datetime(),
  staleAcknowledged: z.boolean(),
});
export function changedPrompts(
  baseline: PromptBaseline,
  draft: PromptBaseline,
): PromptOverrides | undefined {
  const changed: PromptBaseline = {};
  for (const [key] of promptSections) {
    const original = baseline[key],
      current = draft[key];
    if (
      original &&
      current &&
      promptLanguages.some(([lang]) => original[lang] !== current[lang])
    )
      changed[key] = current;
  }
  return Object.keys(changed).length ? changed : undefined;
}
