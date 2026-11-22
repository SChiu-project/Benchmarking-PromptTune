import type {
  DimensionRow,
  DimensionSuiteResult,
} from "@/lib/dimension-contract";
import type { RunSummary } from "@/lib/schema";
import { DIMENSION_LABELS } from "./dimension-editor";
import { percent, date } from "./common";

function StatusBadge({ status }: { status: DimensionRow["status"] }) {
  return <span className={`badge dim-${status}`}>{status.replaceAll("_", " ")}</span>;
}
export function DimensionScore({ suite }: { suite?: DimensionSuiteResult }) {
  if (!suite) return null;
  return (
    <>
      {suite.overallPassed === null
        ? "N/A"
        : suite.overallPassed
          ? "PASS"
          : "FAIL"}
      <small>Dimensions {percent(suite.passRate)}</small>
    </>
  );
}
function RowEvidence({ row }: { row: DimensionRow }) {
  return (
    <details onClick={(e) => e.stopPropagation()}>
      <summary>Evidence</summary>
      {row.passages && (
        <ul>
          {row.passages.map((p) => (
            <li key={p.index}>
              P{p.index} · rating {p.rating} — {p.reason}
            </li>
          ))}
        </ul>
      )}
      {row.issues && row.issues.length > 0 && (
        <ul>
          {row.issues.map((x, i) => (
            <li key={i}>
              <blockquote>{x.answer_quote}</blockquote>
              {x.problem}
            </li>
          ))}
        </ul>
      )}
      {row.items && (
        <ul>
          {row.items.map((x, i) => (
            <li key={i}>
              {x.request} · {x.status}
              {x.answer_quote ? ` — “${x.answer_quote}”` : ""}
            </li>
          ))}
        </ul>
      )}
      {row.missingCore && row.missingCore.length > 0 && (
        <p>Missing core items: {row.missingCore.join("; ")}</p>
      )}
      {row.claims && (
        <ul>
          {row.claims.map((c, i) => (
            <li key={i}>
              <strong>{c.status}</strong>
              {c.material ? " · material" : ""} — {c.claim}
              <blockquote>{c.answer_quote}</blockquote>
              {c.passage_quote && (
                <blockquote>
                  P{c.passage_index}: {c.passage_quote}
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
      {row.citations && (
        <ul>
          {row.citations.map((c, i) => (
            <li key={i}>
              {c.marker} → P{c.passage_index ?? "?"} · {c.status}
              <blockquote>{c.claim_quote}</blockquote>
              {c.passage_quote && <blockquote>{c.passage_quote}</blockquote>}
            </li>
          ))}
        </ul>
      )}
      {row.uncitedMaterialClaims && row.uncitedMaterialClaims.length > 0 && (
        <p>Uncited material claims: {row.uncitedMaterialClaims.join("; ")}</p>
      )}
      {row.brokenMarkers && row.brokenMarkers.length > 0 && (
        <p>Broken markers: {row.brokenMarkers.join(", ")}</p>
      )}
      {!row.passages &&
        !row.issues?.length &&
        !row.items &&
        !row.claims &&
        !row.citations && <p className="muted">No row evidence recorded.</p>}
    </details>
  );
}
export function DimensionEvidence({ suite }: { suite: DimensionSuiteResult }) {
  return (
    <section className="dimension-evidence">
      <p>
        <strong>
          {suite.overallPassed === null
            ? "UNDECIDED"
            : suite.overallPassed
              ? "PASS"
              : "FAIL"}
        </strong>{" "}
        · dimension pass rate {percent(suite.passRate)} · {suite.counts.passed}{" "}
        pass / {suite.counts.failed} fail / {suite.counts.review} review /{" "}
        {suite.counts.notApplicable} N/A / {suite.counts.errors} error
      </p>
      <p className="muted">
        Draft rubric {suite.rubricVersion} (uncalibrated) · missing-passage
        policy: {suite.naPolicy} · judged {date(suite.evaluatedAt)}. Quotes are
        mechanically verified; semantic judgments are not human-verified.
      </p>
      {suite.rows.map((row) => (
        <div className="requirement-row" key={row.name}>
          <strong>{DIMENSION_LABELS[row.name]}</strong>{" "}
          <StatusBadge status={row.status} />
          {row.confidence !== null && ` · confidence ${row.confidence}`}
          {row.averageScore !== null &&
            ` · avg ${row.averageScore} · relevant ${row.relevantCount}/${row.totalCount}`}
          {row.behavior && ` · ${row.behavior.replaceAll("_", " ")}`}
          <p>{row.reason}</p>
          <RowEvidence row={row} />
        </div>
      ))}
    </section>
  );
}
export function DimensionSummaryTable({
  summary,
}: {
  summary: NonNullable<RunSummary["dimensions"]>;
}) {
  return (
    <div className="table-wrap dimension-summary">
      <table>
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Total</th>
            <th>Pass</th>
            <th>Fail</th>
            <th>Review</th>
            <th>N/A</th>
            <th>Error</th>
            <th>Pass rate</th>
          </tr>
        </thead>
        <tbody>
          {summary.perDimension.map((d) => (
            <tr key={d.name}>
              <td>{DIMENSION_LABELS[d.name]}</td>
              <td>{d.total}</td>
              <td className="success-text">{d.passed}</td>
              <td className={d.failed ? "error-text" : ""}>{d.failed}</td>
              <td>{d.review}</td>
              <td>{d.notApplicable}</td>
              <td className={d.errors ? "error-text" : ""}>{d.errors}</td>
              <td>{percent(d.passRate)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>Overall (all selected pass)</strong>
            </td>
            <td>
              {summary.overall.passed +
                summary.overall.failed +
                summary.overall.undecided}
            </td>
            <td className="success-text">{summary.overall.passed}</td>
            <td className={summary.overall.failed ? "error-text" : ""}>
              {summary.overall.failed}
            </td>
            <td colSpan={3}>{summary.overall.undecided} undecided</td>
            <td>{percent(summary.overall.passRate)}</td>
          </tr>
        </tbody>
      </table>
      {summary.mixed && (
        <p className="muted">
          Mixed dimension prompts/policies across regrades; pass rates
          suppressed. Counts remain visible.
        </p>
      )}
    </div>
  );
}
