import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./.env*", "./.tools/**/*", "./github-ready/**/*"],
  },
  serverExternalPackages: ["proper-lockfile", "postgres"],
  devIndicators: false,
};
export default withWorkflow(config);
