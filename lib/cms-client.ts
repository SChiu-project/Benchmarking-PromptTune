// Server-only: imported by routes/store, never by client components.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { isVercel } from "./runtime";

export class CmsError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "CMS_UNAVAILABLE",
  ) {
    super(message);
  }
}
export function cmsSettings(projectId: string) {
  const projects = (process.env.CMS_PROJECT_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!projects.length)
    throw new CmsError(
      "CMS loading is not configured. Set CMS_PROJECT_IDS and server-side CMS credentials.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  if (!projects.includes(projectId))
    throw new CmsError(
      "This project is not enabled for CMS reads in this workspace.",
      403,
      "CMS_PROJECT_DENIED",
    );
  let base: URL;
  try {
    base = new URL(
      process.env.CMS_GRAPH_BASE_URL ||
        "https://dev.setsailapi.com/nlp/llmGraph",
    );
  } catch {
    throw new CmsError(
      "Invalid CMS_GRAPH_BASE_URL configuration.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new CmsError(
      "CMS_GRAPH_BASE_URL must be a fixed HTTPS service base URL.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  const timeoutMs = Number(process.env.CMS_READ_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
    throw new CmsError(
      "CMS_READ_TIMEOUT_MS must be between 1000 and 30000.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  return { baseUrl: base.toString().replace(/\/$/, ""), timeoutMs };
}
async function cmsHeaders() {
  let token = process.env.CMS_READ_TOKEN,
    uid = process.env.CMS_READ_UID;
  if (!token && !uid && process.env.CMS_SESSION_FILE && !isVercel()) {
    try {
      const raw: unknown = JSON.parse(
        await readFile(process.env.CMS_SESSION_FILE, "utf8"),
      );
      const session = z
        .object({ token: z.string().min(1), uid: z.string().min(1) })
        .parse(raw);
      token = session.token;
      uid = session.uid;
    } catch {
      throw new CmsError(
        "CMS session file is unavailable. Sign in to the local CMS connector again.",
        503,
        "CMS_AUTH_REQUIRED",
      );
    }
  }
  if (!token || !uid)
    throw new CmsError(
      "CMS credentials are missing. Configure CMS_READ_TOKEN and CMS_READ_UID, or a local CMS_SESSION_FILE.",
      503,
      "CMS_AUTH_REQUIRED",
    );
  return { token, uid, "x-source": "cms", Accept: "application/json" };
}
const MAX_BYTES = 2 * 1024 * 1024;
export async function readCmsPrompt(
  projectId: string,
  folder: string,
  metadataOnly = false,
): Promise<unknown> {
  const settings = cmsSettings(projectId),
    headers = await cmsHeaders();
  const url = new URL(
    `${settings.baseUrl}/graph/chatbot-prompts/versions/latest`,
  );
  url.search = new URLSearchParams({
    project_id: projectId,
    source_type: "chatbot",
    folder_name: folder,
    ...(metadataOnly ? { exclude_prompts: "true" } : {}),
  }).toString();
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    // No upstream body or credential-bearing exception is included in public errors/logs.
    if (response.status === 401)
      throw new CmsError(
        "CMS session expired. Renew the configured CMS login credentials.",
        401,
        "CMS_AUTH_REQUIRED",
      );
    if (response.status === 403)
      throw new CmsError(
        "CMS denied prompt-version access for this project.",
        403,
        "CMS_ACCESS_DENIED",
      );
    if (response.status === 404)
      throw new CmsError(
        "No saved prompt version was found for this source.",
        404,
        "CMS_NOT_FOUND",
      );
    if (!response.ok)
      throw new CmsError(
        `CMS read failed (HTTP ${response.status}). Try loading again.`,
        response.status === 429 ? 429 : 502,
      );
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES)
      throw new CmsError("CMS response exceeds the 2 MB limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new CmsError("CMS returned an empty response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new CmsError("CMS response exceeds the 2 MB limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new CmsError("CMS returned invalid JSON.");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new CmsError("CMS returned an invalid prompt response.");
    const envelope = raw as Record<string, unknown>;
    if (
      envelope.status === "fail" ||
      envelope.status === "error" ||
      envelope.isSuccess === false
    )
      throw new CmsError(
        "CMS rejected the read. Check the session and project permissions.",
        403,
        "CMS_ACCESS_DENIED",
      );
    return raw;
  } catch (error) {
    if (error instanceof CmsError) throw error;
    throw new CmsError(
      error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
        ? "CMS read timed out. Try loading again."
        : "CMS could not be reached. Check the configured service and try again.",
    );
  }
}
