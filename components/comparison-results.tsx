"use client";
import { useEffect, useState } from "react";
import { api, Badge, ErrorBox } from "./common";
import { startPolling } from "../lib/polling";
import type { ComparisonCase } from "../lib/comparison-contract";
import type { RecordData } from "../lib/schema";
import { DIMENSION_LABELS } from "./dimension-editor";
import { DimensionEvidence } from "./dimension-evaluation";
import { EvaluationScore } from "./requirement-evaluation";
type Data = {
  total: number;
  completed: number;
  pages: number;
  status: string;
  models: string[];
  config: { rubricVersion: string; judge: { model: string } };
  cases: (ComparisonCase & { records: RecordData[] })[];
};
export function ComparisonResults({ runId }: { runId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let live = true;
    const stop = startPolling(async (signal) => {
      try {
        const value = await api<Data>(
          `/api/runs/${runId}/comparisons?page=${page}`,
          { signal },
        );
        if (live) {
          setData(value);
          setError("");
        }
        return value.status === "active" ? 2500 : 30000;
      } catch (e) {
        if (live) setError((e as Error).message);
        return false;
      }
    }, 2500);
    return () => {
      live = false;
      stop();
    };
  }, [runId, busy, page]);
  async function retry() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${runId}/comparisons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setData(await api<Data>(`/api/runs/${runId}/comparisons`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Model comparison</h2>
        <button
          type="button"
          className="button secondary small"
          disabled={busy || !data || data.status === "active"}
          onClick={() => void retry()}
        >
          Re-evaluate comparisons
        </button>
      </div>
      <div className="panel-body">
        <ErrorBox message={error} />
        {!data && !error && (
          <p role="status" className="muted">
            Loading comparisons…
          </p>
        )}
        {data && (
          <>
            <p>
              Model A: <strong>{data.models[0]}</strong> · Model B:{" "}
              <strong>{data.models[1]}</strong>
            </p>
            <p className="muted">
              Evaluator: {data.config.judge.model} · Draft rubric ·{" "}
              {data.completed} / {data.total} comparisons finished. Each model
              uses its own retrieved passages.
            </p>
            {data.cases.map((pair) => (
              <details key={pair.id} className="comparison-case">
                <summary>
                  {pair.records[0].question.query} ·{" "}
                  {pair.records[0].question.folder}{" "}
                  <Badge value={pair.status} />
                </summary>
                {pair.reason && <ErrorBox message={pair.reason} />}
                <div className="comparison-answers">
                  {pair.records.map((r, i) => (
                    <div key={r.id}>
                      <h3>
                        Model {i === 0 ? "A" : "B"}: {r.generationModel}
                      </h3>
                      <p className="muted">
                        Generation: {r.execution} · Grading:{" "}
                        {r.evaluationStatus} · Reported model:{" "}
                        {r.result?.reportedModel ?? "unreported"} · Match:{" "}
                        {r.result?.modelVerification ?? "unreported"}
                      </p>
                      {r.result?.answerSource && (
                        <p className="muted">
                          Answer source: {r.result.answerSource}
                        </p>
                      )}
                      <p className="comparison-answer">
                        {r.result?.answer ??
                          r.error ??
                          "Waiting for an answer…"}
                      </p>
                      {r.evaluation && (
                        <EvaluationScore evaluation={r.evaluation} />
                      )}
                      {r.dimensionSuite && (
                        <DimensionEvidence suite={r.dimensionSuite} />
                      )}
                    </div>
                  ))}
                </div>
                {pair.attempts.length > 0 && (
                  <p className="muted">
                    In the judge’s reasons, A refers to{" "}
                    {
                      pair.records[pair.attempts.at(-1)!.swapped ? 1 : 0]
                        .generationModel
                    }
                    ; B refers to{" "}
                    {
                      pair.records[pair.attempts.at(-1)!.swapped ? 0 : 1]
                        .generationModel
                    }
                    . Answer order was randomized.
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Dimension</th>
                        <th scope="col">Comparison result</th>
                        <th scope="col">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pair.rows?.map((r) => (
                        <tr key={r.name}>
                          <td>{DIMENSION_LABELS[r.name]}</td>
                          <td>
                            {r.preferred === "first"
                              ? "A better"
                              : r.preferred === "second"
                                ? "B better"
                                : r.preferred === "tie"
                                  ? "Tie"
                                  : "Unassessable"}
                          </td>
                          <td>{r.reason}</td>
                        </tr>
                      ))}
                      {!pair.rows && (
                        <tr>
                          <td colSpan={3}>
                            {pair.reason ?? `Comparison ${pair.status}`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
            {data.pages > 1 && (
              <div className="pagination">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page} / {data.pages}
                </span>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={page >= data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
