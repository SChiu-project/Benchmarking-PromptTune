// Server-only pairwise blind preference dispatch. Never sends variant identity
// to the judge; the stored swapped flag decodes A/B back to baseline/candidate.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { RecordData, Run } from "./schema";
import {
  PREFERENCE_RUBRIC,
  PREFERENCE_DEFAULT_VERSION,
  PREFERENCE_PROMPT_BODY,
  buildPreferenceSystemPrompt,
  preferenceJudgeOutputSchema,
  preferenceComparisonSchema,
  preferenceSummary,
  type PreferenceCase,
  type PreferenceComparison,
} from "./preference-contract";
import type { JudgeConnection } from "./evaluation-dimensions";

const caseKey = (r: RecordData) =>
  JSON.stringify([r.question.folder, r.question.query]);
export function pairRunCases(baseline: Run, candidate: Run) {
  if (baseline.status === "active" || candidate.status === "active")
    throw new Error("Wait for both runs to finish.");
  if (baseline.id === candidate.id)
    throw new Error("Choose two different runs.");
  if (baseline.config.projectId !== candidate.config.projectId)
    throw new Error("Cannot compare different projects.");
  const left = new Map(baseline.records.map((r) => [caseKey(r), r]));
  const right = new Map(candidate.records.map((r) => [caseKey(r), r]));
  if (
    left.size !== baseline.records.length ||
    right.size !== candidate.records.length ||
    left.size !== right.size ||
    [...left.keys()].some((k) => !right.has(k))
  )
    throw new Error(
      "Preference comparison requires the same complete set of unique cases.",
    );
  return [...left].map(([key, a]) => ({ key, a, b: right.get(key)! }));
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
async function callPreferenceJudge(
  connection: JudgeConnection,
  promptBody: string,
  payload: { question: string; answer_a: string; answer_b: string },
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
              content: buildPreferenceSystemPrompt(promptBody),
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
    : new Error("Preference judge call failed.");
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
export async function runPreferenceComparison(
  baseline: Run,
  candidate: Run,
  connection: JudgeConnection | null,
  promptBody: string = PREFERENCE_PROMPT_BODY,
): Promise<PreferenceComparison> {
  const pairs = pairRunCases(baseline, candidate);
  if (!connection)
    throw new Error(
      "Evaluator not configured. Set EVALUATOR_ENDPOINT, EVALUATOR_MODEL, and EVALUATOR_API_KEY.",
    );
  const cases = await pool(pairs, 3, async ({ key, a, b }): Promise<PreferenceCase> => {
    const base = {
      caseKey: key,
      query: a.question.query,
      folder: a.question.folder,
      swapped: randomInt(2) === 1,
    };
    const answerA = a.result?.answer,
      answerB = b.result?.answer;
    if (!answerA || !answerB)
      return {
        ...base,
        status: "skipped",
        preferred: "unknown",
        reasoning: "Missing a confirmed answer for one variant.",
        confidence: null,
      };
    if (answerA === answerB)
      return {
        ...base,
        status: "succeeded",
        preferred: "tie",
        reasoning: "Identical answers; no preference applicable.",
        confidence: null,
        autoTie: true,
      };
    const first = base.swapped ? answerB : answerA;
    const second = base.swapped ? answerA : answerB;
    try {
      const judged = await callPreferenceJudge(connection, promptBody, {
        question: a.question.query,
        answer_a: first,
        answer_b: second,
      });
      const parsed = preferenceJudgeOutputSchema.safeParse(judged.raw);
      if (!parsed.success)
        return {
          ...base,
          status: "failed",
          preferred: "error",
          reasoning: "Judge output failed schema validation.",
          confidence: null,
          error: "Invalid judge output shape.",
        };
      const o = parsed.data;
      const preferred =
        o.preferred === "tie" || o.preferred === "unknown"
          ? o.preferred
          : (o.preferred === "A") !== base.swapped
            ? "baseline"
            : "candidate";
      return {
        ...base,
        status: "succeeded",
        preferred,
        reasoning: o.reasoning,
        confidence: o.confidence,
        ...(judged.providerModel ? { providerModel: judged.providerModel } : {}),
        ...(judged.usage ? { usage: judged.usage } : {}),
      };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Preference judge call failed.";
      return {
        ...base,
        status: "failed",
        preferred: "error",
        reasoning: `Evaluation failed: ${message}`,
        confidence: null,
        error: message,
      };
    }
  });
  return preferenceComparisonSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    rubricVersion: PREFERENCE_RUBRIC,
    rubricStatus: "uncalibrated_draft",
    promptBody,
    promptHash: createHash("sha256")
      .update(buildPreferenceSystemPrompt(promptBody))
      .digest("hex"),
    defaultVersion: PREFERENCE_DEFAULT_VERSION,
    judge: {
      model: connection.model,
      endpoint: connection.endpoint,
      timeoutMs: connection.timeoutMs,
      temperature: 0,
      codeVersion:
        process.env.VERCEL_GIT_COMMIT_SHA || "preference-v1.0-local",
    },
    cases,
    summary: preferenceSummary(cases),
  });
}
