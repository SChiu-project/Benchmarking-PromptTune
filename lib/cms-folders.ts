import { z } from "zod";
import { CmsError, type CmsCredentials } from "./cms-client";
import { cmsAuthRequest } from "./cms-auth-upstream";

// Matches the CMS prompt editor/connector: document paths supply folder suggestions,
// not an authoritative list of saved prompt versions. ROOT is always available.
export async function listCmsFolders(
  projectId: string,
  credentials: CmsCredentials,
) {
  const raw = await cmsAuthRequest(
    `/project/${encodeURIComponent(projectId)}/documentSearch/v2/paths`,
    undefined,
    credentials,
  );
  const response = z
    .object({
      isSuccess: z.literal(true),
      paths: z.array(z.string()).max(10000),
    })
    .safeParse(raw);
  if (!response.success)
    throw new CmsError("CMS returned an unsupported folder list.");
  const names = new Set<string>(["ROOT"]);
  for (const path of response.data.paths) {
    try {
      const parts: unknown = JSON.parse(path);
      if (
        Array.isArray(parts) &&
        typeof parts[0] === "string" &&
        parts[0].trim() &&
        parts[0].length <= 500
      )
        names.add(parts[0]);
    } catch {
      /* Malformed document paths do not create folder suggestions. */
    }
  }
  return {
    projectId,
    folders: ["ROOT", ...[...names].filter((name) => name !== "ROOT").sort()],
  };
}
