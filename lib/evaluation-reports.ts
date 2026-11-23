import { z } from "zod";
import type { RecordData, Run } from "./schema";
import { needsJudge } from "./evaluation-contract";
import { hash } from "./evaluation-snapshot";
import { cmsFixtureSchema } from "./cms-fixture";
import {
  DIMENSION_NAMES,
  DIMENSION_RUBRIC,
  dimensionNameSchema,
} from "./dimension-contract";

export function wilson(successes: number, total: number) {
  if (!total) return null;
  const z = 1.96,
    p = successes / total,
    denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    denom;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    confidence: 0.95,
  };
}
function latest(r: RecordData) {
  const a = r.attempts.at(-1);
  if (
    r.evaluationStatus !== "succeeded" ||
    !a?.result?.requirements ||
    !a.campaign ||
    !a.questionSnapshot?.criteria ||
    (needsJudge(a.questionSnapshot) && !a.campaign.evaluator)
  )
    return null;
  return {
    attempt: a,
    question: a.questionSnapshot,
    result: a.result.requirements,
    campaign: a.campaign,
  };
}
function scoringSignature(r: RecordData) {
  const current = latest(r);
  if (!current) return null;
  const {
    approvedAt: _,
    approvedBy: __,
    ...criteria
  } = current.question.criteria!;
  void _;
  void __;
  return hash({
    query: current.question.query,
    folder: current.question.folder,
    reference: current.question.expected_answer,
    comments: current.question.evaluation_comments,
    criteria,
    evaluator: current.campaign.evaluator,
  });
}
export function compareRuns(baseline: Run, candidate: Run) {
  if (baseline.status === "active" || candidate.status === "active")
    throw new Error("Wait for both runs to finish.");
  if (baseline.config.projectId !== candidate.config.projectId)
    throw new Error("Cannot compare different projects.");
  const key = (r: RecordData) =>
    r.question.criteria?.caseId ??
    JSON.stringify([r.question.folder, r.question.query]);
  const left = new Map(baseline.records.map((r) => [key(r), r]));
  const right = new Map(candidate.records.map((r) => [key(r), r]));
  if (
    left.size !== baseline.records.length ||
    right.size !== candidate.records.length ||
    left.size !== right.size ||
    [...left.keys()].some((id) => !right.has(id))
  )
    throw new Error(
      "Comparisons require the same complete set of unique cases.",
    );
  const pairs = [...left].map(([caseId, a]) => {
    const b = right.get(caseId)!;
    const x = latest(a),
      y = latest(b);
    const comparable = x && y && scoringSignature(a) === scoringSignature(b);
    return {
      caseId,
      folder: a.question.folder,
      language: a.question.criteria?.language ?? "unknown",
      baseline: x?.result.decision ?? "unavailable",
      candidate: y?.result.decision ?? "unavailable",
      comparable: Boolean(comparable),
      reason: comparable
        ? null
        : !x || !y
          ? "Missing completed v2 evaluation/provenance"
          : "References, requirements, policy or judge configuration differ",
      baselineCritical: x?.result.criticalFailures ?? [],
      candidateCritical: y?.result.criticalFailures ?? [],
    };
  });
  const decisive = pairs.filter(
    (p) => p.comparable && p.baseline !== "review" && p.candidate !== "review",
  );
  const improvements = decisive.filter(
    (p) => p.baseline === "fail" && p.candidate === "pass",
  ).length;
  const regressions = decisive.filter(
    (p) => p.baseline === "pass" && p.candidate === "fail",
  ).length;
  const slices = [
    ...new Set(pairs.map((p) => JSON.stringify([p.folder, p.language]))),
  ].map((slice) => {
    const [folder, language] = JSON.parse(slice);
    const ps = pairs.filter(
      (p) => p.folder === folder && p.language === language,
    );
    return {
      folder,
      language,
      total: ps.length,
      comparable: ps.filter((p) => p.comparable).length,
      review: ps.filter(
        (p) => p.baseline === "review" || p.candidate === "review",
      ).length,
    };
  });
  const dimSig = (r: RecordData) => {
    const d = r.attempts.at(-1)?.campaign?.dimensions;
    return d
      ? hash({
          dims: d.dimensions.map((x) => [x.name, x.promptHash, x.thresholds]),
          naPolicy: d.naPolicy,
        })
      : null;
  };
  const hasSuites =
    baseline.records.some((r) => r.dimensionSuite) ||
    candidate.records.some((r) => r.dimensionSuite);
  let dimensions: unknown = null;
  if (hasSuites) {
    const dimPairs = [...left].map(([caseId, a]) => {
      const b = right.get(caseId)!;
      const sa = a.dimensionSuite,
        sb = b.dimensionSuite;
      const sigA = dimSig(a),
        sigB = dimSig(b);
      const comparable = Boolean(sa && sb && sigA && sigB && sigA === sigB);
      const transitions = DIMENSION_NAMES.filter(
        (n) =>
          sa?.rows.some((x) => x.name === n) &&
          sb?.rows.some((x) => x.name === n),
      ).map((n) => ({
        dimension: n,
        baseline: sa!.rows.find((x) => x.name === n)!.status,
        candidate: sb!.rows.find((x) => x.name === n)!.status,
      }));
      return {
        caseId,
        comparable,
        reason: comparable
          ? null
          : !sa || !sb
            ? "Missing dimension evaluation"
            : "Dimension prompts, thresholds or N/A policy differ",
        overallBaseline: sa?.overallPassed ?? null,
        overallCandidate: sb?.overallPassed ?? null,
        transitions,
      };
    });
    const comparablePairs = dimPairs.filter((p) => p.comparable);
    const perDimension = DIMENSION_NAMES.map((n) => {
      const ts = comparablePairs.flatMap((p) =>
        p.transitions.filter((t) => t.dimension === n),
      );
      const decided = ts.filter(
        (t) =>
          ["pass", "fail"].includes(t.baseline) &&
          ["pass", "fail"].includes(t.candidate),
      );
      return {
        dimension: n,
        pairs: ts.length,
        decided: decided.length,
        improvements: decided.filter(
          (t) => t.baseline === "fail" && t.candidate === "pass",
        ).length,
        regressions: decided.filter(
          (t) => t.baseline === "pass" && t.candidate === "fail",
        ).length,
        unchanged: decided.filter((t) => t.baseline === t.candidate).length,
        excluded: ts.length - decided.length,
      };
    }).filter((d) => d.pairs > 0);
    const overallDecided = comparablePairs.filter(
      (p) => p.overallBaseline !== null && p.overallCandidate !== null,
    );
    dimensions = {
      comparablePairs: comparablePairs.length,
      excludedPairs: dimPairs.length - comparablePairs.length,
      perDimension,
      overall: {
        improvements: overallDecided.filter(
          (p) => p.overallBaseline === false && p.overallCandidate === true,
        ).length,
        regressions: overallDecided.filter(
          (p) => p.overallBaseline === true && p.overallCandidate === false,
        ).length,
        unchanged: overallDecided.filter(
          (p) => p.overallBaseline === p.overallCandidate,
        ).length,
      },
      pairs: dimPairs,
    };
  }
  return {
    baselineId: baseline.id,
    candidateId: candidate.id,
    total: pairs.length,
    decisivePairs: decisive.length,
    excluded: pairs.length - decisive.length,
    improvements,
    regressions,
    unchanged: decisive.length - improvements - regressions,
    netPassRateChange: decisive.length
      ? (improvements - regressions) / decisive.length
      : null,
    improvementShareAmongDiscordant: wilson(
      improvements,
      improvements + regressions,
    ),
    conclusion:
      "Descriptive paired results only. No automatic winner; inspect exclusions, critical regressions, sample size and case dependence.",
    slices,
    pairs,
    dimensions,
  };
}
const labels = z
  .object({
    caseId: z.string().min(1),
    reviewers: z
      .array(z.string().trim().min(1))
      .length(2)
      .refine(
        (xs) => new Set(xs).size === 2,
        "Two distinct independent reviewers are required.",
      ),
    adjudicatedBy: z.string().trim().min(1),
    split: z.enum(["calibration", "held_out"]),
    familyId: z.string().min(1),
    requirements: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          status: z.enum([
            "met",
            "partial",
            "unmet",
            "unknown",
            "not_applicable",
          ]),
        })
        .strict(),
    ),
    decision: z.enum(["pass", "fail", "review"]),
    dimensions: z
      .array(
        z
          .object({
            dimension: dimensionNameSchema,
            status: z.enum([
              "pass",
              "fail",
              "review",
              "not_applicable",
              "unknown",
            ]),
          })
          .strict(),
      )
      .max(6)
      .optional(),
    blockingViolation: z.boolean(),
    explanationAudit: z
      .object({
        quotesReal: z.boolean(),
        evidenceSupportsJudgment: z.boolean(),
        matchesDecision: z.boolean(),
        correctionSupported: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const dims = (c.dimensions ?? []).map((d) => d.dimension);
    if (new Set(dims).size !== dims.length)
      ctx.addIssue({
        code: "custom",
        message: "Dimension labels must be unique.",
        path: ["dimensions"],
      });
  });
