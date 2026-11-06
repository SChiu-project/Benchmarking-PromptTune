import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
const missing = [];
if (!process.env.DATABASE_URL)
  missing.push("DATABASE_URL (PostgreSQL connection string)");
if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16)
  missing.push("APP_PASSWORD (at least 16 characters)");
if (missing.length) {
  console.error(
    "Hosted configuration still needs:\n" +
      missing.map((s) => " - " + s).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "Hosted application settings are present. This checks configuration only; it does not verify database connectivity or a live Vercel deployment.",
  );
if (
  !process.env.EVALUATOR_ENDPOINT ||
  !process.env.EVALUATOR_MODEL ||
  !process.env.EVALUATOR_API_KEY
)
  console.log(
    "Evaluator is incomplete: grading will be skipped until all three EVALUATOR_* settings are supplied.",
  );
