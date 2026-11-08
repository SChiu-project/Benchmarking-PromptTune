import { readFile, access } from "node:fs/promises";
import assert from "node:assert/strict";
// Validate real build artifacts, not just the configured directory name.
const buildId = await readFile(
  new URL("../.next/BUILD_ID", import.meta.url),
  "utf8",
);
assert(buildId.trim(), "Missing production build ID in .next.");
const routes = JSON.parse(
  await readFile(
    new URL("../.next/routes-manifest.json", import.meta.url),
    "utf8",
  ),
);
assert(
  Array.isArray(routes.staticRoutes) && Array.isArray(routes.dynamicRoutes),
  "Invalid Next.js routes manifest.",
);
const app = JSON.parse(
  await readFile(
    new URL("../.next/server/app-paths-manifest.json", import.meta.url),
    "utf8",
  ),
);
for (const route of [
  "/page",
  "/records/page",
  "/runs/page",
  "/api/runs/route",
  "/.well-known/workflow/v1/flow/route",
]) {
  assert(
    typeof app[route] === "string",
    `Production build is missing ${route}.`,
  );
  await access(new URL(`../.next/server/${app[route]}`, import.meta.url));
}
console.log(
  "Verified standard .next production output, routes, pages, and Workflow handler.",
);
