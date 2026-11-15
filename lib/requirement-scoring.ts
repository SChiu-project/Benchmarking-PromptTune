import type { Question, Evaluation, SearchResult } from "./schema";
import { dimensionNames } from "./schema";
import {
  REQUIREMENT_RUBRIC,
  criteriaSchema,
  requirementJudgeSchema,
  validateCriteriaReferences,
  type Requirement,
  type Judgment,
  type RequirementResult,
} from "./evaluation-contract";

function jsonValue(value: unknown, path: string[]): unknown {
  for (const segment of path) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment))
      return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
export function deterministicJudgment(
  r: Requirement,
  answer: string,
): Judgment {
  const check = r.check;
  if (check.type === "semantic")
    throw new Error("Semantic check requires a judge.");
  let met = false,
    evidence: string | null = null,
    detail = "";
  if (check.type === "contains") {
    const literal = Array.from(check.value)
      .map((c) => ("\\^$.*+?()[]{}|".includes(c) ? `\\${c}` : c))
      .join("");
    const match = new RegExp(literal, check.caseSensitive ? "u" : "iu").exec(
      answer,
    );
    met = match !== null;
    evidence = match?.[0] ?? null;
    detail = met
      ? "Required literal is present."
      : "Required literal is absent.";
  } else if (check.type === "max_length") {
    const length = Array.from(answer).length;
    met = length <= check.characters;
    detail = `${length} Unicode code points; maximum ${check.characters}.`;
  } else {
    let parsed: unknown;
    let valid = false;
    try {
      parsed = JSON.parse(answer);
      valid = true;
    } catch {
      /* Invalid JSON definitively fails this check. */
    }
    if (check.type === "json") {
      met = valid;
      detail = met ? "Valid JSON." : "Answer is not valid JSON.";
    } else {
      const value = jsonValue(parsed, check.path),
        unit = jsonValue(parsed, check.unitPath);
      const tolerance = Math.max(
        check.absoluteTolerance,
        Math.abs(check.expected) * check.relativeTolerance,
      );
      const delta =
        typeof value === "number" ? Math.abs(value - check.expected) : Infinity;
      const rounding =
        tolerance === 0
          ? 0
          : Number.EPSILON *
            Math.max(
              1,
              Math.abs(check.expected),
              typeof value === "number" ? Math.abs(value) : 1,
            ) *
            4;
      met =
        valid &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        unit === check.unit &&
        delta <= tolerance + rounding;
      detail = `Expected ${check.expected} ${check.unit}; inclusive tolerance ${tolerance}. Observed ${typeof value === "number" ? value : "missing/non-numeric"} ${typeof unit === "string" ? unit : "missing unit"}.`;
    }
  }
  return {
    requirementId: r.id,
    status: met ? "met" : "unmet",
    answerQuote: evidence,
    referenceQuote: r.reference.quote,
    difference: detail,
    correction: met ? null : r.text,
  };
}
const round = (n: number) => Math.round(n * 10) / 10;