export const calibrationLabelsSchema = z
  .object({ version: z.literal(1), cases: z.array(labels).min(1) })
  .strict();
// Paired variants may share an approved caseId. Keep those answer records distinct.
export function calibrationCaseIds(run: Run) {
  const counts = new Map<string, number>();
  for (const r of run.records) {
    const id = r.question.criteria?.caseId ?? r.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const result = new Map(
    run.records.map((r) => {
      const id = r.question.criteria?.caseId ?? r.id;
      return [r.id, counts.get(id) === 1 ? id : r.id];
    }),
  );
  // A user-supplied caseId can itself equal another record's UUID.
  return new Set(result.values()).size === run.records.length
    ? result
    : new Map(run.records.map((r) => [r.id, r.id]));
}
export function calibrationTemplate(run: Run) {
  const ids = calibrationCaseIds(run);
  return {
    version: 1,
    cases: run.records.map((r) => ({
      caseId: ids.get(r.id)!,
      reviewers: ["", ""],
      adjudicatedBy: "",
      split: "held_out",
      familyId: "REPLACE_WITH_CASE_FAMILY",
      requirements:
        r.question.criteria?.requirements.map((c) => ({
          requirementId: c.id,
          status: c.applicable ? "unknown" : "not_applicable",
        })) ?? [],
      dimensions:
        r.dimensionSuite?.rows.map((row) => ({
          dimension: row.name,
          status: "unknown",
        })) ?? [],
      decision: "review",
      blockingViolation: false,
      explanationAudit: {
        quotesReal: false,
        evidenceSupportsJudgment: false,
        matchesDecision: false,
        correctionSupported: false,
      },
    })),
  };
}
export function calibrationReport(run: Run, raw: unknown) {
  const labels = calibrationLabelsSchema.parse(raw);
  if (new Set(labels.cases.map((c) => c.caseId)).size !== labels.cases.length)
    throw new Error("Duplicate labeled case IDs.");
  const families = new Map<string, string>();
  for (const c of labels.cases) {
    if (families.has(c.familyId) && families.get(c.familyId) !== c.split)
      throw new Error(
        "Case families must not cross calibration and held-out splits.",
      );
    families.set(c.familyId, c.split);
    if (c.familyId === "REPLACE_WITH_CASE_FAMILY")
      throw new Error("Assign real case-family IDs.");
  }
  const ids = calibrationCaseIds(run);
  const records = new Map(run.records.map((r) => [ids.get(r.id)!, r]));
  if (
    labels.cases.length !== run.records.length ||
    labels.cases.some((c) => !records.has(c.caseId))
  )
    throw new Error("Labels must cover every intended case exactly once.");
  const cases = labels.cases.map((c) => {
    const r = records.get(c.caseId)!;
    const current = latest(r);
    const criteria = r.question.criteria;
    const dimSuite =
      r.dimensionSuite ??
      r.attempts
        .filter((a) => a.status === "succeeded" && a.dimensionSuite)
        .at(-1)?.dimensionSuite;
    const expected = criteria?.requirements.map((x) => x.id) ?? [];
    if (
      new Set(c.requirements.map((x) => x.requirementId)).size !==
        expected.length ||
      c.requirements.length !== expected.length ||
      c.requirements.some((x) => !expected.includes(x.requirementId))
    )
      throw new Error(`${c.caseId}: labels must cover every requirement once.`);
    const dimLabels = c.dimensions ?? [];
    if (dimLabels.length || dimSuite) {
      const expectedDims = dimSuite?.rows.map((x) => x.name) ?? [];
      if (
        new Set(dimLabels.map((x) => x.dimension)).size !== dimLabels.length ||
        dimLabels.length !== expectedDims.length ||
        dimLabels.some((x) => !expectedDims.includes(x.dimension))
      )
        throw new Error(
          `${c.caseId}: dimension labels must cover every judged dimension once.`,
        );
    }
    const rows = current?.result.rows;
    const assessable = c.requirements.filter(
      (label) => !["unknown", "not_applicable"].includes(label.status),
    );
    const isMatch = (label: (typeof c.requirements)[number]) =>
      rows?.some(
        (row) =>
          row.requirementId === label.requirementId &&
          row.applicable &&
          row.status === label.status,
      );
    const matches = assessable.filter(isMatch).length;
    const semantic = assessable.filter((label) =>
      criteria?.requirements.some(
        (req) =>
          req.id === label.requirementId && req.check.type === "semantic",
      ),
    );
    const semanticMatches = semantic.filter(isMatch).length;
    if (c.blockingViolation && c.decision !== "fail")
      throw new Error(
        `${c.caseId}: an adjudicated blocking violation must fail.`,
      );
    const critical =
      c.blockingViolation ||
      c.requirements.some(
        (label) =>
          criteria?.requirements.some(
            (req) =>
              req.id === label.requirementId && req.applicable && req.critical,
          ) && ["partial", "unmet"].includes(label.status),
      );
    const dimAssessable = dimLabels.filter(
      (label) => !["unknown", "not_applicable"].includes(label.status),
    );
    const dimensionMatches = dimAssessable.filter((label) =>
      dimSuite?.rows.some(
        (row) => row.name === label.dimension && row.status === label.status,
      ),
    ).length;
    const judgeDecision =
      current?.result.decision ??
      (dimSuite
        ? dimSuite.overallPassed === null
          ? "review"
          : dimSuite.overallPassed
            ? "pass"
            : "fail"
        : undefined);
    return {
      caseId: c.caseId,
      split: c.split,
      language: criteria?.language ?? "unknown",
      folder: r.question.folder,
      total: assessable.length,
      excludedLabels: c.requirements.length - assessable.length,
      semanticTotal: semantic.length,
      semanticMatches,
      matches,
      dimensionTotal: dimAssessable.length,
      dimensionMatches,
      available: Boolean(current || dimSuite),
      critical,
      criticalFalsePass: critical && current?.result.decision === "pass",
      decisionMatch: judgeDecision === c.decision,
      explanationPass: Object.values(c.explanationAudit).every(Boolean),
    };
  });
  function aggregate(xs: typeof cases) {
    const total = xs.reduce((n, c) => n + c.total, 0),
      matches = xs.reduce((n, c) => n + c.matches, 0),
      critical = xs.filter((c) => c.critical),
      falsePasses = critical.filter((c) => c.criticalFalsePass).length;
    return {
      cases: xs.length,
      available: xs.filter((c) => c.available).length,
      requirementAgreement: total ? matches / total : null,
      requirementMatches: matches,
      requirementCount: total,
      excludedUnknownOrNALabels: xs.reduce((n, c) => n + c.excludedLabels, 0),
      semanticRequirementCount: xs.reduce((n, c) => n + c.semanticTotal, 0),
      semanticRequirementAgreement: xs.some((c) => c.semanticTotal)
        ? xs.reduce((n, c) => n + c.semanticMatches, 0) /
          xs.reduce((n, c) => n + c.semanticTotal, 0)
        : null,
      dimensionCount: xs.reduce((n, c) => n + c.dimensionTotal, 0),
      dimensionMatches: xs.reduce((n, c) => n + c.dimensionMatches, 0),
      dimensionAgreement: xs.some((c) => c.dimensionTotal)
        ? xs.reduce((n, c) => n + c.dimensionMatches, 0) /
          xs.reduce((n, c) => n + c.dimensionTotal, 0)
        : null,
      decisionAgreement: xs.length
        ? xs.filter((c) => c.decisionMatch).length / xs.length
        : null,
      criticalCases: critical.length,
      criticalFalsePasses: falsePasses,
      criticalFalsePassInterval: wilson(falsePasses, critical.length),
      explanationPasses: xs.filter((c) => c.explanationPass).length,
    };
  }
  const held = cases.filter((c) => c.split === "held_out"),
    report = aggregate(held);
  return {
    runId: run.id,
    heldOut: report,
    calibration: aggregate(cases.filter((c) => c.split === "calibration")),
    slices: [
      ...new Set(held.map((c) => JSON.stringify([c.folder, c.language]))),
    ].map((key) => {
      const [folder, language] = JSON.parse(key);
      return {
        folder,
        language,
        ...aggregate(
          held.filter((c) => c.folder === folder && c.language === language),
        ),
      };
    }),
    pilotSize: { recommendedMinimum: 60, actual: cases.length },
    pilotTargetsMet:
      cases.length >= 60 &&
      report.available === held.length &&
      held.length > 0 &&
      (report.requirementCount === 0 ||
        ((report.requirementAgreement ?? 0) >= 0.9 &&
          (report.semanticRequirementAgreement ?? 0) >= 0.9 &&
          report.criticalCases > 0 &&
          report.criticalFalsePasses === 0)) &&
      (report.dimensionCount === 0 ||
        (report.dimensionAgreement ?? 0) >= 0.9) &&
      report.explanationPasses === held.length,
    limitation:
      "Reviewer identities and independence are attestations. Pilot targets do not establish zero risk or authorize release automatically.",
    cases,
  };
}

/** Use the last three matching attempts of the same saved answer, never independent answer generations. */
export function stabilityReport(run: Run) {
  const cases = run.records.map((record) => {
    const fallbackCaseId = record.question.criteria?.caseId ?? record.id;
    const dimAttempts = record.attempts.filter(
      (a) =>
        a.status === "succeeded" &&
        a.dimensionSuite &&
        a.campaign?.dimensions &&
        a.evidenceHash,
    );
    const lastDim = dimAttempts.at(-1);
    let dimension: {
      eligible: boolean;
      reason?: string;
      dimensionDisagreement?: boolean;
      attemptIds?: string[];
    } = { eligible: false, reason: "No completed dimension evaluation" };
    if (lastDim) {
      const dimSignature = (a: typeof lastDim) =>
        hash({ evidence: a.evidenceHash, dims: a.campaign!.dimensions });
      const dimMatching = dimAttempts
        .filter((a) => dimSignature(a) === dimSignature(lastDim))
        .slice(-3);
      if (dimMatching.length < 3)
        dimension = {
          eligible: false,
          reason:
            "Need three attempts with identical evidence and dimension configuration",
        };
      else {
        const dimRows = dimMatching.map((a) =>
          JSON.stringify(
            a.dimensionSuite!.rows.map((r) => [
              r.name,
              r.status,
              r.confidence,
              r.averageScore,
            ]),
          ),
        );
        dimension = {
          eligible: true,
          dimensionDisagreement: new Set(dimRows).size > 1,
          attemptIds: dimMatching.map((a) => a.id),
        };
      }
    }
    const attempts = record.attempts.filter(
      (a) =>
        a.status === "succeeded" &&
        a.result?.requirements &&
        a.campaign &&
        a.evidenceHash &&
        a.questionSnapshot?.criteria,
    );
    const last = attempts.at(-1);
    if (!last)
      return {
        caseId: fallbackCaseId,
        eligible: false,
        reason: "No completed requirement evaluation",
        dimension,
      };
    const signature = (a: typeof last) =>
      hash({
        evidence: a.evidenceHash,
        judge: a.campaign!.evaluator,
        criteria: a.questionSnapshot!.criteria,
      });
    const matching = attempts
      .filter((a) => signature(a) === signature(last))
      .slice(-3);
    if (matching.length < 3)
      return {
        caseId: last.result!.requirements!.caseId,
        eligible: false,
        reason:
          "Need three attempts with identical evidence, requirements and judge configuration",
        dimension,
      };
    const decisions = matching.map((a) => a.result!.requirements!.decision);
    const judgments = matching.map((a) =>
      JSON.stringify(
        a.result!.requirements!.rows.map((r) => [
          r.requirementId,
          r.status,
          r.credit,
          r.applicable,
        ]),
      ),
    );
    return {
      caseId: last.result!.requirements!.caseId,
      eligible: true,
      decisionDisagreement: new Set(decisions).size > 1,
      requirementDisagreement: new Set(judgments).size > 1,
      attemptIds: matching.map((a) => a.id),
      dimension,
    };
  });
  return {
    runId: run.id,
    total: cases.length,
    eligible: cases.filter((c) => c.eligible).length,
    decisionDisagreements: cases.filter(
      (c) => c.eligible && c.decisionDisagreement,
    ).length,
    requirementDisagreements: cases.filter(
      (c) => c.eligible && c.requirementDisagreement,
    ).length,
    dimensionEligible: cases.filter((c) => c.dimension.eligible).length,
    dimensionDisagreements: cases.filter(
      (c) => c.dimension.eligible && c.dimension.dimensionDisagreement,
    ).length,
    limitation:
      "Repeated calls measure stability, not independent evidence of correctness. Preselect the subset before running it.",
    cases,
  };
}

export function cmsAgreementReport(
  run: Run,
  rawFixture: unknown,
  model: string,
) {
  const fixture = cmsFixtureSchema.parse(rawFixture);
  if (!fixture.models.includes(model))
    throw new Error(`Fixture has no labels for model ${model}.`);
  if (run.status === "active") throw new Error("Wait for the run to finish.");
  const byKey = new Map(
    fixture.cases.map((c) => [JSON.stringify([c.folder, c.query]), c]),
  );
  const selected = run.campaign?.dimensions?.dimensions.map((d) => d.name) ?? [
    ...DIMENSION_NAMES,
  ];
  const perDimension = selected.map((dimension) => {
    const acc = {
      dimension,
      compared: 0,
      agree: 0,
      confusion: { passPass: 0, passFail: 0, failPass: 0, failFail: 0 },
      excluded: {
        cmsError: 0,
        noLabels: 0,
        noSuite: 0,
        ourError: 0,
        ourReview: 0,
        notApplicable: 0,
      },
    };
    const disagreements: {
      caseId: string;
      query: string;
      dimension: string;
      cms: string;
      ours: string;
      cmsReason: string | null;
      ourReason: string;
      answerSource: string | null;
      category: string;
    }[] = [];
    for (const record of run.records) {
      const c = byKey.get(
        JSON.stringify([record.question.folder, record.question.query]),
      );
      const labels = c?.answers[model]?.labels;
      if (!c || !labels) {
        acc.excluded.noLabels++;
        continue;
      }
      const cms = labels.dimensions[dimension];
      if (!cms) {
        acc.excluded.noLabels++;
        continue;
      }
      if (cms.cmsError) {
        acc.excluded.cmsError++;
        continue;
      }
      const row = record.dimensionSuite?.rows.find((x) => x.name === dimension);
      if (!record.dimensionSuite || !row) {
        acc.excluded.noSuite++;
        continue;
      }
      if (row.status === "error") {
        acc.excluded.ourError++;
        continue;
      }
      if (row.status === "review") {
        acc.excluded.ourReview++;
        continue;
      }
      if (row.status === "not_applicable") {
        acc.excluded.notApplicable++;
        continue;
      }
      const ours = row.status === "pass" ? "PASS" : "FAIL";
      acc.compared++;
      const cell =
        ours === "PASS"
          ? cms.passed === "PASS"
            ? "passPass"
            : "passFail"
          : cms.passed === "PASS"
            ? "failPass"
            : "failFail";
      acc.confusion[cell]++;
      if (ours === cms.passed) acc.agree++;
      else {
        const raw = record.result?.rawResponse;
        const answerSource =
          raw && typeof raw === "object" && "answerSource" in raw
            ? String((raw as { answerSource?: unknown }).answerSource ?? "")
            : null;
        disagreements.push({
          caseId: c.caseId,
          query: c.query,
          dimension,
          cms: cms.passed,
          ours,
          cmsReason: cms.reason,
          ourReason: row.reason,
          answerSource,
          category:
            dimension === "no_answer_detection" &&
            answerSource === "tool_early_return"
              ? "clarification_policy_difference"
              : "semantic_disagreement",
        });
      }
    }
    return {
      ...acc,
      disagreements: disagreements.length,
      agreementRate: acc.compared ? acc.agree / acc.compared : null,
      agreementInterval: wilson(acc.agree, acc.compared),
      disagreementCases: disagreements,
    };
  });
  const compared = perDimension.reduce((n, d) => n + d.compared, 0);
  const agree = perDimension.reduce((n, d) => n + d.agree, 0);
  return {
    runId: run.id,
    model,
    rubricVersion: DIMENSION_RUBRIC,
    rubricStatus: "uncalibrated_draft",
    naPolicy: run.campaign?.dimensions?.naPolicy ?? null,
    totals: {
      compared,
      agree,
      agreementRate: compared ? agree / compared : null,
      agreementInterval: wilson(agree, compared),
    },
    perDimension,
    limitations: [
      "The CMS export contains no passage content; context_relevance, hallucination_detection and citation_quality are N/A and excluded from agreement.",
      "CMS judge errors (Evaluation failed reasons) are excluded, not counted as disagreements.",
      "Temporal judgments use the regrade date, which may differ from the original CMS evaluation date.",
      "Agreement with CMS labels is not human ground truth; adjudicated human labels remain the calibration target.",
    ],
  };
}
