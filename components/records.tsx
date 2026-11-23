"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeading } from "./page-heading";
import { startPolling } from "../lib/polling";
import {
  Search,
  Rows3,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { RecordData, RunSummary } from "@/lib/schema";
import { ComparisonResults } from "./comparison-results";
import { CriteriaEditor } from "./criteria-editor";
import { EvaluationScore, RequirementEvidence } from "./requirement-evaluation";
import {
  DimensionScore,
  DimensionEvidence,
  DimensionSummaryTable,
} from "./dimension-evaluation";
import type { Question } from "@/lib/schema";
import { dimensionNames, weights } from "@/lib/schema";
import {
  api,
  Badge,
  ErrorBox,
  Modal,
  CopyButton,
  date,
  latency,
  percent,
} from "./common";
type ListRecord = Omit<RecordData, "result" | "attempts"> & {
  result?: Omit<
    NonNullable<RecordData["result"]>,
    "rawRequest" | "rawResponse" | "sources"
  > & { sourceCount: number | null };
};
function safeLink(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function RecordsScreen() {
  const params = useSearchParams(),
    router = useRouter(),
    runId = params.get("run") || "";
  const [records, setRecords] = useState<ListRecord[]>([]),
    [runs, setRuns] = useState<RunSummary[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [pages, setPages] = useState(1),
    [folders, setFolders] = useState<string[]>([]),
    [folder, setFolder] = useState(""),
    [execution, setExecution] = useState(""),
    [evaluation, setEvaluation] = useState(""),
    [decision, setDecision] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [detailId, setDetailId] = useState(""),
    [detail, setDetail] = useState<RecordData | null>(null),
    [detailError, setDetailError] = useState(""),
    [retrying, setRetrying] = useState(false),
    [regradeQuestions, setRegradeQuestions] = useState<
      Question[] | undefined
    >(),
    [criteriaBlocked, setCriteriaBlocked] = useState(false);
  useEffect(() => {
    let live = true;
    const stop = startPolling(async (signal) => {
      try {
        const [rs, rr] = await Promise.allSettled([
          api<{
            records: ListRecord[];
            total: number;
            pages: number;
            folders: string[];
          }>(
            `/api/records?${new URLSearchParams({ run: runId, folder, execution, evaluation, decision, q: query, page: String(page) })}`,
            { signal },
          ),
          api<RunSummary[]>("/api/runs", { signal }),
        ]);
        if (rs.status === "rejected") throw rs.reason;
        if (rr.status === "rejected") throw rr.reason;
        if (live) {
          setRecords(rs.value.records);
          setTotal(rs.value.total);
          setPages(rs.value.pages);
          setFolders(rs.value.folders);
          setRuns(rr.value);
          setLoading(false);
          setError("");
        }
        return rr.value.some((run) => run.status === "active") ? 1500 : 30000;
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setLoading(false);
        }
        return false;
      }
    }, 1500);
    return () => {
      live = false;
      stop();
    };
  }, [runId, folder, execution, evaluation, decision, query, page]);
  useEffect(() => {
    if (!detailId) return;
    let live = true;
    const stop = startPolling(
      (signal) =>
        api<RecordData>(`/api/records/${detailId}`, { signal })
          .then((r) => {
            if (live) {
              setDetail(r);
            }
            return ["queued", "running"].includes(r.execution) ||
              ["pending", "running"].includes(r.evaluationStatus)
              ? 1500
              : 30000;
          })
          .catch((e) => {
            if (live) setDetailError(e.message);
            return false;
          }),
      1500,
    );
    return () => {
      live = false;
      stop();
    };
  }, [detailId, retrying]);
  async function retry() {
    if (!detail || retrying) return;
    setRetrying(true);
    setDetailError("");
    try {
      await api(`/api/records/${detail.id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: regradeQuestions?.[0].criteria }),
      });
      setDetail(await api<RecordData>(`/api/records/${detail.id}`));
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }
  const filtered = records;
  const run = runs.find((r) => r.id === runId);
  function open(id: string) {
    setRegradeQuestions(undefined);
    setCriteriaBlocked(false);
    setDetail(null);
    setDetailError("");
    setDetailId(id);
  }
  return (
    <>
      <PageHeading
        eyebrow="EVERY ANSWER, IN CONTEXT"
        title="Answer records"
        description="Inspect responses, trace their sources, and see what’s missing."
        action={
          <Link className="button secondary" href="/runs">
            <ArrowLeft size={16} /> All runs
          </Link>
        }
      />
      <ErrorBox message={error} />
      {run?.dispatchError && (
        <div className="alert warning">
          {run.dispatchError}{" "}
          <button
            className="button secondary small"
            onClick={() =>
              void api(`/api/runs/${run.id}/dispatch`, {
                method: "POST",
              }).catch((e) => setError(e.message))
            }
          >
            Retry queue dispatch
          </button>
        </div>
      )}
      {run && (
        <div className="run-banner">
          <div>
            <span className="mono">Run {run.id.slice(0, 8)}</span>
            <Badge value={run.status} />
            <span>Project: {run.projectId}</span>
            {run.promptSource && (
              <span
                title={`${run.promptSource.environment} · ${run.promptSource.fingerprint}`}
              >
                CMS: {run.promptSource.folder} ·{" "}
                {run.promptSource.isBase
                  ? "Base configuration"
                  : `v${run.promptSource.version}`}
                {run.promptSource.staleAcknowledged
                  ? " · stale baseline acknowledged"
                  : ""}
              </span>
            )}
            {run.promptSections.length > 0 && (
              <span>Prompt test: {run.promptSections.join(", ")}</span>
            )}
            <span>
              {run.completed} / {run.total} responses
            </span>
            {run.workflowRunId && run.status === "active" && (
              <button
                className="button secondary small"
                onClick={() =>
                  void api(`/api/runs/${run.id}/recover`, {
                    method: "POST",
                  }).catch((e) => setError(e.message))
                }
              >
                Recover stopped workflow
              </button>
            )}
            <span>
              Evaluation {run.evaluated} graded · {run.evaluationFailed} failed
              · {run.skipped} skipped
            </span>
            <span>
              {run.passed} pass · {run.failed} fail · {run.review} review ·{" "}
              {run.criticalFailures} critical failures
            </span>
            <span>
              Coverage {percent(run.evaluationCoverage)} · Pass rate{" "}
              {percent(run.passRate)}
            </span>
          </div>
          <progress
            max={run.total}
            value={run.completed}
            aria-label="Run execution progress"
          />
        </div>
      )}
      {run && (
        <div className="export-actions">
          <a
            className="button secondary small"
            aria-disabled={run.status === "active"}
            href={
              run.status === "active" ? undefined : `/api/runs/${run.id}/export`
            }
          >
            Export results CSV
          </a>
          <a
            className="button secondary small"
            aria-disabled={run.status === "active"}
            href={
              run.status === "active"
                ? undefined
                : `/api/runs/${run.id}/export?kind=summary`
            }
          >
            Export summary CSV
          </a>
        </div>
      )}
      {run?.comparisonProgress && (
        <ComparisonResults key={run.id} runId={run.id} />
      )}
      {run?.dimensions && (
        <section className="panel">
          <div className="panel-title">
            <h2>Dimension results</h2>
            <span className="muted">
              Draft rubric · {run.dimensionEvaluated} judged
            </span>
          </div>
          <DimensionSummaryTable summary={run.dimensions} />
        </section>
      )}
      <div className="panel">
        <div className="records-toolbar">
          <div className="search-control">
            <Search size={17} />
            <input
              aria-label="Search queries"
              placeholder="Search questions…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label>
            <span className="sr-only">Filter by run</span>
            <select
              aria-label="Filter by run"
              value={runId}
              onChange={(e) => {
                setFolder("");
                setPage(1);
                router.push(
                  e.target.value
                    ? `/records?run=${e.target.value}`
                    : "/records",
                );
              }}
            >
              <option value="">All runs</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 8)} · {date(r.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Filter by folder"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select
            aria-label="Filter by execution status"
            value={execution}
            onChange={(e) => {
              setExecution(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All executions</option>
            {["queued", "running", "succeeded", "failed", "interrupted"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Filter by evaluation status"
            value={evaluation}
            onChange={(e) => {
              setEvaluation(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All evaluations</option>
            {["pending", "running", "succeeded", "failed", "skipped"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>
        <label>
          Decision{" "}
          <select
            aria-label="Filter by decision"
            value={decision}
            onChange={(e) => {
              setDecision(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All decisions</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="review">Review</option>
          </select>
        </label>
        <div className="record-count">
          {total} matching record{total === 1 ? "" : "s"}
          <span>Updates automatically</span>
        </div>
        {loading ? (
          <div className="empty-state" role="status">
            Loading records…
          </div>
        ) : !filtered.length ? (
          <div className="empty-state">
            <Rows3 size={28} />
            <h3>{records.length ? "No matching records" : "No records yet"}</h3>
            <p>
              {records.length
                ? "Try a different filter or search."
                : "Upload a CSV and start a batch to inspect responses."}
            </p>
            {!records.length && (
              <Link className="button secondary" href="/">
                Upload questions
              </Link>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Question / Folder</th>
                  <th>Answer</th>
                  <th>
                    Sources<small>passages</small>
                  </th>
                  <th>Latency</th>
                  <th>Trace ID</th>
                  <th>Doc Search</th>
                  <th>Evaluation</th>
                  <th>Fulfillment</th>
                  <th>Why this score</th>
                  <th aria-label="Details" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => open(r.id)}
                    className="clickable"
                  >
                    <td>
                      <button
                        className="query-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(r.id);
                        }}
                      >
                        {r.question.query}
                      </button>
                      <small className="folder-label">
                        {r.question.folder}
                      </small>
                      {r.generationModel && (
                        <small className="folder-label">
                          {r.generationModel}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="answer-preview">
                        {r.result?.answer ||
                          r.error ||
                          "Waiting for a response…"}
                      </span>
                    </td>
                    <td>{r.result?.sourceCount ?? "—"}</td>
                    <td>{latency(r.result?.latencyMs)}</td>
                    <td>
                      <span className="trace-cell">
                        <code>
                          {r.result?.traceId
                            ? `${r.result.traceId.slice(0, 8)}…`
                            : "—"}
                        </code>
                        {r.result?.traceId && (
                          <CopyButton text={r.result.traceId} />
                        )}
                      </span>
                    </td>
                    <td>
                      <Badge value={r.execution} />
                    </td>
                    <td>
                      <Badge value={r.evaluationStatus} />
                    </td>
                    <td>
                      <strong className="score">
                        {r.evaluationStatus === "succeeded" ? (
                          <>
                            {r.evaluation && (
                              <EvaluationScore evaluation={r.evaluation} />
                            )}
                            {r.dimensionSuite && (
                              <DimensionScore suite={r.dimensionSuite} />
                            )}
                            {!r.evaluation && !r.dimensionSuite && "—"}
                          </>
                        ) : (
                          "—"
                        )}
                      </strong>
                    </td>
                    <td className="score-explanation">
                      {r.evaluationStatus === "succeeded" &&
                      (r.evaluation || r.dimensionSuite) ? (
                        <>
                          {r.evaluation && (
                            <>
                              <p>{r.evaluation.assessment}</p>
                              <details onClick={(e) => e.stopPropagation()}>
                                <summary>Score breakdown</summary>
                                <RequirementEvidence
                                  evaluation={r.evaluation}
                                />
                                {!r.evaluation.requirements && (
                                  <dl>
                                    {dimensionNames.map((dimension) => {
                                      const criterion =
                                        r.evaluation!.dimensions[dimension];
                                      const weight =
                                        r.evaluation!.applicableWeights[
                                          dimension
                                        ];
                                      return (
                                        <div key={dimension}>
                                          <dt>
                                            <span>{dimension}</span>
                                            {criterion.score === null
                                              ? " · Unassessable"
                                              : ` · ${criterion.score}/100 · ${Math.round(weight * 10) / 10}% weight`}
                                          </dt>
                                          <dd>{criterion.explanation}</dd>
                                        </div>
                                      );
                                    })}
                                  </dl>
                                )}
                                {r.evaluation.limitations.length > 0 && (
                                  <p className="score-limitations">
                                    <strong>Limitations: </strong>
                                    {r.evaluation.limitations.join("; ")}
                                  </p>
                                )}
                              </details>
                            </>
                          )}
                          {r.dimensionSuite && (
                            <details onClick={(e) => e.stopPropagation()}>
                              <summary>
                                Dimension results (
                                {r.dimensionSuite.counts.passed}/
                                {r.dimensionSuite.rows.length} pass)
                              </summary>
                              <DimensionEvidence suite={r.dimensionSuite} />
                            </details>
                          )}
                        </>
                      ) : (
                        <p className="muted">
                          {r.evaluationReason ||
                            (r.evaluationStatus === "running"
                              ? "Evaluation in progress."
                              : r.evaluationStatus === "pending"
                                ? "Awaiting evaluation."
                                : "No scored evaluation available.")}
                        </p>
                      )}
                    </td>
                    <td>
                      <ChevronRight size={15} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pages > 1 && (
        <div className="pagination">
          <button
            className="button secondary small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {Math.min(page, pages)} of {pages}
          </span>
          <button
            className="button secondary small"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      <p className="metrics-note">
        Source counts represent retrieved passages in the API’s used_sections
        field. Unknown counts and unscored records display “—”. Scores measure
        rubric fulfillment, not probability.
      </p>
      {detailId && (
        <Modal
          title="Record details"
          subtitle={detailId}
          onClose={() => setDetailId("")}
        >
          <div className="modal-body record-detail">
            <ErrorBox message={detailError} />
            {!detail ? (
              <p role="status">Loading record…</p>
            ) : (
              <>
                <div className="result-meta">
                  <Badge value={detail.execution} />
                  <Badge value={detail.evaluationStatus} />
                  <span>{latency(detail.result?.latencyMs)}</span>
                  <span>
                    {detail.result?.sources == null
                      ? "Unknown sources"
                      : `${detail.result.sources.length} retrieved passages`}
                  </span>
                </div>
                <section>
                  <div className="detail-label">
                    QUESTION <span>{detail.question.folder}</span>
                  </div>
                  <h3 className="preserve full-query">
                    {detail.question.query}
                  </h3>
                </section>
                <section className="answer-block">
                  <div className="detail-label">DOC SEARCH ANSWER</div>
                  <p className="preserve">
                    {detail.result?.answer || "No answer available."}
                  </p>
                </section>
                <div className="criteria-grid">
                  <section>
                    <div className="detail-label">EXPECTED ANSWER</div>
                    <p className="preserve">
                      {detail.question.expected_answer || "Not supplied."}
                    </p>
                  </section>
                  <section>
                    <div className="detail-label">EVALUATION COMMENTS</div>
                    <p className="preserve">
                      {detail.question.evaluation_comments || "Not supplied."}
                    </p>
                  </section>
                </div>
                <section>
                  <div className="section-title-row">
                    <h3>Evaluation</h3>
                    <button
                      className="button secondary small"
                      disabled={
                        retrying ||
                        criteriaBlocked ||
                        (!regradeQuestions?.[0].criteria &&
                          !detail.question.criteria &&
                          !detail.dimensionSuite) ||
                        detail.execution !== "succeeded" ||
                        ["pending", "running"].includes(detail.evaluationStatus)
                      }
                      onClick={() => void retry()}
                    >
                      <RefreshCw size={14} />
                      {retrying ? "Queuing…" : "Retry evaluation"}
                    </button>
                  </div>
                  <CriteriaEditor
                    key={detail.id}
                    questions={[detail.question]}
                    projectId={
                      runs.find((r) => r.id === detail.runId)?.projectId ?? ""
                    }
                    disabled={
                      retrying ||
                      ["pending", "running"].includes(detail.evaluationStatus)
                    }
                    onChange={(questions, blocked) => {
                      setRegradeQuestions(questions);
                      setCriteriaBlocked(blocked);
                    }}
                  />
                  <p className="muted">
                    Regrading creates a new campaign against this saved answer
                    and keeps prior results.
                  </p>
                  {detail.evaluationReason && (
                    <div
                      className={`alert ${detail.evaluationStatus === "failed" ? "error" : "info"}`}
                    >
                      {detail.evaluationReason}
                    </div>
                  )}
                  {detail.evaluation && (
                    <>
                      <div className="evaluation-heading">
                        <strong>
                          <EvaluationScore evaluation={detail.evaluation} />
                        </strong>
                        <p>{detail.evaluation.assessment}</p>
                      </div>
                      <RequirementEvidence evaluation={detail.evaluation} />
                      {!detail.evaluation.requirements && (
                        <div className="dimension-grid">
                          {dimensionNames.map((k) => (
                            <div key={k}>
                              <span>
                                {k}
                                <small>
                                  Base weight {weights[k]}% · Applied{" "}
                                  {Math.round(
                                    detail.evaluation!.applicableWeights[k] *
                                      10,
                                  ) / 10}
                                  %
                                </small>
                              </span>
                              <strong>
                                {detail.evaluation!.dimensions[k].score === null
                                  ? "Unassessable"
                                  : `${detail.evaluation!.dimensions[k].score} / 100`}
                              </strong>
                              <p>
                                {detail.evaluation!.dimensions[k].explanation}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      {(
                        [
                          { key: "fulfilled", label: "Requirements fulfilled" },
                          { key: "missing", label: "Missing requirements" },
                          { key: "contradictions", label: "Contradictions" },
                          {
                            key: "unsupported_claims",
                            label: "Unsupported claims",
                          },
                          {
                            key: "improvements",
                            label: "Suggested improvements",
                          },
                          { key: "limitations", label: "Grading limitations" },
                        ] as const
                      ).map((s) => (
                        <div key={s.key} className="evaluation-list">
                          <h4>{s.label}</h4>
                          {detail.evaluation![s.key].length ? (
                            <ul>
                              {detail.evaluation![s.key].map((x, i) => (
                                <li key={i}>{x}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">None reported.</p>
                          )}
                        </div>
                      ))}
                      {detail.evaluation.discrepancies.length > 0 && (
                        <div className="evaluation-list">
                          <h4>Evidence-based discrepancies</h4>
                          {detail.evaluation.discrepancies.map((d, i) => (
                            <div key={i} className="discrepancy">
                              <strong>{d.requirement}</strong>
                              <p>Response evidence: {d.response_evidence}</p>
                              <p>{d.difference}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {detail.dimensionSuite && (
                    <DimensionEvidence suite={detail.dimensionSuite} />
                  )}
                  {detail.attempts.length > 0 && (
                    <details>
                      <summary>
                        Evaluation attempt history ({detail.attempts.length})
                      </summary>
                      {detail.attempts.map((a) => (
                        <div key={a.id} className="attempt">
                          <Badge value={a.status} />
                          <strong>{a.model}</strong>
                          <small>
                            {a.rubricVersion} · {date(a.startedAt)}
                          </small>
                          {a.finishedAt && (
                            <small>Finished {date(a.finishedAt)}</small>
                          )}
                          {a.campaign && (
                            <details>
                              <summary>Campaign {a.campaign.id}</summary>
                              <pre>
                                {JSON.stringify(
                                  {
                                    campaign: a.campaign,
                                    evidenceHash: a.evidenceHash,
                                    question: a.questionSnapshot,
                                    providerModel: a.providerModel,
                                  },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          )}
                          {a.error && <p className="error-text">{a.error}</p>}
                          {a.result && (
                            <details>
                              <summary>
                                Saved attempt result ·{" "}
                                <EvaluationScore evaluation={a.result} />
                              </summary>
                              <pre>{JSON.stringify(a.result, null, 2)}</pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </details>
                  )}
                </section>
                <section>
                  <h3>Sources & metadata</h3>
                  {detail.result?.sources == null ? (
                    <p className="muted">
                      Sources unavailable or unrecognized.
                    </p>
                  ) : !detail.result.sources.length ? (
                    <p className="muted">
                      API returned an empty used_sections list.
                    </p>
                  ) : (
                    detail.result.sources.map((s, i) => (
                      <details key={i} className="source-item">
                        <summary>
                          {i + 1}. {s.title}
                        </summary>
                        {safeLink(s.url) && (
                          <a
                            className="source-link"
                            href={safeLink(s.url)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open source <ExternalLink size={12} />
                          </a>
                        )}
                        <p className="preserve">
                          {s.content || "No passage content supplied."}
                        </p>
                        <details>
                          <summary>Metadata</summary>
                          <pre>{JSON.stringify(s.metadata, null, 2)}</pre>
                        </details>
                      </details>
                    ))
                  )}
                </section>
                <section>
                  <h3>Trace & timing</h3>
                  <div className="trace-line">
                    <code>
                      {detail.result?.traceId || "Trace ID unavailable"}
                    </code>
                    {detail.result?.traceId && (
                      <CopyButton text={detail.result.traceId} />
                    )}
                  </div>
                  {detail.result?.promptVersion && (
                    <p>
                      Reported prompt version:{" "}
                      <code>{JSON.stringify(detail.result.promptVersion)}</code>
                    </p>
                  )}
                  <dl className="timing-grid">
                    <div>
                      <dt>Created</dt>
                      <dd>{date(detail.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{detail.startedAt ? date(detail.startedAt) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>
                        {detail.finishedAt ? date(detail.finishedAt) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Doc Search latency</dt>
                      <dd>{latency(detail.result?.latencyMs)}</dd>
                    </div>
                  </dl>
                </section>
                {detail.error && <ErrorBox message={detail.error} />}
                <details>
                  <summary>Raw request JSON</summary>
                  <pre>
                    {JSON.stringify(
                      detail.result?.rawRequest ??
                        detail.failureDetails?.rawRequest ??
                        null,
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <details>
                  <summary>Raw response JSON</summary>
                  <pre>
                    {JSON.stringify(
                      detail.result?.rawResponse ??
                        detail.failureDetails?.rawResponse ??
                        null,
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </>
            )}
          </div>
          <div className="modal-footer">
            <span className="muted">
              Answers and grading are saved in this workspace.
            </span>
            <button
              className="button secondary"
              onClick={() => setDetailId("")}
            >
              Close details
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
