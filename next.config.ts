import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./.env*", "./.tools/**/*", "./github-ready/**/*"],
  },
  serverExternalPackages: ["proper-lockfile", "postgres"],
  devIndicators: false,
};
export default withWorkflow(config);
