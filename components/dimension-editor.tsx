"use client";
import { useState } from "react";
import {
  DIMENSION_NAMES,
  DIMENSION_DEFINITIONS,
  dimensionThresholdsSchema,
  validateDimensionPromptBody,
  type DimensionName,
  type DimensionSelectionInput,
  type NaPolicy,
} from "@/lib/dimension-contract";
import { ErrorBox } from "./common";

export const DIMENSION_LABELS: Record<DimensionName, string> = {
  context_relevance: "Context relevance",
  temporal_accuracy: "Temporal accuracy",
  completeness: "Completeness",
  no_answer_detection: "No-answer detection",
  hallucination_detection: "Hallucination detection",
  citation_quality: "Citation quality",
};
type ThresholdDraft = {
  avgThreshold?: number;
  relevantMin?: number;
  confidenceFloor?: number;
};
type Overrides = Partial<
  Record<DimensionName, { promptBody?: string; thresholds?: ThresholdDraft }>
>;
type EditorState = {
  enabled: boolean;
  names: DimensionName[];
  naPolicy: NaPolicy;
  overrides: Overrides;
};
function lineDiff(oldText: string, newText: string) {
  const a = oldText.split("\n"),
    b = newText.split("\n"),
    m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { kind: " " | "-" | "+"; text: string }[] = [];
  let i = 0,
    j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "-", text: a[i] });
      i++;
    } else {
      out.push({ kind: "+", text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: "-", text: a[i++] });
  while (j < n) out.push({ kind: "+", text: b[j++] });
  return out;
}
export function DimensionEditor({
  disabled = false,
  evaluatorConfigured = null,
  onChange,
}: {
  disabled?: boolean;
  evaluatorConfigured?: boolean | null;
  onChange: (
    selection: DimensionSelectionInput | undefined,
    blocked: boolean,
  ) => void;
}) {
  const [state, setState] = useState<EditorState>({
    enabled: false,
    names: [...DIMENSION_NAMES],
    naPolicy: "strict",
    overrides: {},
  });
  const [expanded, setExpanded] = useState<DimensionName | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  function update(patch: Partial<EditorState>) {
    const next = { ...state, ...patch };
    setState(next);
    if (!next.enabled) {
      setErrors([]);
      onChange(undefined, false);
      return;
    }
    const errs: string[] = [];
    if (!next.names.length) errs.push("Select at least one dimension.");
    const overrides: Overrides = {};
    for (const name of next.names) {
      const o = next.overrides[name];
      const body = o?.promptBody ?? DIMENSION_DEFINITIONS[name].body;
      try {
        validateDimensionPromptBody(name, body);
      } catch (e) {
        errs.push((e as Error).message);
      }
      if (o?.thresholds) {
        const clean = Object.fromEntries(
          Object.entries(o.thresholds).filter(([, v]) => v !== undefined),
        );
        if (!dimensionThresholdsSchema.partial().safeParse(clean).success)
          errs.push(`${DIMENSION_LABELS[name]}: threshold out of range.`);
      }
      if (o && (o.promptBody !== undefined || o.thresholds !== undefined))
        overrides[name] = o;
    }
    setErrors(errs);
    onChange(
      errs.length
        ? undefined
        : {
            names: next.names,
            naPolicy: next.naPolicy,
            ...(Object.keys(overrides).length ? { overrides } : {}),
          },
      errs.length > 0,
    );
  }
  function setOverride(name: DimensionName, patch: Overrides[DimensionName]) {
    update({
      overrides: { ...state.overrides, [name]: { ...state.overrides[name], ...patch } },
    });
  }
  function isEdited(name: DimensionName) {
    const o = state.overrides[name];
    if (!o) return false;
    const defaults = dimensionThresholdsSchema.parse({});
    return (
      (o.promptBody !== undefined &&
        o.promptBody !== DIMENSION_DEFINITIONS[name].body) ||
      (o.thresholds !== undefined &&
        Object.entries(o.thresholds).some(
          ([k, v]) => v !== undefined && v !== defaults[k as keyof typeof defaults],
        ))
    );
  }
  return (
    <section className="criteria-editor dimension-editor">
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={disabled}
          checked={state.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />{" "}
        Evaluate CMS-style quality dimensions
      </label>
      <p className="muted">
        Adds per-dimension PASS/FAIL judgments (draft rubric dimensions-v1.0,
        uncalibrated) alongside any requirement evaluation. Review and edit each
        dimension&apos;s judge prompt below before running; the final prompts
        are frozen into this run&apos;s campaign.
      </p>
      {state.enabled && (
        <>
          {evaluatorConfigured === false && (
            <div className="alert warning">
              The LLM evaluator is not configured. Answers will be saved, but
              dimension grading is skipped until EVALUATOR_ENDPOINT,
              EVALUATOR_MODEL and EVALUATOR_API_KEY are set.
            </div>
          )}
          <div className="dimension-policy">
            <label>
              Missing-passage policy{" "}
              <select
                aria-label="Missing-passage policy"
                value={state.naPolicy}
                disabled={disabled}
                onChange={(e) =>
                  update({ naPolicy: e.target.value as NaPolicy })
                }
              >
                <option value="strict">
                  Strict — N/A excluded from pass rate
                </option>
                <option value="cms-compatible">
                  CMS-compatible — N/A counts as PASS
                </option>
              </select>
            </label>
            <span className="muted">
              Up to {state.names.length} judge call
              {state.names.length === 1 ? "" : "s"} per question.
            </span>
          </div>
          {DIMENSION_NAMES.map((name) => {
            const def = DIMENSION_DEFINITIONS[name];
            const selected = state.names.includes(name);
            const o = state.overrides[name];
            const body = o?.promptBody ?? def.body;
            const edited = isEdited(name);
            const thresholds = {
              ...dimensionThresholdsSchema.parse({}),
              ...Object.fromEntries(
                Object.entries(o?.thresholds ?? {}).filter(
                  ([, v]) => v !== undefined,
                ),
              ),
            };
            return (
              <div className="dimension-item" key={name}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected}
                    onChange={(e) =>
                      update({
                        names: e.target.checked
                          ? [...state.names, name]
                          : state.names.filter((n) => n !== name),
                      })
                    }
                  />{" "}
                  {DIMENSION_LABELS[name]}
                  {edited && <span className="badge running">Modified</span>}
                </label>
                {selected && (
                  <>
                    <p className="muted">
                      {def.needsPassages
                        ? "Needs retrieved passages. Answers without passages are N/A (strict) or PASS (CMS-compatible)."
                        : "Judges the answer text; no passages required."}
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={disabled}
                      onClick={() =>
                        setExpanded(expanded === name ? null : name)
                      }
                    >
                      {expanded === name
                        ? "Hide judge prompt"
                        : "Review / edit judge prompt"}
                    </button>
                    {expanded === name && (
                      <div className="dimension-prompt">
                        <label htmlFor={`dim-prompt-${name}`}>
                          Judge prompt body (safety wrapper and JSON output
                          contract are fixed and appended automatically)
                        </label>
                        <textarea
                          id={`dim-prompt-${name}`}
                          rows={10}
                          className="criteria-json"
                          value={body}
                          disabled={disabled}
                          onChange={(e) =>
                            setOverride(name, { promptBody: e.target.value })
                          }
                        />
                        <div className="dimension-thresholds">
                          {name === "context_relevance" ? (
                            <>
                              <label>
                                Pass when average ≥{" "}
                                <input
                                  type="number"
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  disabled={disabled}
                                  value={thresholds.avgThreshold}
                                  onChange={(e) =>
                                    setOverride(name, {
                                      thresholds: {
                                        ...o?.thresholds,
                                        avgThreshold: Number.isNaN(
                                          e.target.valueAsNumber,
                                        )
                                          ? undefined
                                          : e.target.valueAsNumber,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Relevant when rating ≥{" "}
                                <input
                                  type="number"
                                  min={0}
                                  max={2}
                                  step={1}
                                  disabled={disabled}
                                  value={thresholds.relevantMin}
                                  onChange={(e) =>
                                    setOverride(name, {
                                      thresholds: {
                                        ...o?.thresholds,
                                        relevantMin: Number.isNaN(
                                          e.target.valueAsNumber,
                                        )
                                          ? undefined
                                          : e.target.valueAsNumber,
                                      },
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : (
                            <label>
                              Review below confidence{" "}
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                disabled={disabled}
                                value={thresholds.confidenceFloor}
                                onChange={(e) =>
                                  setOverride(name, {
                                    thresholds: {
                                      ...o?.thresholds,
                                      confidenceFloor: Number.isNaN(
                                        e.target.valueAsNumber,
                                      )
                                        ? undefined
                                        : e.target.valueAsNumber,
                                    },
                                  })
                                }
                              />
                            </label>
                          )}
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={disabled || !edited}
                            onClick={() => {
                              const next = { ...state.overrides };
                              delete next[name];
                              update({ overrides: next });
                            }}
                          >
                            Reset to default
                          </button>
                        </div>
                        {edited && o?.promptBody !== undefined && (
                          <details>
                            <summary>Diff against default prompt</summary>
                            <pre className="prompt-diff">
                              {lineDiff(def.body, o.promptBody).map((l, i) => (
                                <span key={i} className={`diff-${l.kind === " " ? "ctx" : l.kind === "-" ? "del" : "add"}`}>
                                  {l.kind} {l.text}
                                  {"\n"}
                                </span>
                              ))}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {errors.map((e) => (
            <ErrorBox key={e} message={e} />
          ))}
        </>
      )}
    </section>
  );
}
