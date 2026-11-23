// Read-only human review preparation. Machine verdicts stay in coordinator files.
import { randomInt } from "node:crypto";
import { calibrationCaseIds, calibrationTemplate } from "./evaluation-reports";
import { evidenceHash, hash } from "./evaluation-snapshot";
import type { Run } from "./schema";

export function calibrationPacket(run: Run) {
  if (run.status === "active")
    throw new Error(
      "Wait for this run to finish before preparing review materials.",
    );
  if (
    !run.records.length ||
    run.records.some((r) => r.execution !== "succeeded" || !r.result)
  )
    throw new Error(
      "Every intended record must have a confirmed saved answer; no cases are silently excluded.",
    );
  const records = [...run.records];
  for (let i = records.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [records[i], records[j]] = [records[j], records[i]];
  }
  const ids = calibrationCaseIds(run);
  const adjudication = calibrationTemplate(run);
  const cases = records.map((r, i) => {
    const attempt = r.attempts.findLast(
      (a) => a.status === "succeeded" && a.dimensionSuite,
    );
    const dimensions =
      attempt?.campaign?.dimensions ?? run.campaign?.dimensions;
    if (!dimensions || !r.dimensionSuite)
      throw new Error(
        "Each record needs saved dimension results and its frozen grading rubric.",
      );
    const currentEvidenceHash = evidenceHash(
      r.question,
      r.result!.answer,
      r.result!.sources,
    );
    if (attempt?.evidenceHash && attempt.evidenceHash !== currentEvidenceHash)
      throw new Error(
        "Saved answer evidence differs from the graded attempt. Regrade before preparing review materials.",
      );
    const familyId = `family-${hash([r.question.folder, r.question.query]).slice(0, 16)}`;
    const id = `answer-${String(i + 1).padStart(3, "0")}`;
    const label = adjudication.cases.find((c) => c.caseId === ids.get(r.id))!;
    label.familyId = familyId;
    // This pilot has already been used for tuning. It cannot be a held-out test.
    label.split = "calibration";
    return {
      id,
      familyId,
      question: r.question.query,
      folder: r.question.folder,
      reference: {
        expectedAnswer: r.question.expected_answer,
        comments: r.question.evaluation_comments,
        criteria: r.question.criteria ?? null,
      },
      answer: r.result!.answer,
      passages:
        r.result!.sources?.map((s, index) => ({
          index: index + 1,
          title: s.title,
          url: s.url,
          content: s.content,
        })) ?? null,
      evidenceHash: currentEvidenceHash,
      evaluationDate: r.dimensionSuite.evaluatedAt.slice(0, 10),
      rubric: {
        version: dimensions.rubricVersion,
        naPolicy: dimensions.naPolicy,
        dimensions: dimensions.dimensions.map((d) => ({
          name: d.name,
          instructions: d.promptBody,
          thresholds: d.thresholds,
          promptHash: d.promptHash,
        })),
      },
    };
  });
  const form = () => ({
    version: 1,
    reviewer: "",
    completedAt: "",
    instructions:
      "Review independently using evidence.json. Unknown values are unreviewed placeholders. Record exact answer/passage evidence and a reason. Do not consult model identities or machine judgments before locking your labels.",
    cases: cases.map((c) => ({
      id: c.id,
      familyId: c.familyId,
      evidenceHash: c.evidenceHash,
      dimensions: c.rubric.dimensions.map((d) => ({
        dimension: d.name,
        status: "unknown",
        reason: "",
        evidence: [] as {
          answerQuote: string;
          passageIndex: number | null;
          passageQuote: string | null;
        }[],
      })),
      decision: "unknown",
      blockingViolation: null as boolean | null,
    })),
  });
  return {
    evidence: {
      version: 1,
      instructions: [
        "This is a small calibration exercise, not evidence of release readiness. Answers to the same question are one case family.",
        "Both reviewers work independently. Use pass, fail, review, not_applicable or unknown for each dimension; give evidence and a reason. Missing evidence is not proof of a false claim.",
        "All saved passages are provided without evaluator truncation. A quoted passage must support the specific claim it cites; similar wording about a different role or form is insufficient by itself.",
        "The coordinator resolves disagreements only after both reviewer forms are complete. Do not replace human labels with machine labels.",
      ],
      cases,
    },
    reviewer1: form(),
    reviewer2: form(),
    adjudication,
    coordinator: {
      version: 1,
      runId: run.id,
      sharing:
        "Coordinator only: do not give this file or adjudication.json to independent reviewers.",
      caseFamilies: new Set(cases.map((c) => c.familyId)).size,
      limitations: [
        "Family IDs group exact question/folder matches only; domain reviewers must group paraphrases and related cases before a larger study.",
        "This pilot was used for tuning, so its cases are assigned to calibration, never held_out.",
        "Two answer records are not two independent questions. A representative, independently reviewed held-out set is still required.",
      ],
      mapping: cases.map((c, index) => {
        const r = records[index];
        return {
          reviewId: c.id,
          caseId: ids.get(r.id)!,
          recordId: r.id,
          generationModel: r.generationModel ?? "unknown",
          evidenceHash: c.evidenceHash,
          machineDimensions: r.dimensionSuite!.rows,
          attemptIds: r.attempts.map((a) => a.id),
        };
      }),
    },
  };
}
