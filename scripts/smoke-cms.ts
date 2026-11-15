import dotenv from "dotenv";
import { readCmsPrompt, CmsError } from "../lib/cms-client";
import { normalizeCmsPrompt } from "../lib/cms-prompts";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
const project =
  process.argv[2] ||
  process.env.DOC_SEARCH_PROJECT_ID ||
  "mtr-air-kiosk-05emf61";
const folder = process.argv[3] || "ROOT";
try {
  const prompt = normalizeCmsPrompt(
    await readCmsPrompt(project, folder),
    project,
    folder,
  );
  console.log(
    JSON.stringify(
      {
        project,
        folder,
        version: prompt.version,
        isBase: prompt.isBase,
        active: prompt.isActive,
        sections: Object.keys(prompt.baseline),
        unavailable: prompt.unavailable,
        fingerprint: prompt.fingerprint,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof CmsError ? error.message : "CMS read verification failed.",
  );
  process.exitCode = 1;
}
