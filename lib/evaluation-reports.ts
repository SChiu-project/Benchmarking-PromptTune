import { z } from "zod";
import type { RecordData, Run } from "./schema";
import { needsJudge } from "./evaluation-contract";
import { hash } from "./evaluation-snapshot";

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
    explanationAudit: z
      .object({
        quotesReal: z.boolean(),
        evidenceSupportsJudgment: z.boolean(),
        matchesDecision: z.boolean(),
        correctionSupported: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const calibrationLabelsSchema = z
  .object({ version: z.literal(1), cases: z.array(labels).min(1) })
  .strict();
export function calibrationTemplate(run: Run) {
  return {
    version: 1,
    cases: run.records.map((r) => ({
      caseId: r.question.criteria?.caseId ?? "MISSING_CRITERIA",
      reviewers: ["", ""],
      adjudicatedBy: "",
      split: "held_out",
      familyId: "REPLACE_WITH_CASE_FAMILY",
      requirements:
        r.question.criteria?.requirements.map((c) => ({
          requirementId: c.id,
          status: c.applicable ? "unknown" : "not_applicable",
        })) ?? [],
      decision: "review",
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
  const records = new Map(
    run.records.map((r) => [r.question.criteria?.caseId, r]),
  );
  if (
    labels.cases.length !== run.records.length ||
    labels.cases.some((c) => !records.has(c.caseId))
  )
    throw new Error("Labels must cover every intended case exactly once.");
  const cases = labels.cases.map((c) => {
    const r = records.get(c.caseId)!;
    const current = latest(r);
    const expected = r.question.criteria!.requirements.map((r) => r.id);
    if (
      new Set(c.requirements.map((r) => r.requirementId)).size !==
        expected.length ||
      c.requirements.length !== expected.length ||
      c.requirements.some((r) => !expected.includes(r.requirementId))
    )
      throw new Error(`${c.caseId}: labels must cover every requirement once.`);
    const rows = current?.result.rows;
    const matches = c.requirements.filter((label) =>
      rows?.some(
        (row) =>
          row.requirementId === label.requirementId &&
          (row.applicable ? row.status : "not_applicable") === label.status,
      ),
    ).length;
    const critical = c.requirements.some(
      (label) =>
        r.question.criteria!.requirements.some(
          (req) =>
            req.id === label.requirementId && req.applicable && req.critical,
        ) && ["partial", "unmet"].includes(label.status),
    );
    return {
      caseId: c.caseId,
      split: c.split,
      language: r.question.criteria!.language,
      folder: r.question.folder,
      total: c.requirements.length,
      matches,
      available: Boolean(current),
      critical,
      criticalFalsePass: critical && current?.result.decision === "pass",
      decisionMatch: current?.result.decision === c.decision,
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
    pilotTargetsMet:
      report.available === held.length &&
      held.length > 0 &&
      (report.requirementAgreement ?? 0) >= 0.9 &&
      report.criticalCases > 0 &&
      report.criticalFalsePasses === 0 &&
      report.explanationPasses === held.length,
    limitation:
      "Reviewer identities and independence are attestations. Pilot targets do not establish zero risk or authorize release automatically.",
    cases,
  };
}

/** Use the last three matching attempts of the same saved answer, never independent answer generations. */
export function stabilityReport(run: Run) {
  const cases = run.records.map((record) => {
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
        caseId: record.question.criteria?.caseId,
        eligible: false,
        reason: "No completed requirement evaluation",
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
    limitation:
      "Repeated calls measure stability, not independent evidence of correctness. Preselect the subset before running it.",
    cases,
  };
}
