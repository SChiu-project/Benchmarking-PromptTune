"use client";
import { useRef, useState, useEffect } from "react";
import { api, ErrorBox } from "./common";
import { CmsAccess } from "./cms-access";
type Option = { id: string; name: string };
export function ModelSelection({
  projectId,
  disabled,
  onChange,
}: {
  projectId: string;
  disabled: boolean;
  onChange: (
    models: string[] | undefined,
    evaluator: string | undefined,
    blocked: boolean,
  ) => void;
}) {
  const [mode, setMode] = useState("default"),
    [first, setFirst] = useState(""),
    [second, setSecond] = useState(""),
    [evaluator, setEvaluator] = useState("");
  const [generation, setGeneration] = useState<Option[]>([]),
    [judges, setJudges] = useState<Option[]>([]);
  const [busy, setBusy] = useState(""),
    [generationError, setGenerationError] = useState(""),
    [judgeError, setJudgeError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function change(nextMode = mode, a = first, b = second, judge = evaluator) {
    setMode(nextMode);
    setFirst(a);
    setSecond(b);
    setEvaluator(judge);
    const invalid =
      nextMode !== "default" &&
      (!a || (nextMode === "compare" && (!b || a === b)));
    onChange(
      nextMode === "default"
        ? undefined
        : nextMode === "compare"
          ? [a, b]
          : [a],
      judge || undefined,
      invalid,
    );
  }
  async function load(kind: "generation" | "evaluator") {
    setBusy(kind);
    const setError = kind === "generation" ? setGenerationError : setJudgeError;
    setError("");
    try {
      const response = await api<{ models: Option[] }>(
        `/api/models?${new URLSearchParams({ kind, projectId })}`,
      );
      if (!alive.current) return;
      if (kind === "generation") setGeneration(response.models);
      else setJudges(response.models);
      if (!response.models.length)
        setError("No supported models are available in this catalog.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy("");
    }
  }
  return (
    <section className="panel model-selection" aria-label="Benchmark models">
      <h3>Benchmark models</h3>
      <label>
        Generation mode{" "}
        <select
          aria-label="Generation mode"
          disabled={disabled}
          value={mode}
          onChange={(e) => change(e.target.value)}
        >
          <option value="default">Use project default</option>
          <option value="single">Select one model</option>
          <option value="compare">Compare two models</option>
        </select>
      </label>
      {mode !== "default" && (
        <>
          <CmsAccess projectId={projectId} disabled={disabled} />
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || !!busy || !projectId}
            onClick={() => void load("generation")}
          >
            {busy === "generation" ? "Loading models…" : "Load models from CMS"}
          </button>
          <ErrorBox message={generationError} />
          <label>
            Generation model A{" "}
            <select
              aria-label="Generation model A"
              value={first}
              disabled={disabled || !generation.length}
              onChange={(e) => change(mode, e.target.value)}
            >
              <option value="">Choose a CMS model</option>
              {generation.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.id}
                </option>
              ))}
            </select>
          </label>
          {mode === "compare" && (
            <label>
              Generation model B{" "}
              <select
                aria-label="Generation model B"
                value={second}
                disabled={disabled || !generation.length}
                onChange={(e) => change(mode, first, e.target.value)}
              >
                <option value="">Choose a different CMS model</option>
                {generation.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.id === first}>
                    {m.name} · {m.id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label>
        Evaluation model{" "}
        <select
          aria-label="Evaluation model"
          value={evaluator}
          disabled={disabled}
          onChange={(e) => change(mode, first, second, e.target.value)}
        >
          <option value="">Use configured evaluator</option>
          {judges.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.id}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button secondary small"
        disabled={disabled || !!busy}
        onClick={() => void load("evaluator")}
      >
        {busy === "evaluator"
          ? "Loading evaluators…"
          : "Load evaluators from OpenRouter"}
      </button>
      <ErrorBox message={judgeError} />
      <p className="muted">
        One evaluator grades both models and their comparisons. OpenRouter lists
        models with JSON output support; availability through your company proxy
        is confirmed when grading runs.
      </p>
      {mode === "compare" && (
        <p className="muted">
          Both models receive the same questions and grading settings.
          Comparisons use your selected quality dimensions, or all six if none
          are selected. First-query testing uses model A.
        </p>
      )}
    </section>
  );
}
