import { StoredStateError } from "./postgres-store";
import { z } from "zod";
import { isVercel } from "./runtime";
import { ConflictError } from "./store";
export function fail(error: unknown) {
  const databaseCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    [
      "55P03",
      "57014",
      "25P03",
      "53300",
      "57P01",
      "57P02",
      "57P03",
      "CONNECT_TIMEOUT",
      "QUEUE_TIMEOUT",
      "QUERY_TIMEOUT",
      "CONNECTION_CLOSED",
      "CONNECTION_ENDED",
      "CONNECTION_DESTROYED",
      "CANCEL_UNANSWERED",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
    ].includes(databaseCode)
  ) {
    console.error("Database request unavailable:", { code: databaseCode });
    return Response.json(
      {
        error:
          "The database is busy or unavailable. Check Vercel Runtime Logs and database activity. Check Runs before starting another batch.",
        code: "DATABASE_UNAVAILABLE",
        databaseCode,
      },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  if (error instanceof StoredStateError) {
    console.error("Stored benchmark state validation failed:", error);
    return Response.json(
      { error: error.message, code: "STORED_STATE_INVALID" },
      { status: 500 },
    );
  }
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof ConflictError)
    return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof SyntaxError)
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  console.error("Request failed:", error);
  return Response.json(
    { error: "Request failed. Check the server logs." },
    { status: 500 },
  );
}
export function localRequest(req: Request) {
  const origin = req.headers.get("origin"),
    host = req.headers.get("host");
  if (origin && new URL(origin).host !== host)
    throw new ConflictError("Cross-origin requests are not allowed.");
  if (isVercel() && host) {
    const trusted = [
      process.env.APP_URL,
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ]
      .filter(Boolean)
      .map(
        (value) =>
          new URL(value!.includes("://") ? value! : `https://${value}`).host,
      );
    if (!trusted.includes(host))
      throw new ConflictError(
        "Unrecognized application host. Set APP_URL for custom domains.",
      );
  }
  if (
    !isVercel() &&
    host &&
    !["127.0.0.1", "localhost", "[::1]"].includes(host.replace(/:\d+$/, ""))
  )
    throw new ConflictError("Localhost requests only.");
}
export async function jsonBody(req: Request) {
  localRequest(req);
  const text = await req.text();
  if (Buffer.byteLength(text) > 4 * 1024 * 1024)
    throw new ConflictError("Request exceeds 4 MB.");
  return JSON.parse(text) as unknown;
}
export function recordSummary<
  T extends {
    result?: { rawRequest: unknown; rawResponse: unknown };
    failureDetails?: unknown;
    attempts: unknown[];
  },
>(r: T) {
  const { failureDetails: _, attempts: __, ...rest } = r;
  void _;
  void __;
  return {
    ...rest,
    result: r.result
      ? {
          ...r.result,
          rawRequest: undefined,
          rawResponse: undefined,
          sources: undefined,
          sourceCount:
            "sources" in r.result && Array.isArray(r.result.sources)
              ? r.result.sources.length
              : null,
        }
      : undefined,
  };
}
