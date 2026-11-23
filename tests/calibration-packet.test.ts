import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { calibrationPacket } from "../lib/calibration-packet";
import {
  calibrationCaseIds,
  calibrationLabelsSchema,
  calibrationReport,
} from "../lib/evaluation-reports";
import { createCampaign } from "../lib/evaluation-snapshot";
import { aggregateDimensionSuite, errorRow } from "../lib/dimension-contract";
import { runSchema, type Run } from "../lib/schema";
import { criteriaFor } from "./helpers/requirements";
function fixture(criteria = false): Run {
  const id = randomUUID(),
    now = "2026-11-23T00:00:00.000Z";
  const q = {
    query: "Which form and deadline?",
    folder: "Widget",
    expected_answer: "Form ND2A, 15 days",
    evaluation_comments: "",
  };
  const question = criteria ? { ...q, criteria: criteriaFor(q) } : q;
  const campaign = createCampaign(
    [question],
    {
      endpoint: "https://judge.test",
      model: "PRIVATE_JUDGE",
      key: "not-saved",
      timeoutMs: 1000,
    },
    { names: ["citation_quality"] },
  );
  const rows = [
    {
      ...errorRow("citation_quality", "MACHINE_ONLY"),
      status: "fail" as const,
    },
  ];
  const suite = {
    rubricVersion: "dimensions-v1.0",
    rubricStatus: "uncalibrated_draft",
    naPolicy: "strict",
    evaluatedAt: now,
    rows,
    ...aggregateDimensionSuite(rows),
    attempts: [
      {
        name: "citation_quality",
        promptHash: campaign.dimensions!.dimensions[0].promptHash,
        status: "succeeded",
        startedAt: now,
        finishedAt: now,
      },
    ],
  };
  return runSchema.parse({
    id,
    idempotencyKey: randomUUID(),
    requestHash: "hash",
    kind: "batch",
    createdAt: now,
    status: "completed",
    concurrency: 2,
    config: {
      endpoint: "https://search.test",
      projectId: "mtr-air-kiosk-05emf61",
      timeoutMs: 1000,
    },
    campaign,
    records: ["PRIVATE_MODEL_ONE", "PRIVATE_MODEL_TWO"].map(
      (generationModel) => ({
        id: randomUUID(),
        runId: id,
        generationModel,
        question,
        execution: "succeeded",
        evaluationStatus: "succeeded",
        createdAt: now,
        result: {
          answer: "File ND2A within 15 days [P24].",
          sources: Array.from({ length: 27 }, (_, i) => ({
            id: String(i),
            title: `Passage ${i + 1}`,
            url: null,
            content:
              i === 23 ? "FULL_EVIDENCE_" + "x".repeat(9000) : "Source text",
            metadata: { private: "PRIVATE_METADATA" },
          })),
          traceId: "PRIVATE_TRACE",
          latencyMs: 1,
          rawRequest: {},
          rawResponse: { secret: "PRIVATE_RAW" },
        },
        dimensionSuite: suite,
        attempts: [
          {
            id: randomUUID(),
            model: "PRIVATE_JUDGE",
            endpoint: "https://judge.test",
            rubricVersion: "dimensions-v1.0",
            campaign,
            questionSnapshot: question,
            startedAt: now,
            status: "succeeded",
            dimensionSuite: suite,
          },
        ],
      }),
    ),
  });
}
it("keeps identities and machine grades in coordinator files only", () => {
  const run = fixture(),
    packet = calibrationPacket(run);
  const review = JSON.stringify([
    packet.evidence,
    packet.reviewer1,
    packet.reviewer2,
  ]);
  for (const hidden of [
    "PRIVATE_MODEL_ONE",
    "PRIVATE_MODEL_TWO",
    "PRIVATE_JUDGE",
    "MACHINE_ONLY",
    "PRIVATE_RAW",
    "PRIVATE_TRACE",
    "PRIVATE_METADATA",
  ])
    expect(review).not.toContain(hidden);
  expect(
    packet.coordinator.mapping.map((m) => m.generationModel).sort(),
  ).toEqual(["PRIVATE_MODEL_ONE", "PRIVATE_MODEL_TWO"]);
  expect(packet.coordinator.mapping[0].machineDimensions[0].reason).toBe(
    "MACHINE_ONLY",
  );
});
it("preserves every full passage, shared case families and evidence hashes", () => {
  const packet = calibrationPacket(fixture());
  expect(packet.coordinator.caseFamilies).toBe(1);
  expect(new Set(packet.evidence.cases.map((c) => c.familyId)).size).toBe(1);
  for (const c of packet.evidence.cases) {
    expect(c.passages).toHaveLength(27);
    expect(c.passages![23].content.length).toBeGreaterThan(9000);
    expect(c.passages![23].index).toBe(24);
    expect(c.evidenceHash).toHaveLength(64);
  }
  expect(
    packet.adjudication.cases.every((c) => c.split === "calibration"),
  ).toBe(true);
});
it("leaves independent reviewer forms blank and does not mutate saved results", () => {
  const run = fixture(),
    before = JSON.stringify(run),
    packet = calibrationPacket(run);
  expect(packet.reviewer1.cases[0].dimensions[0].status).toBe("unknown");
  packet.reviewer1.cases[0].dimensions[0].reason = "Reviewer one's judgment";
  expect(packet.reviewer2.cases[0].dimensions[0].reason).toBe("");
  expect(calibrationLabelsSchema.safeParse(packet.adjudication).success).toBe(
    false,
  );
  expect(JSON.stringify(run)).toBe(before);
});
it("keeps paired records with shared approved case IDs distinct in calibration reports", () => {
  const run = fixture(true),
    packet = calibrationPacket(run);
  expect(new Set(packet.adjudication.cases.map((c) => c.caseId)).size).toBe(2);
  const labels = packet.adjudication;
  for (const c of labels.cases) {
    c.reviewers = ["Reviewer 1", "Reviewer 2"];
    c.adjudicatedBy = "Adjudicator";
  }
  expect(() => calibrationReport(run, labels)).not.toThrow();
  expect(calibrationReport(run, labels).pilotTargetsMet).toBe(false);
  run.records = [run.records[0]];
  expect(calibrationCaseIds(run).get(run.records[0].id)).toBe("case-1");
});
it.each(["active", "missing_answer", "missing_rubric"])(
  "rejects %s instead of silently dropping cases",
  (condition) => {
    const run = fixture();
    if (condition === "active") run.status = "active";
    if (condition === "missing_answer") delete run.records[0].result;
    if (condition === "missing_rubric") {
      delete run.campaign;
      run.records.forEach((r) => {
        r.attempts = [];
      });
    }
    expect(() => calibrationPacket(run)).toThrow();
  },
);
it("avoids a custom case ID colliding with a paired record UUID", () => {
  const run = fixture(true);
  const third = structuredClone(run.records[0]);
  third.id = randomUUID();
  third.question.query = "Another question";
  third.question.criteria!.caseId = run.records[0].id;
  run.records.push(third);
  const ids = calibrationCaseIds(run);
  expect(new Set(ids.values()).size).toBe(3);
  expect([...ids.values()]).toEqual(run.records.map((r) => r.id));
});

it("rejects evidence that changed since grading", () => {
  const run = fixture();
  run.records[0].attempts[0].evidenceHash = "0".repeat(64);
  expect(() => calibrationPacket(run)).toThrow(
    "differs from the graded attempt",
  );
});
