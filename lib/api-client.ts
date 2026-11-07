// Browser-safe request handling. Hosting errors may be text or HTML rather than JSON.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const safeCode = (value: unknown) =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value)
    ? value
    : undefined;
const safeRequestId = (value: string | null) =>
  value && /^[a-zA-Z0-9:._=-]{1,200}$/.test(value) ? value : undefined;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const changesState = !["GET", "HEAD", "OPTIONS"].includes(method);
  const uncertain = changesState
    ? " The request may already have been saved. Check Runs before starting a new batch."
    : "";
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
    text = await response.text();
  } catch {
    throw new ApiError(
      `Could not reach the application. Check your connection and deployment.${uncertain}`,
      0,
    );
  }
  let value: unknown;
  let isJson = false;
  try {
    value = JSON.parse(text);
    isJson = true;
  } catch {
    // Preserve the response status and diagnostics instead of exposing a parser error.
  }
  const problem =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const code =
    safeCode(response.headers.get("x-vercel-error")) ||
    safeCode(problem?.code) ||
    // Extract only the platform identifier; never echo arbitrary error bodies or HTML.
    text.match(
      /\b((?:FUNCTION|DEPLOYMENT|MIDDLEWARE|EDGE_FUNCTION)_[A-Z_]{3,60})\b/,
    )?.[1];
  const requestId = safeRequestId(response.headers.get("x-vercel-id"));
  const diagnostic = `${code ? ` (${code})` : ""}${requestId ? `. Request ID: ${requestId}` : ""}`;
  if (!response.ok) {
    const appError = typeof problem?.error === "string" ? problem.error : null;
    if (appError)
      throw new ApiError(appError, response.status, code, requestId);
    const guidance =
      response.status === 401
        ? "Sign in again, then retry."
        : response.status === 403
          ? "Check application access and Vercel Deployment Protection."
          : response.status === 404
            ? "Check that the latest application is deployed at this address."
            : "Check Vercel Runtime Logs for this request.";
    throw new ApiError(
      `The application returned HTTP ${response.status}${diagnostic}. ${guidance}${uncertain}`,
      response.status,
      code,
      requestId,
    );
  }
  if (!isJson)
    throw new ApiError(
      `The application returned an unexpected response (HTTP ${response.status})${diagnostic}. Check that this address serves the application and that access is allowed.${uncertain}`,
      response.status,
      code,
      requestId,
    );
  return value as T;
}
