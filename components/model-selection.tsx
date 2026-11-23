"use client";
import { useState, useEffect } from "react";
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
  const [authorized, setAuthorized] = useState(false),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false),
    [generationError, setGenerationError] = useState(""),
    [judgeError, setJudgeError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    async function load(kind: "generation" | "evaluator") {
      const setError =
        kind === "generation" ? setGenerationError : setJudgeError;
      try {
        const response = await api<{ models: Option[] }>(
          `/api/models?${new URLSearchParams({ kind, projectId })}`,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (kind === "generation") setGeneration(response.models);
        else setJudges(response.models);
        if (!response.models.length)
          setError("No supported models are available in this catalog.");
      } catch (error) {
        if (!abort.signal.aborted) setError((error as Error).message);
      }
    }
    void Promise.resolve().then(async () => {
      if (abort.signal.aborted) return;
      setGeneration([]);
      setJudges([]);
      setGenerationError("");
      setJudgeError("");
      setBusy(authorized && !!projectId);
      if (!authorized || !projectId) return;
      await Promise.all([load("generation"), load("evaluator")]);
      if (!abort.signal.aborted) setBusy(false);
    });
    return () => abort.abort();
  }, [authorized, projectId, retry]);
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
  return (
    <section className="panel model-selection" aria-label="Benchmark models">
      <h3>Benchmark models</h3>
      <CmsAccess
        projectId={projectId}
        disabled={disabled}
        onAccessChange={setAuthorized}
      />
      <p className="muted" role="status">
        {busy
          ? "Loading CMS models and OpenRouter evaluators…"
          : !authorized
            ? "Connect to CMS to load generation and evaluation models automatically."
            : "Model catalogs load automatically with CMS access."}
      </p>
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
          disabled={disabled || !judges.length}
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
      <ErrorBox message={generationError} />
      <ErrorBox message={judgeError} />
      {authorized && (generationError || judgeError) && (
        <button
          type="button"
          className="button secondary small"
          disabled={disabled || busy}
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry loading model catalogs
        </button>
      )}
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
