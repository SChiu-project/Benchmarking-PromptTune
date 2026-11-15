import { recordSummary } from "./http";
import type { State } from "./schema";
export function listRecords(state: State, params: URLSearchParams) {
  const scope = state.runs
    .filter(
      (r) =>
        r.kind === "batch" &&
        (!params.get("run") || r.id === params.get("run")),
    )
    .reverse()
    .flatMap((r) => r.records);
  const folders = [...new Set(scope.map((r) => r.question.folder))].sort();
  const filtered = scope.filter(
    (r) =>
      (!params.get("folder") || r.question.folder === params.get("folder")) &&
      (!params.get("execution") || r.execution === params.get("execution")) &&
      (!params.get("evaluation") ||
        r.evaluationStatus === params.get("evaluation")) &&
      (!params.get("decision") ||
        r.evaluation?.requirements?.decision === params.get("decision")) &&
      r.question.query
        .toLowerCase()
        .includes((params.get("q") || "").toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const requested = Number(params.get("page") || 1);
  const page = Number.isInteger(requested)
    ? Math.min(pages, Math.max(1, requested))
    : 1;
  return {
    records: filtered.slice((page - 1) * 50, page * 50).map(recordSummary),
    total: filtered.length,
    folders,
    page,
    pages,
  };
}
