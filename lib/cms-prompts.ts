import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  cmsSettings,
  readCmsPrompt,
  CmsError,
  type CmsReadAccess,
} from "./cms-client";
import {
  localizedPromptSchema,
  promptSections,
  type PromptSnapshot,
  type PromptBaseline,
} from "./prompt-schema";
import { workspaceNamespace } from "./runtime";
import { searchConfig } from "./doc-search";
import { readState, transaction } from "./store";

export const cmsLoadSchema = z
  .object({
    projectId: z.string().trim().min(1).max(500),
    documentFolder: z.string().trim().min(1).max(500),
    promptFolder: z.string().trim().min(1).max(500),
  })
  .strict();
export const cmsCheckSchema = z.object({ snapshotId: z.uuid() }).strict();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const canonicalJson = (value: unknown) =>
  JSON.stringify(canonical(value));
const responseSchema = z.object({
  project_id: z.string(),
  folder_name: z.string(),
  source_type: z.literal("chatbot"),
  prompt_version: z.number().int().nonnegative(),
  version_id: z.string().min(1).nullable(),
  is_base: z.boolean().optional(),
  is_active: z.boolean(),
  prompts: z.record(z.string(), z.unknown()),
});
export function normalizeCmsPrompt(
  raw: unknown,
  projectId: string,
  folder: string,
) {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success)
    throw new CmsError("CMS prompt response has an unsupported shape.");
  const data = parsed.data,
    isBase = data.is_base === true;
  if (data.project_id !== projectId || data.folder_name !== folder)
    throw new CmsError("CMS returned a different project or prompt folder.");
  if (!data.is_active)
    throw new CmsError(
      "CMS returned an inactive prompt. Choose an active source.",
      409,
      "CMS_INACTIVE",
    );
  if (
    (isBase && (data.prompt_version !== 0 || data.version_id !== null)) ||
    (!isBase && (!data.version_id || data.prompt_version === 0))
  )
    throw new CmsError("CMS prompt version metadata is inconsistent.");
  const baseline: PromptBaseline = {},
    unavailable: Record<string, string> = {},
    fingerprintFields: Record<string, unknown> = {};
  for (const [key] of promptSections) {
    const alias = key.replace(/_dto$/, "_dict");
    const value = Object.hasOwn(data.prompts, key)
      ? data.prompts[key]
      : data.prompts[alias];
    fingerprintFields[key] =
      value === undefined ? { missing: true } : { value };
    const supported = localizedPromptSchema.safeParse(value);
    if (supported.success) baseline[key] = supported.data;
    else if (value === undefined)
      unavailable[key] = "Missing section; runtime defaults are unknown.";
    else if (value === null)
      unavailable[key] = "Section is null; runtime defaults are unknown.";
    else
      unavailable[key] =
        "Requires string en, zh and sc fields (maximum 50,000 characters each). No missing language was filled with empty text.";
  }
  return {
    baseline,
    unavailable,
    isBase,
    version: data.prompt_version,
    versionId: data.version_id,
    isActive: data.is_active,
    fingerprint: createHash("sha256")
      .update(canonicalJson(fingerprintFields))
      .digest("hex"),
  };
}
function sourceScope() {
  const { baseUrl } = cmsSettings(),
    endpoint = searchConfig().endpoint;
  if (new URL(baseUrl).origin !== new URL(endpoint).origin)
    throw new CmsError(
      "CMS and Doc Search environments differ. Configure matching service origins.",
      409,
      "CMS_SCOPE_MISMATCH",
    );
  return { environment: baseUrl, searchEndpoint: endpoint };
}
export async function loadPromptSnapshot(
  input: z.infer<typeof cmsLoadSchema>,
  access?: CmsReadAccess,
) {
  const scope = cmsLoadSchema.parse(input),
    environment = sourceScope();
  // Network reads happen before acquiring the workspace transaction lock.
  const prompt = normalizeCmsPrompt(
    await readCmsPrompt(
      scope.projectId,
      scope.promptFolder,
      false,
      access?.credentials,
    ),
    scope.projectId,
    scope.promptFolder,
  );
  const now = Date.now();
  const snapshot: PromptSnapshot = {
    id: randomUUID(),
    workspace: workspaceNamespace(),
    ...(access ? { accessSessionHash: access.sessionHash } : {}),
    ...scope,
    ...environment,
    ...prompt,
    retrievedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString(),
  };
  await transaction((state) => {
    const current = (state.promptSnapshots ?? []).filter(
      (s) => Date.parse(s.expiresAt) > now,
    );
    state.promptSnapshots = [...current.slice(-19), snapshot];
  });
  return snapshot;
}
export function assertSnapshotScope(
  snapshot: PromptSnapshot,
  projectId: string,
  folders: string[],
) {
  const scope = sourceScope();
  if (
    snapshot.workspace !== workspaceNamespace() ||
    snapshot.projectId !== projectId ||
    folders.length !== 1 ||
    folders[0] !== snapshot.documentFolder ||
    snapshot.environment !== scope.environment ||
    snapshot.searchEndpoint !== scope.searchEndpoint
  )
    throw new CmsError(
      "The loaded prompt belongs to a different workspace, project, folder or environment. Load it again.",
      409,
      "CMS_SCOPE_MISMATCH",
    );
  if (Date.parse(snapshot.expiresAt) <= Date.now())
    throw new CmsError(
      "This prompt snapshot expired. Load it again.",
      409,
      "CMS_SNAPSHOT_EXPIRED",
    );
}
export async function getPromptSnapshot(id: string) {
  const snapshot = (await readState()).promptSnapshots?.find(
    (s) => s.id === id,
  );
  if (!snapshot)
    throw new CmsError(
      "Prompt snapshot is unavailable. Load it again.",
      409,
      "CMS_SNAPSHOT_EXPIRED",
    );
  assertSnapshotScope(snapshot, snapshot.projectId, [snapshot.documentFolder]);
  return snapshot;
}
export async function checkPromptSnapshot(
  snapshot: PromptSnapshot,
  access?: CmsReadAccess,
) {
  if (
    snapshot.accessSessionHash &&
    snapshot.accessSessionHash !== access?.sessionHash
  )
    throw new CmsError(
      "This prompt was loaded in another browser session. Load it again using your CMS access.",
      403,
      "CMS_SESSION_MISMATCH",
    );
  assertSnapshotScope(snapshot, snapshot.projectId, [snapshot.documentFolder]);
  // Full reads work for both saved versions and base configurations (whose metadata read 404s).
  const current = normalizeCmsPrompt(
    await readCmsPrompt(
      snapshot.projectId,
      snapshot.promptFolder,
      false,
      access?.credentials,
    ),
    snapshot.projectId,
    snapshot.promptFolder,
  );
  return {
    snapshotId: snapshot.id,
    changed:
      current.fingerprint !== snapshot.fingerprint ||
      current.versionId !== snapshot.versionId ||
      current.version !== snapshot.version ||
      current.isBase !== snapshot.isBase,
    checkedAt: new Date().toISOString(),
    version: current.version,
    isBase: current.isBase,
  };
}
