"use client";
import { useState } from "react";
import type { Question } from "@/lib/schema";
import { attachCriteria } from "@/lib/evaluation-contract";
import { ErrorBox } from "./common";

function template(questions: Question[], projectId: string) {
  return JSON.stringify(
    {
      version: 1,
      cases: questions.map((q, i) => ({
        query: q.query,
        folder: q.folder,
        criteria: q.criteria ?? {
          version: "criteria-v1",
          caseId: `case-${i + 1}`,
          projectId,
          language: "unspecified",
          referenceVersion: "reference-v1",
          approvedBy: "",
          approvedAt: new Date().toISOString(),
          policy: {
            version: "policy-v1",
            passThreshold: 85,
            checkAdditionalClaims: true,
            blockingCategories: ["contradiction", "unsupported_claim"],
          },
          requirements: [
            {
              id: "R1",
              text: "Replace this draft with atomic, independently checkable requirements.",
              reference: {
                field: q.expected_answer
                  ? "expected_answer"
                  : "evaluation_comments",
                quote:
                  q.expected_answer ||
                  q.evaluation_comments ||
                  "Add a reference before approving.",
              },
              weight: 1,
              critical: false,
              applicable: true,
              applicabilityReason: "Applies to this case.",
              partial: null,
              check: { type: "semantic" },
            },
          ],
        },
      })),
    },
    null,
    2,
  );
}
export function CriteriaEditor({
  questions,
  projectId,
  disabled = false,
  onChange,
}: {
  questions: Question[];
  projectId: string;
  disabled?: boolean;
  onChange: (questions: Question[] | undefined, blocked: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState(() => template(questions, projectId));
  const [reviewer, setReviewer] = useState("");
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  function invalidate() {
    setApproved(false);
    setError("");
    onChange(undefined, true);
  }
  return (
    <section className="criteria-editor">
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={disabled}
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setApproved(false);
            setError("");
            onChange(undefined, e.target.checked);
          }}
        />{" "}
        Import or edit approved evaluation requirements
      </label>
      <p className="muted">
        New grading uses a fixed requirement checklist. Without approved
        criteria, new answers are saved and grading is skipped. Existing
        criteria are retained when regrading.
      </p>
      {enabled && (
        <>
          <p>
            Split the draft into atomic requirements. Review weights, critical
            flags, reference quotes, language and policy before approval. A
            starter is a draft, not a calibrated rubric.
          </p>
          <label>
            Load criteria JSON{" "}
            <input
              type="file"
              accept=".json,application/json"
              disabled={disabled}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1024 * 1024) {
                  setError("Criteria file must be smaller than 1 MB.");
                  return;
                }
                invalidate();
                setDraft(await f.text());
              }}
            />
          </label>
          <label htmlFor="criteria-json">Criteria sidecar JSON</label>
          <textarea
            id="criteria-json"
            rows={14}
            className="criteria-json"
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              invalidate();
            }}
          />
          <label>
            Reviewed by{" "}
            <input
              value={reviewer}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => {
                setReviewer(e.target.value);
                invalidate();
              }}
            />
          </label>
          <ErrorBox message={error} />
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || !reviewer.trim()}
            onClick={() => {
              try {
                const raw = JSON.parse(draft);
                if (!Array.isArray(raw.cases))
                  throw new Error("Expected a cases array.");
                raw.cases = raw.cases.map((c: { criteria: object }) => ({
                  ...c,
                  criteria: {
                    ...c.criteria,
                    approvedBy: reviewer.trim(),
                    approvedAt: new Date().toISOString(),
                  },
                }));
                const attached = attachCriteria(questions, raw, projectId);
                if (
                  attached.some((q) =>
                    q.criteria.requirements.some((r) =>
                      r.text.startsWith("Replace this draft"),
                    ),
                  )
                )
                  throw new Error(
                    "Replace the starter requirement with the actual approved obligations.",
                  );
                setDraft(JSON.stringify(raw, null, 2));
                setApproved(true);
                setError("");
                onChange(attached, false);
              } catch (e) {
                setApproved(false);
                onChange(undefined, true);
                setError((e as Error).message);
              }
            }}
          >
            {approved
              ? "Approved for this submission"
              : "I reviewed and approve these requirements"}
          </button>
          {approved && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([draft], { type: "application/json" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "evaluation-criteria.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download approved criteria
            </button>
          )}
        </>
      )}
    </section>
  );
}
