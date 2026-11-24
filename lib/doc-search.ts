import { langfuseTraceUrl } from "./langfuse";
import { z } from "zod";
import {
  promptCoversFolder,
  type Question,
  type SearchConfig,
  type SearchResult,
} from "./schema";
export function searchConfig(): SearchConfig {
  return {
    endpoint:
      process.env.DOC_SEARCH_ENDPOINT ||
      "https://dev.setsailapi.com/nlp/rag/docSearchConvo",
    projectId: process.env.DOC_SEARCH_PROJECT_ID || "mtr-air-kiosk-05emf61",
    timeoutMs: Number(process.env.DOC_SEARCH_TIMEOUT_MS || 60000),
  };
}
export function searchRequest(q: Question, c: SearchConfig) {
  const scope =
    c.promptScopeFolder ?? c.promptProvenance?.snapshot.documentFolder;
  const prompted =
    Boolean(c.promptOverrides || c.promptProvenance) &&
    promptCoversFolder(scope, q.folder);
  return {
    ...(c.answerModel
      ? { ans_model_type: c.answerModel, use_cache: false }
      : {}),
    user_queries: [q.query],
    folder_names: [q.folder],
    project_id: c.projectId,
    doc_search_version: 2,
    stream: false,
    with_reference: true,
    ...(prompted ? (c.promptOverrides ?? {}) : {}),
    ...(prompted ? { use_cache: false } : {}),
  };
}
const section = z
  .object({
    id: z.string().nullish(),
    doc_name: z.string().min(1),
    url: z.string().nullish(),
    content: z.string(),
  })
  .passthrough();
const observed = z
  .object({
    message: z
      .object({
        series: z.array(z.object({ text: z.string() }).passthrough()).min(1),
      })
      .passthrough(),
    langsmith_trace_id: z.string().nullish(),
    used_sections: z.unknown().optional(),
    answering_failed: z.boolean().optional(),
  })
  .passthrough();
export function adaptResponse(
  raw: unknown,
): Pick<
  SearchResult,
  | "answer"
  | "sources"
  | "traceId"
  | "promptVersion"
  | "reportedModel"
  | "answerSource"
> {
  const data = observed.parse(raw);
  if (data.answering_failed)
    throw new Error("Doc Search reported answering_failed.");
  const answer = data.message.series.map((x) => x.text).join("\n");
  if (!answer.trim()) throw new Error("Doc Search returned an empty answer.");
  const sources = z.array(section).safeParse(data.used_sections);
  const promptVersion = z
    .record(z.string(), z.string())
    .safeParse(
      raw && typeof raw === "object" && "_prompt_version" in raw
        ? raw._prompt_version
        : undefined,
    );
  const metadata = raw as Record<string, unknown>;
  const bot = Array.isArray(metadata.bot_responses)
    ? metadata.bot_responses.at(-1)
    : undefined;
  return {
    ...(typeof metadata.ans_model_type === "string"
      ? { reportedModel: metadata.ans_model_type }
      : {}),
    ...(bot && typeof bot.answer_source === "string"
      ? { answerSource: bot.answer_source }
      : {}),
    answer,
    traceId: data.langsmith_trace_id || null,
    sources: sources.success
      ? sources.data.map((s) => ({
          id: s.id ?? null,
          title: s.doc_name || s.url || s.id || "Retrieved passage",
          url: s.url ?? null,
          content: s.content || "",
          metadata: s,
        }))
      : null,
    ...(promptVersion.success ? { promptVersion: promptVersion.data } : {}),
  };
}
export class SearchFailure extends Error {
  constructor(
    message: string,
    public rawRequest: unknown,
    public rawResponse: unknown = null,
  ) {
    super(message);
  }
}
export async function search(
  q: Question,
  c: SearchConfig,
): Promise<SearchResult> {
  const rawRequest = searchRequest(q, c),
    start = performance.now();
  let raw: unknown = null;
  try {
    const response = await fetch(c.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rawRequest),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    const text = await response.text();
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text;
      throw new Error(
        `Doc Search returned invalid JSON (HTTP ${response.status}).`,
      );
    }
    if (!response.ok)
      throw new Error(`Doc Search HTTP ${response.status}. See raw response.`);
    const adapted = adaptResponse(raw);
    return {
      ...adapted,
      traceUrl: langfuseTraceUrl(adapted.traceId, c.endpoint) ?? undefined,
      ...(c.answerModel
        ? {
            modelVerification: adapted.reportedModel
              ? adapted.reportedModel === c.answerModel
                ? ("matched" as const)
                : ("mismatch" as const)
              : ("unreported" as const),
          }
        : {}),
      latencyMs: Math.round(performance.now() - start),
      rawRequest,
      rawResponse: raw,
    };
  } catch (e) {
    throw new SearchFailure(
      e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)
        ? "Doc Search timed out; delivery is ambiguous. Request was not retried."
        : e instanceof Error
          ? e.message
          : "Network failure",
      rawRequest,
      raw,
    );
  }
}
