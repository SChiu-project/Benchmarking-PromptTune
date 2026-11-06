import dotenv from "dotenv";
import { writeFile } from "node:fs/promises";
import { search, searchConfig } from "../lib/doc-search";
import { evaluate, evaluatorConfig } from "../lib/evaluator";
dotenv.config({ path: ".env.local", quiet: true });
const q = {
  query: "Where is the toilet?",
  folder: "persona_maisie",
  expected_answer:
    "The nearest toilets are inside the airport terminal. Exact directions are unavailable; follow the airport overhead signs or ask airport staff at the arrival hall information counter.",
  evaluation_comments:
    "Clearly communicate the limits of the available information. Do not invent precise directions.",
};
async function main() {
  const result = await search(q, searchConfig());
  console.log(
    JSON.stringify({
      search: "succeeded",
      latencyMs: result.latencyMs,
      traceId: result.traceId,
      sources: result.sources?.length ?? null,
    }),
  );
  if (evaluatorConfig()) {
    const grade = await evaluate(q, result.answer);
    await writeFile(
      "/tmp/doc-benchmark-live-smoke.json",
      JSON.stringify({ query: q, result, grade }, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        evaluation: "succeeded",
        score: grade.score,
        assessment: grade.assessment,
      }),
    );
  } else console.log("Evaluation skipped: configuration missing.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
