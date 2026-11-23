// No search, judge, CMS or email calls. Writes a new private directory only.
import dotenv from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readState } from "../lib/store";
import { closeDatabase } from "../lib/postgres-store";
import { calibrationPacket } from "../lib/calibration-packet";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const [runId, directory, ...extra] = process.argv.slice(2);
  if (!runId || !directory || extra.length)
    throw new Error(
      "Usage: calibration-packet.ts <runId> <new-output-directory>",
    );
  const run = (await readState()).runs.find((r) => r.id === runId);
  if (!run) throw new Error("Run not found.");
  const packet = calibrationPacket(run);
  const target = path.resolve(directory);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target, { mode: 0o700 }); // Existing directories are never overwritten.
  for (const name of ["reviewers", "coordinator"])
    await mkdir(path.join(target, name), { mode: 0o700 });
  const files = {
    "reviewers/evidence.json": packet.evidence,
    "reviewers/reviewer-1.json": packet.reviewer1,
    "reviewers/reviewer-2.json": packet.reviewer2,
    "coordinator/adjudication.json": packet.adjudication,
    "coordinator/identity-map.json": packet.coordinator,
  };
  for (const [file, value] of Object.entries(files))
    await writeFile(
      path.join(target, file),
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  console.log(
    `Prepared ${packet.evidence.cases.length} answers in ${packet.coordinator.caseFamilies} question families at ${target}. Give each reviewer evidence.json and only their own form; keep coordinator files private.`,
  );
}
main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
