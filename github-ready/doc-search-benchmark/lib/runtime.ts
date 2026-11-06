export function isVercel() {
  return process.env.VERCEL === "1" || process.env.BENCHMARK_HOSTED === "1";
}
export function workflowMode() {
  return (
    isVercel() ||
    Boolean(process.env.DATABASE_URL) ||
    process.env.JOB_BACKEND === "workflow"
  );
}
export function databaseMode() {
  return isVercel() || Boolean(process.env.DATABASE_URL);
}
export function workspaceNamespace() {
  return (
    process.env.BENCHMARK_NAMESPACE ||
    (isVercel()
      ? process.env.VERCEL_ENV === "production"
        ? "production"
        : `preview:${process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_URL || "preview"}`
      : "local")
  );
}
