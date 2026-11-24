import type { RecordData } from "./schema";

// Confirmed dev deployment. Other environments require their own mapping.
export function langfuseTraceUrl(
  traceId: string | null | undefined,
  endpoint: string,
): string | null {
  if (!traceId?.trim()) return null;
  try {
    if (new URL(endpoint).origin !== "https://dev.setsailapi.com") return null;
  } catch {
    return null;
  }
  const url = new URL(
    "https://lang.setsailapi.com/project/cmmluucqm001xyn07yvgkaipa/traces",
  );
  url.searchParams.set("search", traceId);
  url.searchParams.set("peek", traceId);
  return url.href;
}

export function withLangfuseLink(
  record: RecordData,
  endpoint: string,
): RecordData {
  if (!record.result) return record;
  return {
    ...record,
    result: {
      ...record.result,
      traceUrl: langfuseTraceUrl(record.result.traceId, endpoint) ?? undefined,
    },
  };
}
