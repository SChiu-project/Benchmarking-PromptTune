"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startPolling } from "../lib/polling";
import {
  UploadCloud,
  Download,
  ArrowRight,
  FileSpreadsheet,
  CheckCircle2,
  ArrowUpFromLine,
  Play,
  ShieldCheck,
  Clock3,
  Layers3,
  ChevronRight,
  Info,
} from "lucide-react";
import type { CsvReview } from "@/lib/csv";
import type {
  RunSummary,
  RecordData,
  PromptOverrides,
  Question,
} from "@/lib/schema";
import { CriteriaEditor } from "./criteria-editor";
import type { PromptSelection } from "@/lib/prompt-schema";
import { PromptEditor } from "./prompt-editor";
import { DimensionEditor } from "./dimension-editor";
import type { DimensionSelectionInput } from "@/lib/dimension-contract";
import {
  api,
  ErrorBox,
  Modal,
  Badge,
  CopyButton,
  latency,
  date,
} from "./common";
export function UploadScreen({ hosted = false }: { hosted?: boolean }) {
  const maxMb = hosted ? 1 : 5;
  const router = useRouter(),
    input = useRef<HTMLInputElement>(null),
    submitting = useRef(false),
    submissionKey = useRef(""),
    projectInitialized = useRef(false);
  const [review, setReview] = useState<CsvReview | null>(null),
    [fileName, setFileName] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [concurrency, setConcurrency] = useState(3),
    [resolved, setResolved] = useState(false),
    [starting, setStarting] = useState(false),
    [drag, setDrag] = useState(false),
    [recent, setRecent] = useState<RunSummary[]>([]),
    [activeRun, setActiveRun] = useState<RunSummary | null>(null),
    [configured, setConfigured] = useState<boolean | null>(null),
    [projectId, setProjectId] = useState(""),
    [promptOverrides, setPromptOverrides] = useState<
      PromptOverrides | undefined
    >(),
    [promptSelection, setPromptSelection] = useState<
      PromptSelection | undefined
    >(),
    [promptBlocked, setPromptBlocked] = useState(false),
    [criteriaQuestions, setCriteriaQuestions] = useState<
      Question[] | undefined
    >(),
    [criteriaBlocked, setCriteriaBlocked] = useState(false),
    [dimensionSelection, setDimensionSelection] = useState<
      DimensionSelectionInput | undefined
    >(),
    [dimensionBlocked, setDimensionBlocked] = useState(false),
    [dimensionEditorKey, setDimensionEditorKey] = useState(0),
    [promptEditorKey, setPromptEditorKey] = useState(0),
    [testId, setTestId] = useState(""),
    [testing, setTesting] = useState(false),
    [test, setTest] = useState<RecordData | null>(null),
    [testError, setTestError] = useState("");
  useEffect(() => {
    let live = true;
    const stop = startPolling(async (signal) => {
      try {
        const [status, runs] = await Promise.allSettled([
          api<{
            evaluatorConfigured: boolean;
            activeRun: RunSummary | null;
            defaultProjectId: string;
          }>("/api/status", { signal }),
          api<RunSummary[]>("/api/runs", { signal }),
        ]);
        if (status.status === "rejected") throw status.reason;
        if (runs.status === "rejected") throw runs.reason;
        if (live) {
          setConfigured(status.value.evaluatorConfigured);
          if (!projectInitialized.current) {
            setProjectId(status.value.defaultProjectId);
            projectInitialized.current = true;
          }
          setActiveRun(status.value.activeRun);
          setRecent(runs.value.slice(0, 3));
        }
        return status.value.activeRun ? 2500 : 30000;
      } catch (error) {
        if (live) setError((error as Error).message);
        return false;
      }
    }, 2500);
    return () => {
      live = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (!testId) return;
    let live = true;
    const stop = startPolling(async (signal) => {
      try {
        const value = await api<{ summary: RunSummary; records: RecordData[] }>(
          `/api/runs/${testId}`,
          { signal },
        );
        if (!live) return;
        const r = value.records[0];
        setTest(r);
        if (value.summary.dispatchError) {
          setTestError(value.summary.dispatchError);
          setTesting(false);
        }
        if (value.summary.status !== "active") {
          setTesting(false);
          setTestId("");
        }
      } catch (e) {
        if (live) {
          setTestError((e as Error).message);
          setTesting(false);
          setTestId("");
        }
      }
    }, 1000);
    return () => {
      live = false;
      stop();
    };
  }, [testId]);
  async function upload(file: File) {
    setError("");
    if (file.size > maxMb * 1024 * 1024) {
      setError(`Choose a CSV smaller than ${maxMb} MB.`);
      return;
    }
    setLoading(true);
    try {
      const value = await api<CsvReview>("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "text/csv;charset=utf-8" },
        body: await file.text(),
      });
      submissionKey.current = crypto.randomUUID();
      setReview(value);
      setFileName(file.name);
      setResolved(false);
      setTest(null);
      setTestError("");
      setConcurrency(3);
      setCriteriaQuestions(undefined);
      setCriteriaBlocked(false);
      setPromptOverrides(undefined);
      setPromptSelection(undefined);
      setPromptBlocked(false);
      setPromptEditorKey((value) => value + 1);
      setDimensionSelection(undefined);
      setDimensionBlocked(false);
      setDimensionEditorKey((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function testFirst() {
    if (!review?.questions.length || testing) return;
    setTesting(true);
    setTest(null);
    setTestError("");
    try {
      const r = await api<{ id: string }>("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: review.questions[0],
          projectId: projectId.trim(),
          promptOverrides,
          promptSelection,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setTestId(r.id);
    } catch (e) {
      setTestError((e as Error).message);
      setTesting(false);
    }
  }
  async function start() {
    if (!review || submitting.current) return;
    submitting.current = true;
    setStarting(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: criteriaQuestions ?? review.questions,
          concurrency,
          projectId: projectId.trim(),
          promptOverrides,
          promptSelection,
          dimensions: dimensionSelection,
          idempotencyKey: submissionKey.current,
        }),
      });
      router.push(`/records?run=${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
      submitting.current = false;
    }
  }
  const blocked =
    !review?.questions.length ||
    promptBlocked ||
    criteriaBlocked ||
    dimensionBlocked ||
    !projectId.trim() ||
    projectId.trim().length > 500 ||
    Boolean(review.errors.length) ||
    Boolean(review.conflicts.length && !resolved);
  const activeNotice = activeRun && (
    <div className="alert info">
      {activeRun.kind === "test" ? "A connectivity test" : "A benchmark run"} is
      active.{" "}
      {activeRun.dispatchError || "It continues independently of this page."}{" "}
      {activeRun.kind === "batch" && (
        <Link href={`/records?run=${activeRun.id}`}>View run</Link>
      )}{" "}
      {hosted && !activeRun.workflowRunId && (
        <button
          className="button secondary small"
          onClick={() =>
            void api(`/api/runs/${activeRun.id}/dispatch`, {
              method: "POST",
            }).catch((e) => setError(e.message))
          }
        >
          Retry queue dispatch
        </button>
      )}{" "}
      {activeRun.workflowRunId && (
        <button
          className="button secondary small"
          onClick={() =>
            void api(`/api/runs/${activeRun.id}/recover`, {
              method: "POST",
            }).catch((e) => setError(e.message))
          }
        >
          Recover stopped {activeRun.kind === "test" ? "test" : "run"}
        </button>
      )}
    </div>
  );
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">BUILD CONFIDENCE IN EVERY ANSWER</div>
        <h1>Benchmark your Doc Search</h1>
        <p>Turn your test questions into a clear picture of answer quality.</p>
      </div>
      <ErrorBox message={!review ? error : ""} />
      {!review && activeNotice}
      <div className="upload-grid">
        <section className="panel upload-panel">
          <div className="section-heading">
            <span className="step-number">1</span>
            <div>
              <h2>Upload your questions</h2>
              <p>Start with a CSV. We’ll help you review it before running.</p>
            </div>
          </div>
          <div
            className={`dropzone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void upload(f);
            }}
          >
            <span className="upload-icon">
              <UploadCloud size={29} strokeWidth={1.6} />
            </span>
            <h3>
              {loading ? "Reading your questions…" : "Drop your CSV here"}
            </h3>
            <p>or choose a file from your computer</p>
            <input
              ref={input}
              id="csv-file"
              aria-label="CSV file"
              tabIndex={-1}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <button
              className="button primary"
              disabled={loading}
              onClick={() => input.current?.click()}
            >
              <ArrowUpFromLine size={16} />
              {loading ? "Reading CSV…" : "Choose CSV file"}
            </button>
            <span className="file-limit">
              CSV format · Up to {maxMb} MB · 1,000 rows
            </span>
          </div>
          <div className="example-row">
            <div>
              <FileSpreadsheet size={20} />
              <span>
                <strong>Need a starting point?</strong>
                <small>Use our template with example questions.</small>
              </span>
            </div>
            <a className="text-button" href="/example.csv" download>
              <Download size={15} /> Example CSV
            </a>
          </div>
        </section>
        <aside className="panel format-panel">
          <div className="card-kicker">QUICK REFERENCE</div>
          <h2>A simple CSV. A powerful benchmark.</h2>
          <p className="muted">
            One question per row. Add a reference to measure fulfillment.
          </p>
          <div className="column-list">
            {[
              {
                name: "query",
                description: "The question to ask Doc Search.",
                required: true,
              },
              {
                name: "folder",
                description: "Defaults to Codex_Benchmark_tool.",
              },
              {
                name: "expected_answer",
                description: "Your reference answer for evaluation.",
              },
              {
                name: "evaluation_comments",
                description: "Specific requirements or grading guidance.",
              },
            ].map((c) => (
              <div className="column-item" key={c.name}>
                <div>
                  <code>{c.name}</code>
                  <span className={c.required ? "required" : "optional"}>
                    {c.required ? "Required" : "Optional"}
                  </span>
                </div>
                <p>{c.description}</p>
              </div>
            ))}
          </div>
          <div className="quiet-note">
            <Info size={15} />
            <span>
              Quoted commas, multiline answers, and UTF-8 are supported.
            </span>
          </div>
        </aside>
      </div>
      <section className="workflow-strip">
        {[
          {
            icon: FileSpreadsheet,
            n: "01",
            title: "Upload & review",
            text: "Validate questions and remove duplicates.",
          },
          {
            icon: Play,
            n: "02",
            title: "Run your benchmark",
            text: "Test connectivity, then run your batch.",
          },
          {
            icon: CheckCircle2,
            n: "03",
            title: "Inspect & improve",
            text: "Explore answers, sources, and fulfillment.",
          },
        ].map((s) => (
          <div key={s.n}>
            <span className="workflow-icon">
              <s.icon size={19} />
            </span>
            <span>
              <small>{s.n}</small>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </span>
          </div>
        ))}
      </section>
      <section className="recent-section">
        <div className="section-title-row">
          <h2>Recent runs</h2>
          <Link href="/runs">
            View all runs <ArrowRight size={15} />
          </Link>
        </div>
        {recent.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Questions</th>
                  <th>Progress</th>
                  <th>Created</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/records?run=${r.id}`}
                        className="mono run-link"
                      >
                        {r.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>{r.total}</td>
                    <td>
                      {r.completed} / {r.total}
                    </td>
                    <td>{date(r.createdAt)}</td>
                    <td>
                      <Link
                        aria-label={`Open run ${r.id}`}
                        href={`/records?run=${r.id}`}
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel recent-empty">
            <span className="empty-icon">
              <Layers3 size={24} />
            </span>
            <h3>Your first benchmark starts here</h3>
            <p>Upload a CSV to see your runs and results in one place.</p>
          </div>
        )}
      </section>
      <div className="upload-footnotes">
        <span>
          <ShieldCheck size={15} />{" "}
          {hosted
            ? "Saved in your hosted workspace"
            : "Saved locally on your computer"}
        </span>
        <span>
          <Clock3 size={15} /> Batches continue when you leave the page
        </span>
        <span className={configured ? "connected" : ""}>
          <i />
          {configured === null
            ? "Checking evaluator…"
            : configured
              ? "Evaluator configured"
              : "LLM evaluator not configured · deterministic checks available"}
        </span>
      </div>
      {review && (
        <Modal
          title="Review your questions"
          subtitle={fileName}
          onClose={() => {
            if (!starting) setReview(null);
          }}
        >
          <div className="modal-body">
            <ErrorBox message={error} />
            {activeNotice}
            <div className="review-stats">
              {[
                ["Input rows", review.total],
                ["Empty skipped", review.empty],
                ["Duplicates removed", review.duplicates],
                ["Ready to run", review.questions.length],
              ].map(([label, n]) => (
                <div key={label}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {review.errors.map((e) => (
              <ErrorBox key={e} message={e} />
            ))}
            {review.conflicts.length > 0 && (
              <div className="alert warning">
                <strong>
                  {review.conflicts.length} conflicting duplicate
                  {review.conflicts.length === 1 ? "" : "s"}
                </strong>
                <ul>
                  {review.conflicts.map((c) => (
                    <li key={c.row}>
                      Data row {c.row} conflicts with row {c.firstRow}: “
                      {c.query}” in {c.folder}.
                    </li>
                  ))}
                </ul>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={resolved}
                    onChange={(e) => setResolved(e.target.checked)}
                  />
                  Resolve all conflicts by keeping the first occurrence and its
                  reference/comments.
                </label>
                <small>
                  To keep different criteria, close this dialog, edit the CSV,
                  and upload it again.
                </small>
              </div>
            )}
            <div className="project-setting">
              <label htmlFor="project-id">Doc Search project ID</label>
              <input
                id="project-id"
                value={projectId}
                maxLength={500}
                disabled={testing || starting}
                onChange={(event) => {
                  projectInitialized.current = true;
                  setProjectId(event.target.value);
                  setCriteriaQuestions(undefined);
                  setCriteriaBlocked(false);
                  setPromptOverrides(undefined);
                  setPromptSelection(undefined);
                  setPromptBlocked(false);
                  setPromptEditorKey((value) => value + 1);
                  setDimensionSelection(undefined);
                  setDimensionBlocked(false);
                  setDimensionEditorKey((value) => value + 1);
                  submissionKey.current = crypto.randomUUID();
                  setTest(null);
                  setTestId("");
                  setTestError("");
                }}
                aria-describedby="project-id-help"
              />
              <p id="project-id-help">
                Used for the connectivity test and every question in this batch.
                Required.
              </p>
            </div>
            <PromptEditor
              key={promptEditorKey}
              projectId={projectId.trim()}
              folder={
                Object.keys(review.folders).length === 1
                  ? Object.keys(review.folders)[0]
                  : null
              }
              disabled={testing || starting}
              onChange={(overrides, invalid, selection) => {
                setPromptOverrides(overrides);
                setPromptSelection(selection);
                setPromptBlocked(invalid);
                submissionKey.current = crypto.randomUUID();
                setTest(null);
                setTestId("");
                setTestError("");
              }}
            />
            <p className="muted">
              Try the synthetic{" "}
              <a href="/requirements-example.csv" download>
                requirements CSV
              </a>{" "}
              and{" "}
              <a href="/requirements-example.json" download>
                draft criteria JSON
              </a>
              . Update the criteria project ID to match this run.
            </p>
            <CriteriaEditor
              key={`criteria-${promptEditorKey}`}
              questions={review.questions}
              projectId={projectId.trim()}
              disabled={testing || starting}
              onChange={(questions, invalid) => {
                setCriteriaQuestions(questions);
                setCriteriaBlocked(invalid);
                submissionKey.current = crypto.randomUUID();
              }}
            />
            <DimensionEditor
              key={`dimensions-${dimensionEditorKey}`}
              disabled={testing || starting}
              evaluatorConfigured={configured}
              onChange={(selection, invalid) => {
                setDimensionSelection(selection);
                setDimensionBlocked(invalid);
                submissionKey.current = crypto.randomUUID();
                setTest(null);
                setTestId("");
                setTestError("");
              }}
            />
            <div className="folder-tags">
              {Object.entries(review.folders).map(([folder, n]) => (
                <span key={folder}>
                  {folder}
                  <b>{n}</b>
                </span>
              ))}
            </div>
            <div className="review-preview table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Query</th>
                    <th>Folder</th>
                    <th>Expected answer</th>
                    <th>Evaluation comments</th>
                  </tr>
                </thead>
                <tbody>
                  {review.questions.map((q, i) => (
                    <tr key={JSON.stringify([q.query, q.folder])}>
                      <td>{i + 1}</td>
                      <td className="preserve">{q.query}</td>
                      <td>{q.folder}</td>
                      <td className="preserve">{q.expected_answer || "—"}</td>
                      <td className="preserve">
                        {q.evaluation_comments || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="test-section">
              <div className="section-title-row">
                <div>
                  <h3>Check connectivity</h3>
                  <p>
                    The batch will still run every question, including this one.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void testFirst()}
                  disabled={blocked || testing || starting}
                >
                  <Play size={15} />
                  {testing ? "Testing…" : "Test first query"}
                </button>
              </div>
              <ErrorBox message={testError} />
              {testError && test?.execution === "queued" && (
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      setTestError("");
                      setTesting(true);
                      await api(`/api/runs/${test.runId}/dispatch`, {
                        method: "POST",
                      });
                      setTestId(test.runId);
                    } catch (e) {
                      setTestError((e as Error).message);
                      setTesting(false);
                    }
                  }}
                >
                  Retry queue dispatch
                </button>
              )}
              {test && (
                <div className="test-result">
                  <div className="result-meta">
                    <Badge value={test.execution} />
                    <span>{latency(test.result?.latencyMs)}</span>
                    <span>
                      {test.result?.sources == null
                        ? "Unknown source count"
                        : `${test.result.sources.length} retrieved passages`}
                    </span>
                  </div>
                  {test.error && <ErrorBox message={test.error} />}
                  <p className="preserve">
                    {test.result?.answer || "Waiting for Doc Search…"}
                  </p>
                  <div className="trace-line">
                    Trace ID:{" "}
                    <code>{test.result?.traceId || "Unavailable"}</code>
                    {test.result?.traceId && (
                      <CopyButton text={test.result.traceId} />
                    )}
                  </div>
                  {test.result?.promptVersion && (
                    <p>
                      Reported prompt version:{" "}
                      <code>{JSON.stringify(test.result.promptVersion)}</code>
                    </p>
                  )}
                  {test.result?.sources && (
                    <details>
                      <summary>
                        Sources ({test.result.sources.length} passages)
                      </summary>
                      {test.result.sources.map((s, i) => (
                        <div key={i} className="source-item">
                          <strong>{s.title}</strong>
                          <p className="preserve">{s.content}</p>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <label className="concurrency">
              Concurrency
              <select
                aria-label="Concurrency"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} request{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary"
              disabled={blocked || testing || starting}
              onClick={() => void start()}
            >
              {starting
                ? "Starting…"
                : `Start batch · ${review.questions.length} questions`}
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
