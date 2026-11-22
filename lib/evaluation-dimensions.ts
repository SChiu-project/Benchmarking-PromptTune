// Server-only dimension suite dispatch and campaign resolution.
// Pure schemas/scoring live in dimension-contract.ts (client-safe).
import { createHash } from "node:crypto";
import { z } from "zod";
import { isVercel } from "./runtime";
import {
  DIMENSION_RUBRIC,
  DIMENSION_DEFAULT_VERSION,
  DIMENSION_DEFINITIONS,
  dimensionSelectionSchema,
  dimensionCampaignSchema,
  dimensionThresholdsSchema,
  dimensionSuiteResultSchema,
  dimensionAttemptSchema,
  buildDimensionSystemPrompt,
  validateDimensionPromptBody,
  notApplicableRow,
  scoreDimension,
  errorRow,
  aggregateDimensionSuite,
  type DimensionName,
  type DimensionCampaign,
  type DimensionConfig,
  type DimensionRow,
  type DimensionSelectionInput,
  type DimensionSuiteResult,
} from "./dimension-contract";
import type { SearchResult } from "./schema";
export * from "./dimension-contract";
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export type JudgeConnection = {
  endpoint: string;
  model: string;
  timeoutMs: number;
  key: string;
};
export function resolveDimensionCampaign(
  selection: DimensionSelectionInput,
  judge: JudgeConnection | null,
): DimensionCampaign {
  const parsed = dimensionSelectionSchema.parse(selection);
  const dimensions = parsed.names.map((name) => {
    const override = parsed.overrides?.[name];
    const body = validateDimensionPromptBody(
      name,
      override?.promptBody ?? DIMENSION_DEFINITIONS[name].body,
    );
    const thresholds = dimensionThresholdsSchema.parse(
      override?.thresholds ?? {},
    );
    const defaults = dimensionThresholdsSchema.parse({});
    return {
      name,
      promptBody: body,
      promptHash: sha256(buildDimensionSystemPrompt(name, body)),
      defaultVersion: DIMENSION_DEFAULT_VERSION,
      edited:
        body !== DIMENSION_DEFINITIONS[name].body ||
        JSON.stringify(thresholds) !== JSON.stringify(defaults),
      thresholds,
    };
  });
  return dimensionCampaignSchema.parse({
    rubricVersion: DIMENSION_RUBRIC,
    naPolicy: parsed.naPolicy,
    dimensions,
    judge: judge
      ? {
          model: judge.model,
          endpoint: judge.endpoint,
          timeoutMs: dimensions.some((d) =>
            DIMENSION_DEFINITIONS[d.name].needsPassages,
          )
            ? Math.max(judge.timeoutMs, 180000)
            : judge.timeoutMs,
          temperature: 0,
          codeVersion:
            process.env.VERCEL_GIT_COMMIT_SHA || "dimensions-v1.0-local",
        }
      : null,
  });
}

const envelopeSchema = z
  .object({
    model: z.string().optional(),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
    choices: z
      .array(z.object({ message: z.object({ content: z.string() }) }))
      .min(1),
  })
  .passthrough();
