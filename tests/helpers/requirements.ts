import type { Question } from "../../lib/schema";
import type { Criteria, Requirement } from "../../lib/evaluation-contract";
export function criteriaFor(
  q: Question,
  options: Partial<Criteria> = {},
): Criteria {
  return {
    version: "criteria-v1",
    caseId: "case-1",
    projectId: "mtr-air-kiosk-05emf61",
    language: "en",
    referenceVersion: "ref-v1",
    approvedBy: "Domain reviewer",
    approvedAt: "2026-11-15T00:00:00.000Z",
    policy: {
      version: "policy-v1",
      passThreshold: 85,
      checkAdditionalClaims: true,
      blockingCategories: ["contradiction", "unsupported_claim"],
    },
    requirements: [
      {
        id: "R1",
        text: "Provide the approved answer.",
        reference: { field: "expected_answer", quote: q.expected_answer },
        weight: 1,
        critical: false,
        applicable: true,
        applicabilityReason: "Required by the question",
        partial: null,
        check: { type: "semantic" },
      },
    ],
    ...options,
  };
}
export function requirement(
  id: string,
  quote: string,
  extra: Partial<Requirement> = {},
): Requirement {
  return {
    id,
    text: quote,
    reference: { field: "expected_answer", quote },
    weight: 1,
    critical: false,
    applicable: true,
    applicabilityReason: "Required",
    partial: null,
    check: { type: "semantic" },
    ...extra,
  };
}
export const unknownGrounding = {
  status: "unknown" as const,
  evidence: [],
  explanation: "No passages supplied.",
};
