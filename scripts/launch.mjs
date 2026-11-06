import { spawn } from "node:child_process";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
const mode = process.argv[2] || "dev";
if (
  process.env.VERCEL === "1" ||
  process.env.BENCHMARK_HOSTED === "1" ||
  Boolean(process.env.DATABASE_URL) ||
  process.env.JOB_BACKEND === "workflow"
) {
  const web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      mode,
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.PORT || "3000",
      ...(mode === "dev" ? ["--webpack"] : []),
    ],
    { stdio: "inherit" },
  );
  process.on("SIGINT", () => web.kill("SIGINT"));
  process.on("SIGTERM", () => web.kill("SIGTERM"));
  web.on("exit", (code) => process.exit(code ?? 0));
} else {
  const worker = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts"],
    { stdio: ["inherit", "pipe", "inherit"] },
  );
  let web,
    started = false,
    closing = false;
  worker.stdout.on("data", (chunk) => {
    const message = chunk.toString();
    if (!started && message.includes("WORKER_READY")) {
      started = true;
      web = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          mode,
          "--hostname",
          "127.0.0.1",
          "--port",
          process.env.PORT || "3000",
          ...(mode === "dev" ? ["--webpack"] : []),
        ],
        { stdio: "inherit" },
      );
      web.on("exit", (code) => shutdown(code ?? 1));
    } else process.stdout.write(message);
  });
  const shutdown = (code = 0) => {
    if (closing) return;
    closing = true;
    worker.kill("SIGTERM");
    web?.kill("SIGTERM");
    setTimeout(() => process.exit(code), 300).unref();
  };
  worker.on("exit", (code) => {
    if (!closing) {
      console.error("Queue worker stopped. Restart pnpm dev.");
      shutdown(code || 1);
    }
  });
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
}
