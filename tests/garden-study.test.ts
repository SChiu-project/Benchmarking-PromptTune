import { expect, test } from "vitest";
import { badgeTone, statusLabel } from "../components/common";
import { rng, seedFor } from "../lib/painter";

test("statuses map to explicit tones; unknown values stay neutral", () => {
  expect(badgeTone("succeeded")).toBe("success");
  expect(badgeTone("completed")).toBe("success");
  expect(badgeTone("running")).toBe("active");
  expect(badgeTone("queued")).toBe("warning");
  expect(badgeTone("failed")).toBe("danger");
  expect(badgeTone("interrupted")).toBe("danger");
  expect(badgeTone("skipped")).toBe("neutral");
  expect(badgeTone("something-new")).toBe("neutral");
  expect(statusLabel("not_applicable")).toBe("Not applicable");
});

test("the painted field is seeded per route and repeatable", () => {
  expect(seedFor("/runs")).toBe(seedFor("/runs"));
  expect(seedFor("/runs")).not.toBe(seedFor("/records"));
  const a = rng(1889),
    b = rng(1889);
  const first = Array.from({ length: 5 }, a);
  expect(Array.from({ length: 5 }, b)).toEqual(first);
  for (const n of first) expect(n >= 0 && n < 1).toBe(true);
});
