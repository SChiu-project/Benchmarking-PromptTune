import { parse } from "csv-parse/sync";
import { DEFAULT_FOLDER, questionSchema, type Question } from "./schema";
export type Conflict = {
  row: number;
  firstRow: number;
  query: string;
  folder: string;
};
export type CsvReview = {
  total: number;
  empty: number;
  duplicates: number;
  questions: Question[];
  folders: Record<string, number>;
  conflicts: Conflict[];
  errors: string[];
};
export function reviewCsv(csv: string): CsvReview {
  const out: CsvReview = {
    total: 0,
    empty: 0,
    duplicates: 0,
    questions: [],
    folders: {},
    conflicts: [],
    errors: [],
  };
  let rows: string[][];
  try {
    rows = parse(csv, {
      bom: true,
      skip_empty_lines: false,
      relax_column_count: true,
      skip_records_with_empty_values: false,
    });
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : "Invalid CSV");
    return out;
  }
  if (!rows.length) {
    out.errors.push("CSV is empty.");
    return out;
  }
  const headers = rows[0].map((s) => s.trim());
  if (!headers.includes("query"))
    out.errors.push("Missing required column: query.");
  if (new Set(headers).size !== headers.length)
    out.errors.push("Duplicate column headers are not allowed.");
  if (
    headers.some(
      (h) =>
        !["query", "folder", "expected_answer", "evaluation_comments"].includes(
          h,
        ),
    )
  )
    out.errors.push(
      "Unsupported column. Use query, folder, expected_answer, evaluation_comments.",
    );
  out.total = rows.length - 1;
  if (out.total > 1000) out.errors.push("Maximum 1,000 input rows per upload.");
  if (out.errors.length) return out;
  const seen = new Map<string, { question: Question; row: number }>();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== headers.length && rows[i].some((v) => v.trim())) {
      out.errors.push(
        `Data row ${i}: expected ${headers.length} columns, got ${rows[i].length}.`,
      );
      continue;
    }
    const row = Object.fromEntries(
      headers.map((h, j) => [h, (rows[i][j] ?? "").trim()]),
    );
    if (!row.query) {
      out.empty++;
      continue;
    }
    const validated = questionSchema.safeParse({
      ...row,
      folder: row.folder || DEFAULT_FOLDER,
    });
    if (!validated.success) {
      out.errors.push(
        `Data row ${i}: ${validated.error.issues.map((x) => x.message).join(", ")}`,
      );
      continue;
    }
    const q = validated.data,
      key = JSON.stringify([q.query, q.folder]),
      prior = seen.get(key);
    if (prior) {
      out.duplicates++;
      if (
        prior.question.expected_answer !== q.expected_answer ||
        prior.question.evaluation_comments !== q.evaluation_comments
      )
        out.conflicts.push({
          row: i,
          firstRow: prior.row,
          query: q.query,
          folder: q.folder,
        });
      continue;
    }
    seen.set(key, { question: q, row: i });
    out.questions.push(q);
    Object.defineProperty(out.folders, q.folder, {
      value:
        (Object.hasOwn(out.folders, q.folder) ? out.folders[q.folder] : 0) + 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (!out.questions.length) out.errors.push("No runnable questions.");
  return out;
}
