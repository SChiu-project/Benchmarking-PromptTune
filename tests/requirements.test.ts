import { describe, it, expect } from "vitest";
import {
  calculateRequirementEvaluation,
  deterministicJudgment,
} from "../lib/requirement-scoring";
import { attachCriteria, criteriaSchema } from "../lib/evaluation-contract";
import { hash, createCampaign } from "../lib/evaluation-snapshot";
import { stateSchema, type Question } from "../lib/schema";
import {
  criteriaFor,
  requirement,
  unknownGrounding,
} from "./helpers/requirements";
const q: Question = {
  query: "Where is the accessible toilet and step-free route?",
  folder: "test",
  expected_answer: "Level 1. Beside Lift A. Use Lift A from the concourse.",
  evaluation_comments: "",
};
const answer = "Level 1. Beside Lift A.";
function scenario() {
  const question = {
    ...q,
    criteria: criteriaFor(q, {
      requirements: [
        requirement("R1", "Level 1.", { weight: 2 }),
        requirement("R2", "Beside Lift A."),
        requirement("R3", "Use Lift A from the concourse.", {
          weight: 3,
          critical: true,
        }),
      ],
    }),
  };
  const raw = {
    judgments: question.criteria.requirements.map((r, i) => ({
      requirementId: r.id,
      status: i === 2 ? "unmet" : "met",
      answerQuote: i === 2 ? null : r.reference.quote,
      referenceQuote: r.reference.quote,
      difference: i === 2 ? "Route absent." : "Matches.",
      correction: null,
    })),
    claims: [],
    grounding: unknownGrounding,
  };
  return { question, raw };
}
describe("requirement scoring and evidence contract", () => {
  it("computes 50% and independently fails a missing critical route", () => {
    const { question, raw } = scenario();
    const e = calculateRequirementEvaluation(question, answer, null, raw);
    expect(e.score).toBe(50);
    expect(e.requirements?.decision).toBe("fail");
    expect(e.requirements?.criticalFailures).toEqual(["R3"]);
    expect(e.assessment).toContain("3 of 6");
    expect(stateSchema.shape.runs).toBeDefined();
  });
  it("never lets a small critical omission hide behind a high score", () => {
    const { question, raw } = scenario();
    question.criteria.requirements[0].weight = 1000;
    const e = calculateRequirementEvaluation(question, answer, null, raw);
    expect(e.score).toBeGreaterThan(99);
    expect(e.requirements?.decision).toBe("fail");
  });
  it("keeps unknown weights in bounds and produces review even above threshold", () => {
    const { question, raw } = scenario();
    raw.judgments[2].status = "unknown";
    question.criteria.requirements[0].weight = 100;
    const e = calculateRequirementEvaluation(question, answer, null, raw);
    expect(e.score).toBeNull();
    expect(e.requirements?.lowerBound).toBe(97.1);
    expect(e.requirements?.upperBound).toBe(100);
    expect(e.requirements?.decision).toBe("review");
  });
  it("fails definitively below threshold even if other judgments remain unknown", () => {
    const { question, raw } = scenario();
    raw.judgments[0].status = "unknown";
    expect(
      calculateRequirementEvaluation(question, answer, null, raw).requirements
        ?.decision,
    ).toBe("fail");
  });
  it("excludes only frozen N/A requirements and treats no applicable requirements as unassessable", () => {
    const { question, raw } = scenario();
    question.criteria.requirements[2].applicable = false;
    raw.judgments.pop();
    expect(
      calculateRequirementEvaluation(question, answer, null, raw).score,
    ).toBe(100);
    question.criteria.requirements.forEach((r) => (r.applicable = false));
    raw.judgments = [];
    const e = calculateRequirementEvaluation(question, answer, null, raw);
    expect(e.score).toBeNull();
    expect(e.requirements?.decision).toBe("review");
    expect(e.requirements?.applicableWeight).toBe(0);
  });
  it("uses approved partial credit and rejects unauthorized partial or fabricated evidence", () => {
    const { question, raw } = scenario();
    raw.judgments[0].status = "partial";
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, raw),
    ).toThrow("partial credit");
    question.criteria.requirements[0].partial = {
      credit: 0.25,
      rule: "Approved partial detail",
    };
    expect(
      calculateRequirementEvaluation(question, answer, null, raw).score,
    ).toBe(25);
    raw.judgments[0].answerQuote = "Invented text";
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, raw),
    ).toThrow("fabricated answer");
  });
  it("rejects duplicate, missing and foreign requirement IDs and reference drift", () => {
    const { question, raw } = scenario();
    for (const judgments of [
      raw.judgments.slice(1),
      [...raw.judgments, raw.judgments[0]],
      [
        { ...raw.judgments[0], requirementId: "foreign" },
        ...raw.judgments.slice(1),
      ],
    ])
      expect(() =>
        calculateRequirementEvaluation(question, answer, null, {
          ...raw,
          judgments,
        }),
      ).toThrow("exactly once");
    raw.judgments[0].referenceQuote = "not approved";
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, raw),
    ).toThrow("approved quote");
    question.criteria.requirements[0].reference.quote = "not in reference";
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, raw),
    ).toThrow("absent");
  });
  it("requires real supporting quotes for met semantic judgments", () => {
    const { question, raw } = scenario();
    raw.judgments[0].answerQuote = null;
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, raw),
    ).toThrow("exact answer quote");
  });
  it("blocks an established contradiction independently of full fulfillment", () => {
    const { question, raw } = scenario();
    question.criteria.requirements = question.criteria.requirements.slice(0, 2);
    raw.judgments.pop();
    const claims = [
      {
        category: "contradiction",
        status: "established",
        answerQuote: "Level 1.",
        reference: { field: "expected_answer", quote: "Level 1." },
        explanation: "Synthetic contradictory-claim judgment.",
      },
    ];
    // Provenance validation cannot establish semantic correctness; this is why calibration is required.
    expect(
      calculateRequirementEvaluation(question, answer, null, { ...raw, claims })
        .requirements?.decision,
    ).toBe("fail");
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, {
        ...raw,
        claims: [{ ...claims[0], reference: null }],
      }),
    ).toThrow("reference evidence");
  });
  it("requires valid grounding indices and quotes and never infers support without passages", () => {
    const { question, raw } = scenario();
    const grounding = {
      status: "supported",
      evidence: [
        { sourceIndex: 0, quote: "Level 1.", answerQuote: "Level 1." },
      ],
      explanation: "Passage supports location.",
    };
    expect(() =>
      calculateRequirementEvaluation(question, answer, null, {
        ...raw,
        grounding,
      }),
    ).toThrow();
    const sources = [
      {
        id: null,
        title: "Location",
        url: null,
        content: "Level 1.",
        metadata: {},
      },
    ];
    expect(
      calculateRequirementEvaluation(question, answer, sources, {
        ...raw,
        grounding,
      }).requirements?.grounding.status,
    ).toBe("supported");
    grounding.evidence[0].sourceIndex = 1;
    expect(() =>
      calculateRequirementEvaluation(question, answer, sources, {
        ...raw,
        grounding,
      }),
    ).toThrow();
  });
});
describe("deterministic checks", () => {
  it("checks literal text with case sensitivity and Unicode code-point lengths", () => {
    const r = requirement("R1", "literal", {
      check: { type: "contains", value: "Lift A", caseSensitive: false },
    });
    expect(deterministicJudgment(r, "use LIFT A").answerQuote).toBe("LIFT A");
    expect(
      deterministicJudgment(
        { ...r, check: { type: "max_length", characters: 1 } },
        "😀",
      ).status,
    ).toBe("met");
    expect(
      deterministicJudgment({ ...r, check: { type: "json" } }, "null").status,
    ).toBe("met");
    expect(
      deterministicJudgment({ ...r, check: { type: "json" } }, "not json")
        .status,
    ).toBe("unmet");
  });
  it("checks numeric JSON with exact units, inclusive tolerance and no string coercion", () => {
    const r = requirement("R1", "numeric", {
      check: {
        type: "numeric_json",
        path: ["amount"],
        expected: 10,
        absoluteTolerance: 0.1,
        relativeTolerance: 0,
        unitPath: ["unit"],
        unit: "HKD",
      },
    });
    for (const value of [9.9, 10, 10.1])
      expect(
        deterministicJudgment(r, JSON.stringify({ amount: value, unit: "HKD" }))
          .status,
      ).toBe("met");
    for (const response of [
      { amount: 10.11, unit: "HKD" },
      { amount: "10", unit: "HKD" },
      { amount: 10, unit: "USD" },
      {},
    ])
      expect(deterministicJudgment(r, JSON.stringify(response)).status).toBe(
        "unmet",
      );
    expect(
      deterministicJudgment(
        {
          ...r,
          check: {
            ...(r.check as Extract<typeof r.check, { type: "numeric_json" }>),
            relativeTolerance: 0.05,
          },
        },
        '{"amount":10.5,"unit":"HKD"}',
      ).status,
    ).toBe("met");
  });
});
describe("criteria approval/import and immutable campaign identity", () => {
  it("matches the full dataset, scope and real references", () => {
    const criteria = criteriaFor(q);
    const sidecar = {
      version: 1,
      cases: [{ query: q.query, folder: q.folder, criteria }],
    };
    expect(
      attachCriteria([q], sidecar, criteria.projectId)[0].criteria.caseId,
    ).toBe("case-1");
    expect(() => attachCriteria([q], sidecar, "other")).toThrow("project");
    expect(() =>
      attachCriteria(
        [q],
        { ...sidecar, cases: [...sidecar.cases, ...sidecar.cases] },
        criteria.projectId,
      ),
    ).toThrow();
    expect(() =>
      attachCriteria(
        [q],
        { ...sidecar, cases: [{ ...sidecar.cases[0], query: "extra" }] },
        criteria.projectId,
      ),
    ).toThrow("match every");
    expect(() =>
      criteriaSchema.parse({
        ...criteria,
        requirements: [...criteria.requirements, ...criteria.requirements],
      }),
    ).toThrow();
  });
  it("hashes objects canonically and snapshots settings without credentials", () => {
    expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
    const config = {
      endpoint: "https://judge.test",
      model: "judge",
      timeoutMs: 1000,
      key: "never-store-this",
    };
    const campaign = createCampaign(
      [{ ...q, criteria: criteriaFor(q) }],
      config,
    );
    config.model = "changed";
    expect(campaign.evaluator?.model).toBe("judge");
    expect(JSON.stringify(campaign)).not.toContain("never-store-this");
  });
});
it("escapes literal metacharacters and uses zero tolerance as exact equality", () => {
  const r = requirement("R1", "literal", {
    check: { type: "contains", value: "[A]+(B)?\\", caseSensitive: true },
  });
  expect(deterministicJudgment(r, "prefix [A]+(B)?\\ suffix").status).toBe(
    "met",
  );
  expect(deterministicJudgment(r, "AAB").status).toBe("unmet");
  const numeric = requirement("R2", "number", {
    check: {
      type: "numeric_json",
      path: ["amount"],
      unitPath: ["unit"],
      unit: "HKD",
      expected: 0,
      absoluteTolerance: 0,
      relativeTolerance: 0,
    },
  });
  expect(
    deterministicJudgment(numeric, '{"amount":1e-16,"unit":"HKD"}').status,
  ).toBe("unmet");
});
