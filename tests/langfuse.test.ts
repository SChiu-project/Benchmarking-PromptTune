import { describe, expect, it } from "vitest";
import { langfuseTraceUrl, withLangfuseLink } from "../lib/langfuse";
import type { RecordData } from "../lib/schema";

const devEndpoint = "https://dev.setsailapi.com/nlp/rag/docSearchConvo";

describe("Langfuse trace links", () => {
  it("uses the confirmed dev project and matching search/peek IDs", () => {
    const id = "acca15ad368196872f0846ecccf1adc8";
    const url = new URL(langfuseTraceUrl(id, devEndpoint)!);
    expect(url.origin).toBe("https://lang.setsailapi.com");
    expect(url.pathname).toBe("/project/cmmluucqm001xyn07yvgkaipa/traces");
    expect(url.searchParams.get("search")).toBe(id);
    expect(url.searchParams.get("peek")).toBe(id);
    expect(url.searchParams.has("timestamp")).toBe(false);
  });

  it("encodes trace IDs without allowing extra query parameters", () => {
    const id = "trace&peek=other#fragment";
    const url = new URL(langfuseTraceUrl(id, devEndpoint)!);
    expect([...url.searchParams.keys()]).toEqual(["search", "peek"]);
    expect(url.searchParams.get("search")).toBe(id);
    expect(url.searchParams.get("peek")).toBe(id);
    expect(url.hash).toBe("");
  });

  it("does not link absent traces or unconfigured environments", () => {
    for (const id of [null, undefined, "", " "]) {
      expect(langfuseTraceUrl(id, devEndpoint)).toBeNull();
    }
    for (const endpoint of [
      "https://setsailapi.com/nlp/rag/docSearchConvo",
      "https://dev.setsailapi.com.evil.test/nlp/rag/docSearchConvo",
      "http://dev.setsailapi.com/nlp/rag/docSearchConvo",
      "invalid",
    ]) {
      expect(langfuseTraceUrl("trace", endpoint)).toBeNull();
    }
  });

  it("adds links to historical records without mutating stored data", () => {
    const record = { result: { traceId: "trace" } } as RecordData;
    expect(withLangfuseLink(record, devEndpoint).result?.traceUrl).toBeTruthy();
    expect(record.result?.traceUrl).toBeUndefined();
    expect(
      withLangfuseLink(record, "https://setsailapi.com").result?.traceUrl,
    ).toBeUndefined();
    const pending = {} as RecordData;
    expect(withLangfuseLink(pending, devEndpoint)).toBe(pending);
  });
});