export const PASSAGE_JUDGE_LIMIT = 20;
export function judgeTimeoutMs(frozenMs: number, currentMs: number) {
  const cap = isVercel() ? 180000 : 300000;
  return Math.min(cap, Math.max(frozenMs, currentMs));
}
export function passagesForJudge(sources: SearchResult["sources"]) {
  const all = sources ?? [];
  const sent = all.slice(0, PASSAGE_JUDGE_LIMIT);
  return {
    sent,
    omitted: Math.max(0, all.length - sent.length),
    passages: sent.map((s, i) => ({
      index: i + 1,
      title: s.title,
      url: s.url,
      content: s.content.slice(0, 4000),
    })),
  };
}
function judgeUserPayload(
  name: DimensionName,
  question: string,
  answer: string,
  sources: SearchResult["sources"],
  evaluationDate: string,
) {
  const { passages, omitted } = passagesForJudge(sources);
  const payload: Record<string, unknown> = {
    evaluation_date: evaluationDate,
    ...(omitted
      ? {
          passage_note: `Only the first ${PASSAGE_JUDGE_LIMIT} of ${sources?.length ?? 0} passages were sent. Do not treat omitted passages as evidence.`,
        }
      : {}),
  };
  const base: Record<string, unknown> = { evaluation_date: evaluationDate };
  if (name === "context_relevance")
    return { ...payload, question, passages };
  if (name === "temporal_accuracy")
    return { ...payload, answer, ...(passages.length ? { passages } : {}) };
  if (name === "completeness" || name === "no_answer_detection")
    return { ...payload, question, answer };
  return { ...payload, question, answer, passages };
}
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}
async function callDimensionJudge(
  config: DimensionConfig,
  connection: JudgeConnection,
  payload: Record<string, unknown>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(connection.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.key}`,
        },
        signal: AbortSignal.timeout(connection.timeoutMs),
        body: JSON.stringify({
          model: connection.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: buildDimensionSystemPrompt(
                config.name,
                config.promptBody,
              ),
            },
            { role: "user", content: JSON.stringify(payload) },
          ],
        }),
      });
      if (!response.ok)
        throw new Error(`Evaluator HTTP ${response.status}.`);
      const envelope = envelopeSchema.parse(await response.json());
      return {
        raw: JSON.parse(envelope.choices[0].message.content) as unknown,
        providerModel: envelope.model,
        usage: envelope.usage,
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Dimension judge call failed.");
}
export async function evaluateDimensionSuite(
  question: string,
  answer: string,
  sources: SearchResult["sources"],
  campaign: DimensionCampaign,
  connection: JudgeConnection | null,
): Promise<DimensionSuiteResult> {
  const frozen = dimensionCampaignSchema.parse(campaign);
  if (!frozen.judge)
    throw new Error(
      "Evaluator was not configured when this campaign was created. Configure it and regrade.",
    );
  if (!connection)
    throw new Error(
      "Evaluator not configured. Set EVALUATOR_ENDPOINT, EVALUATOR_MODEL, and EVALUATOR_API_KEY.",
    );
  if (connection.endpoint !== frozen.judge.endpoint)
    throw new Error(
      "Evaluator endpoint changed since campaign creation. Start a new evaluation campaign.",
    );
  const evaluatedAt = new Date().toISOString();
  const evaluationDate = evaluatedAt.slice(0, 10);
  const judge = frozen.judge;
  const results = await pool(
    frozen.dimensions,
    3,
    async (config): Promise<{ row: DimensionRow; attempt: z.infer<typeof dimensionAttemptSchema> }> => {
      const startedAt = new Date().toISOString();
      const attemptBase = {
        name: config.name,
        promptHash: config.promptHash,
        startedAt,
      };
      if (
        DIMENSION_DEFINITIONS[config.name].needsPassages &&
        !sources?.length
      )
        return {
          row: notApplicableRow(config.name, frozen.naPolicy),
          attempt: {
            ...attemptBase,
            status: "skipped",
            finishedAt: new Date().toISOString(),
          },
        };
      try {
        const judged = await callDimensionJudge(
          config,
          {
            ...connection,
            model: judge.model,
            timeoutMs: judgeTimeoutMs(judge.timeoutMs, connection.timeoutMs),
          },
          judgeUserPayload(
            config.name,
            question,
            answer,
            sources,
            evaluationDate,
          ),
        );
        const judgedSources = passagesForJudge(sources).sent;
        const row = scoreDimension(config.name, judged.raw, {
          answer,
          sources: judgedSources.length ? judgedSources : sources,
          thresholds: config.thresholds,
        });
        return {
          row,
          attempt: {
            ...attemptBase,
            status: row.status === "error" ? "failed" : "succeeded",
            finishedAt: new Date().toISOString(),
            ...(judged.providerModel
              ? { providerModel: judged.providerModel }
              : {}),
            ...(judged.usage ? { usage: judged.usage } : {}),
            ...(row.status === "error" ? { error: row.reason } : {}),
          },
        };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Dimension judge call failed.";
        return {
          row: errorRow(config.name, `Evaluation failed: ${message}`),
          attempt: {
            ...attemptBase,
            status: "failed",
            finishedAt: new Date().toISOString(),
            error: message,
          },
        };
      }
    },
  );
  const rows = results.map((r) => r.row);
  return dimensionSuiteResultSchema.parse({
    rubricVersion: DIMENSION_RUBRIC,
    rubricStatus: "uncalibrated_draft",
    naPolicy: frozen.naPolicy,
    evaluatedAt,
    rows,
    ...aggregateDimensionSuite(rows),
    attempts: results.map((r) => r.attempt),
  });
}
