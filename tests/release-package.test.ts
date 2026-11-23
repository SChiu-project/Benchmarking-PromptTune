import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-package-"));
  await mkdir(join(dir, "scripts"));
  await writeFile(
    join(dir, "scripts/package-github.py"),
    await readFile("scripts/package-github.py"),
  );
  await writeFile(
    join(dir, ".gitignore"),
    ".env.local\nreports/\ngithub-ready/\n",
  );
  await writeFile(join(dir, "package.json"), '{"name":"release-fixture"}');
  await writeFile(join(dir, "tsconfig.tsbuildinfo"), "generated cache");
  await writeFile(join(dir, ".env.example"), "CMS_READ_TOKEN=\n");
  execFileSync("git", ["init", "-q", dir]);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const pack = (...args: string[]) =>
  spawnSync("python3", [join(dir, "scripts/package-github.py"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
it("creates named releases while retaining previous exports and excluding build caches", async () => {
  await mkdir(join(dir, "github-ready"));
  await writeFile(join(dir, "github-ready/old.txt"), "preserve");
  execFileSync("git", ["add", "-f", "github-ready/old.txt"], { cwd: dir });
  expect(pack("--name", "candidate-1").status).toBe(0);
  expect(await readFile(join(dir, "github-ready/old.txt"), "utf8")).toBe(
    "preserve",
  );
  const exported = join(dir, "github-ready/candidate-1/doc-search-benchmark");
  expect(await readFile(join(exported, "package.json"), "utf8")).toContain(
    "release-fixture",
  );
  await expect(
    access(join(exported, "tsconfig.tsbuildinfo")),
  ).rejects.toThrow();
  const before = await readFile(
    join(dir, "github-ready/candidate-1/doc-search-benchmark-github.zip"),
  );
  expect(pack("--name", "candidate-1").status).toBe(1);
  expect(
    await readFile(
      join(dir, "github-ready/candidate-1/doc-search-benchmark-github.zip"),
    ),
  ).toEqual(before);
});
it("refuses forcibly tracked private review evidence", async () => {
  await mkdir(join(dir, "reports"));
  await writeFile(
    join(dir, "reports/reviewer.json"),
    '{"reviewer":"Private person"}',
  );
  execFileSync("git", ["add", "-f", "reports/reviewer.json"], { cwd: dir });
  const result = pack("--name", "candidate-2");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Refusing a runtime/private path");
});
it("detects configured tokens copied into source without printing the token", async () => {
  const token = "private-token-never-print-123456";
  await writeFile(join(dir, ".env.local"), `CMS_READ_TOKEN=${token}\n`);
  await writeFile(join(dir, "capture.txt"), `credential: ${token}`);
  const result = pack("--name", "candidate-3");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("configured credential");
  expect(result.stderr).not.toContain(token);
});
it("rejects release-name traversal", () => {
  const result = pack("--name", "../../outside");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Release name");
});
