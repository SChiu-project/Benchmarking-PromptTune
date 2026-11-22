"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeading } from "./page-heading";
import { startPolling } from "../lib/polling";
import { useRouter } from "next/navigation";
import { Plus, Layers3, Activity, CheckCircle2, Target } from "lucide-react";
import type { RunSummary } from "@/lib/schema";
import type { DimensionSelectionInput } from "@/lib/dimension-contract";
import { DimensionEditor } from "./dimension-editor";
import { api, Badge, ErrorBox, Modal, date, latency, percent } from "./common";
export function RunsScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [regradeId, setRegradeId] = useState(""),
    [regradeSelection, setRegradeSelection] = useState<
      DimensionSelectionInput | undefined
    >(),
    [regradeBlocked, setRegradeBlocked] = useState(false),
    [regrading, setRegrading] = useState(false);
  useEffect(() => {
    let live = true;
    const stop = startPolling(
      (signal) =>
        api<RunSummary[]>("/api/runs", { signal })
          .then((r) => {
            if (live) {
              setRuns(r);
              setLoading(false);
              setError("");
            }
            return r.some((run) => run.status === "active") ? 1500 : 30000;
          })
          .catch((e) => {
            if (live) {
              setError(e.message);
              setLoading(false);
            }
            return false;
          }),
      1500,
    );
    return () => {
      live = false;
      stop();
    };
  }, []);
  async function submitRegrade() {
    if (!regradeId || regrading) return;
    setRegrading(true);
    try {
      await api(`/api/runs/${regradeId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          regradeSelection ? { dimensions: regradeSelection } : {},
        ),
      });
      router.push(`/records?run=${regradeId}`);
    } catch (e) {
      setError((e as Error).message);
      setRegrading(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR BENCHMARK HISTORY"
        title="Benchmark runs"
        description="Follow execution, measure quality, and find what needs attention."
        action={
          <Link href="/" className="button primary">
            <Plus size={17} /> New benchmark
          </Link>
        }
      />
      <ErrorBox message={error} />
      <div className="metric-grid">
        {[
          { label: "Total runs", value: runs.length, icon: Layers3 },
          {
            label: "Active runs",
            value: runs.filter((r) => r.status === "active").length,
            icon: Activity,
          },
          {
            label: "Successful answers",
            value: runs.reduce((n, r) => n + r.searchSucceeded, 0),
            icon: CheckCircle2,
          },
          {
            label: "Cases needing review",
            value: runs.reduce((n, r) => n + r.review, 0),
            icon: Target,
          },
        ].map((m) => (
          <div className="panel metric" key={m.label}>
            <span>
              {m.label}
              <m.icon size={17} />
            </span>
            <strong>{loading ? "—" : m.value}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>All runs</h2>
          <span className="muted">
            {runs.length} batch{runs.length === 1 ? "" : "es"}
          </span>
        </div>
        {loading ? (
          <div role="status" className="empty-state">
            Loading runs…
          </div>
        ) : !runs.length ? (
          <div className="empty-state">
            <Layers3 size={28} />
            <h3>No runs yet</h3>
            <p>Upload questions to start your first benchmark.</p>
            <Link className="button secondary" href="/">
              Upload questions
            </Link>
          </div>
        ) : (
          <div
            className="table-wrap"
            role="region"
            aria-label="Benchmark runs"
            tabIndex={0}
          >
            <table className="runs-table">
              <thead>
                <tr>
                  <th scope="col">Run / created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Pass rate</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Avg. latency</th>
                  <th scope="col">Evaluation details</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        className="mono run-link"
                        href={`/records?run=${r.id}`}
                      >
                        {r.id.slice(0, 8)} <span aria-hidden="true">↗</span>
                      </Link>
                      <small>{date(r.createdAt)}</small>
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>
                      <strong>
                        {r.completed}
                        <span className="muted"> / {r.total}</span>
                      </strong>
                      <progress
                        max={r.total}
                        value={r.completed}
                        aria-label={`Run ${r.id} execution progress`}
                      />
                      <small>responses</small>
                      {r.searchFailed > 0 && (
                        <small className="error-text">
                          {r.searchFailed} search failures
                        </small>
                      )}
                      {r.interrupted > 0 && (
                        <small className="evaluation-caution">
                          {r.interrupted} interrupted
                        </small>
                      )}
                    </td>
                    <td>
                      <strong className="score">{percent(r.passRate)}</strong>
                      <small>
                        {r.passed} pass · {r.failed} fail
                      </small>
                      <small>
                        {r.review} review · {r.unassessable} unassessable
                      </small>
                      {r.mixedEvaluationVersions && (
                        <small className="evaluation-caution">
                          Mixed policies · rate suppressed
                        </small>
                      )}
                    </td>
                    <td>
                      <strong className="coverage-value">
                        {percent(r.evaluationCoverage)}
                      </strong>
                      <small>Requirement coverage</small>
                      {r.criticalFailures > 0 && (
                        <small className="error-text">
                          {r.criticalFailures} critical failures
                        </small>
                      )}
                      {r.evaluationFailed > 0 && (
                        <small className="error-text">
                          {r.evaluationFailed} evaluation failures
                        </small>
                      )}
                    </td>
                    <td>{latency(r.averageLatency)}</td>
                    <td>
                      <details className="run-breakdown">
                        <summary>
                          View breakdown
                          <span className="sr-only">
                            {" "}
                            for run {r.id.slice(0, 8)}
                          </span>
                        </summary>
                        <dl>
                          <div>
                            <dt>Mean score</dt>
                            <dd>
                              {percent(r.averageScore)} · {r.scoredCount} scored
                              {r.legacyScored
                                ? ` · ${r.legacyScored} legacy`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Doc Search</dt>
                            <dd>
                              {r.searchSucceeded} successful · {r.searchFailed}{" "}
                              failed · {r.interrupted} interrupted
                            </dd>
                          </div>
                          <div>
                            <dt>Evaluation</dt>
                            <dd>
                              {r.evaluated} complete · {r.evaluationFailed}{" "}
                              failed · {r.skipped} skipped
                            </dd>
                          </div>
                          <div>
                            <dt>Critical failures / unassessable</dt>
                            <dd>
                              {r.criticalFailures} / {r.unassessable}
                            </dd>
                          </div>
                          <div>
                            <dt>Operational success</dt>
                            <dd>{percent(r.operationalSuccessRate)}</dd>
                          </div>
                          {r.mixedEvaluationVersions && (
                            <div>
                              <dt>Policy compatibility</dt>
                              <dd>
                                Mixed evaluator versions; mean and pass rate
                                suppressed.
                              </dd>
                            </div>
                          )}
                          {r.dimensions && (
                            <div>
                              <dt>Dimensions</dt>
                              <dd>
                                {r.dimensions.overall.passed} pass ·{" "}
                                {r.dimensions.overall.failed} fail ·{" "}
                                {percent(r.dimensions.overall.passRate)}
                                {r.dimensions.mixed ? " (mixed)" : ""}
                              </dd>
                            </div>
                          )}
                        </dl>
                        <button
                          className="button secondary small"
                          disabled={runs.some((r) => r.status === "active")}
                          onClick={() => {
                            setRegradeSelection(undefined);
                            setRegradeBlocked(false);
                            setRegradeId(r.id);
                          }}
                        >
                          Regrade saved answers
                        </button>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="metrics-note">
        Progress includes terminal Doc Search records. Average latency includes
        successful requests only. Pass rate excludes review and unassessable
        cases; counts and coverage remain visible. Means are suppressed across
        incompatible evaluator policies. Legacy scores are holistic ratings. A
        run stays active until both queues finish.
      </p>
      {regradeId && (
        <Modal
          title="Regrade saved answers"
          subtitle={`Run ${regradeId.slice(0, 8)} · no new Doc Search requests`}
          onClose={() => {
            if (!regrading) setRegradeId("");
          }}
        >
          <div className="modal-body">
            <ErrorBox message={error} />
            <p className="muted">
              By default the run&apos;s frozen evaluation settings are reused.
              Enable dimensions below to grade with a new dimension selection or
              edited prompts; that creates a new campaign and keeps prior
              results.
            </p>
            <DimensionEditor
              disabled={regrading}
              onChange={(selection, blocked) => {
                setRegradeSelection(selection);
                setRegradeBlocked(blocked);
              }}
            />
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={regrading}
              onClick={() => setRegradeId("")}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={regrading || regradeBlocked}
              onClick={() => void submitRegrade()}
            >
              {regrading ? "Queuing…" : "Regrade saved answers"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
