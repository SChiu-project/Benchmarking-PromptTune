"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Layers3, Activity, CheckCircle2, Target } from "lucide-react";
import type { RunSummary } from "@/lib/schema";
import { api, Badge, ErrorBox, date, latency, percent } from "./common";
export function RunsScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const poll = () =>
      api<RunSummary[]>("/api/runs")
        .then((r) => {
          if (live) {
            setRuns(r);
            setLoading(false);
            setError("");
          }
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setLoading(false);
          }
        });
    void poll();
    const t = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const scored = runs.reduce((n, r) => n + r.scoredCount, 0),
    avg = scored
      ? runs.reduce((n, r) => n + (r.averageScore ?? 0) * r.scoredCount, 0) /
        scored
      : null;
  return (
    <>
      <div className="page-heading heading-action">
        <div>
          <div className="eyebrow">YOUR BENCHMARK HISTORY</div>
          <h1>Runs</h1>
          <p>Track execution, answer quality, and evaluation progress.</p>
        </div>
        <Link href="/" className="button primary">
          <Plus size={17} />
          New benchmark
        </Link>
      </div>
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
          { label: "Average fulfillment", value: percent(avg), icon: Target },
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
          <div className="table-wrap">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Run / Created</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>
                    Doc Search<small>success / failed / interrupted</small>
                  </th>
                  <th>
                    Evaluation<small>complete / failed / skipped</small>
                  </th>
                  <th>Avg. latency</th>
                  <th>Avg. fulfillment</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => router.push(`/records?run=${r.id}`)}
                  >
                    <td>
                      <Link
                        className="mono run-link"
                        href={`/records?run=${r.id}`}
                      >
                        {r.id.slice(0, 8)} <span>↗</span>
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
                    </td>
                    <td>
                      <span className="success-text">{r.searchSucceeded}</span>{" "}
                      /{" "}
                      <span className={r.searchFailed ? "error-text" : ""}>
                        {r.searchFailed}
                      </span>{" "}
                      / {r.interrupted}
                    </td>
                    <td>
                      {r.evaluated} /{" "}
                      <span className={r.evaluationFailed ? "error-text" : ""}>
                        {r.evaluationFailed}
                      </span>{" "}
                      / {r.skipped}
                    </td>
                    <td>{latency(r.averageLatency)}</td>
                    <td>
                      <strong className="score">
                        {percent(r.averageScore)}
                      </strong>
                      <small>{r.scoredCount} scored</small>
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
        successful requests only. Average fulfillment includes successfully
        graded records only; unscored answers are excluded. A run stays active
        until both queues finish.
      </p>
    </>
  );
}