export function calculateRequirementEvaluation(
  q: Question,
  answer: string,
  sources: SearchResult["sources"],
  raw: unknown,
): Evaluation {
  const criteria = criteriaSchema.parse(q.criteria);
  validateCriteriaReferences(q);
  const judged = requirementJudgeSchema.parse(raw);
  const semantic = criteria.requirements.filter(
    (r) => r.applicable && r.check.type === "semantic",
  );
  const ids = judged.judgments.map((j) => j.requirementId);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== semantic.length ||
    ids.some((id) => !semantic.some((r) => r.id === id))
  )
    throw new Error(
      "Judge must return each applicable semantic requirement exactly once, with no other IDs.",
    );
  const rows: RequirementResult["rows"] = criteria.requirements.map((r) => {
    const j: Judgment = !r.applicable
      ? {
          requirementId: r.id,
          status: "unknown",
          answerQuote: null,
          referenceQuote: r.reference.quote,
          difference: `N/A: ${r.applicabilityReason}`,
          correction: null,
        }
      : r.check.type === "semantic"
        ? judged.judgments.find((j) => j.requirementId === r.id)!
        : deterministicJudgment(r, answer);
    if (j.referenceQuote !== r.reference.quote)
      throw new Error(
        `${r.id}: reference evidence must match the approved quote.`,
      );
    if (j.answerQuote !== null && !answer.includes(j.answerQuote))
      throw new Error(`${r.id}: fabricated answer quote.`);
    if (
      r.applicable &&
      r.check.type === "semantic" &&
      ["met", "partial"].includes(j.status) &&
      j.answerQuote === null
    )
      throw new Error(
        `${r.id}: fulfilled semantic judgments require an exact answer quote.`,
      );
    if (j.status === "partial" && !r.partial)
      throw new Error(`${r.id}: partial credit is not authorized.`);
    const credit =
      !r.applicable || j.status === "unknown"
        ? null
        : j.status === "met"
          ? 1
          : j.status === "partial"
            ? r.partial!.credit
            : 0;
    return {
      ...j,
      correction: r.applicable && credit !== 1 ? r.text : null,
      credit,
      weight: r.weight,
      critical: r.critical,
      applicable: r.applicable,
    };
  });
  if (!criteria.policy.checkAdditionalClaims && judged.claims.length)
    throw new Error("Additional-claim checking is disabled by policy.");
  for (const claim of judged.claims) {
    if (!answer.includes(claim.answerQuote))
      throw new Error("Fabricated claim quote.");
    if (
      claim.reference &&
      !q[claim.reference.field].includes(claim.reference.quote)
    )
      throw new Error("Fabricated claim reference.");
    if (
      claim.category === "contradiction" &&
      claim.status === "established" &&
      !claim.reference
    )
      throw new Error(
        "An established contradiction needs approved reference evidence.",
      );
  }
  for (const evidence of judged.grounding.evidence) {
    if (
      !sources?.[evidence.sourceIndex]?.content.includes(evidence.quote) ||
      !answer.includes(evidence.answerQuote)
    )
      throw new Error("Fabricated grounding evidence or invalid source index.");
  }
  if (
    judged.grounding.status === "supported" &&
    !judged.grounding.evidence.length
  )
    throw new Error("Supported grounding needs source evidence.");
  if (!sources?.length && judged.grounding.status !== "unknown")
    throw new Error("Missing passages make retrieval grounding unknown.");
  const applicable = rows.filter((r) => r.applicable);
  const denominator = applicable.reduce((n, r) => n + r.weight, 0);
  const earned = applicable.reduce((n, r) => n + r.weight * (r.credit ?? 0), 0);
  const unknownWeight = applicable
    .filter((r) => r.credit === null)
    .reduce((n, r) => n + r.weight, 0);
  const lowerExact = denominator ? (100 * earned) / denominator : 0;
  const upperExact = denominator
    ? (100 * (earned + unknownWeight)) / denominator
    : 100;
  const criticalFailures = applicable
    .filter((r) => r.critical && r.credit !== null && r.credit < 1)
    .map((r) => r.requirementId);
  const blocking = judged.claims.some(
    (c) =>
      c.status === "established" &&
      criteria.policy.blockingCategories.includes(c.category),
  );
  const uncertain =
    !denominator ||
    unknownWeight > 0 ||
    judged.claims.some(
      (c) =>
        c.status === "unknown" &&
        criteria.policy.blockingCategories.includes(c.category),
    );
  const decision =
    criticalFailures.length ||
    blocking ||
    (denominator > 0 && upperExact < criteria.policy.passThreshold)
      ? "fail"
      : uncertain
        ? "review"
        : lowerExact >= criteria.policy.passThreshold
          ? "pass"
          : "fail";
  const score = denominator && !unknownWeight ? round(lowerExact) : null;
  const lowerBound = round(lowerExact),
    upperBound = round(upperExact);
  const requirements: RequirementResult = {
    rubricVersion: REQUIREMENT_RUBRIC,
    criteriaVersion: criteria.version,
    policyVersion: criteria.policy.version,
    caseId: criteria.caseId,
    decision,
    lowerBound,
    upperBound,
    earnedWeight: earned,
    applicableWeight: denominator,
    criticalFailures,
    rows,
    claims: judged.claims,
    grounding: judged.grounding,
    evidenceValidation: "quotes_verified",
    semanticSupport: "judge_assessed_not_human_verified",
  };
  const assessment = `${decision.toUpperCase()}: ${denominator ? `${earned} of ${denominator} weighted points; fulfillment ${score === null ? `${lowerBound}–${upperBound}% (incomplete)` : `${score}%`}` : "no applicable requirements"}. Critical failures: ${criticalFailures.join(", ") || "none"}. Policy ${criteria.policy.version}: threshold ${criteria.policy.passThreshold}%.`;
  return {
    score,
    applicableWeights: Object.fromEntries(dimensionNames.map((k) => [k, 0])),
    dimensions: Object.fromEntries(
      dimensionNames.map((k) => [
        k,
        {
          score: null,
          explanation:
            "Diagnostic dimension not independently scored; see requirement judgments.",
        },
      ]),
    ) as Evaluation["dimensions"],
    requirements,
    assessment,
    fulfilled: applicable
      .filter((r) => r.credit === 1)
      .map((r) => r.requirementId),
    missing: applicable
      .filter((r) => r.credit !== null && r.credit < 1)
      .map((r) => r.requirementId),
    contradictions: judged.claims
      .filter((c) => c.category === "contradiction")
      .map((c) => `${c.status}: ${c.explanation}`),
    unsupported_claims: judged.claims
      .filter((c) => c.category === "unsupported_claim")
      .map((c) => `${c.status}: ${c.explanation}`),
    discrepancies: applicable
      .filter((r) => r.credit !== 1)
      .map((r) => ({
        requirement: r.requirementId,
        response_evidence:
          r.answerQuote ?? "No supporting answer quote supplied.",
        difference: r.difference,
      })),
    improvements: applicable
      .filter((r) => r.credit !== 1)
      .map(
        (r) =>
          `${r.requirementId}: ${criteria.requirements.find((c) => c.id === r.requirementId)!.text}`,
      ),
    limitations: [
      "Quote provenance is verified in code; semantic support requires human calibration.",
      ...(!criteria.policy.checkAdditionalClaims
        ? ["Additional claims were not checked under this policy."]
        : []),
      ...(!sources?.length
        ? ["Retrieval grounding is unassessable: no passages available."]
        : []),
      ...(uncertain
        ? ["Unknown evidence or applicability prevents a definitive pass."]
        : []),
    ],
  };
}
