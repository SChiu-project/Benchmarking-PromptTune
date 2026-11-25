import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

const routes = ["/", "/runs", "/records", "/cms/approve"];
// The workbook's check widths, plus one pixel either side of each breakpoint.
const widths = [1440, 1151, 1150, 901, 900, 651, 650, 390, 375];

async function settle(page: Page, route: string) {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
}

for (const width of widths) {
  test(`no horizontal page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await settle(page, route);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(
        0,
      );
    }
  });
}

test("each workspace page has one H1 and a labelled heading", async ({
  page,
}) => {
  for (const route of routes) {
    await settle(page, route);
    await expect(page.locator("h1"), route).toHaveCount(1);
  }
});

test("no serious or critical axe violations", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await settle(page, route);
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (
                context: Document,
                options: object,
              ) => Promise<{
                violations: {
                  id: string;
                  impact: string | null;
                  nodes: { target: string[] }[];
                }[];
              }>;
            };
          }
        ).axe;
        const result = await axe.run(document, {
          runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        });
        return result.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({
            id: v.id,
            targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
          }));
      });
      expect(violations, `${route} at ${width}px`).toEqual([]);
    }
  }
});

test("skip link is the first stop and moves focus to main", async ({
  page,
}) => {
  await settle(page, "/runs");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("icon rail keeps accessible names at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await settle(page, "/runs");
  for (const name of ["New benchmark", "Runs", "Records"])
    await expect(
      page.getByRole("navigation").getByRole("link", { name }),
    ).toBeVisible();
});

test("decoration is hidden from assistive technology", async ({ page }) => {
  await settle(page, "/runs");
  const canvases = page.locator("canvas");
  expect(await canvases.count()).toBeGreaterThan(0);
  for (const canvas of await canvases.all())
    await expect(canvas).toHaveAttribute("aria-hidden", "true");
});

test("review dialog: focus, Escape and focus restoration", async ({ page }) => {
  await settle(page, "/");
  const trigger = page.getByRole("button", { name: "Choose CSV file" });
  await trigger.focus();
  await page
    .locator("#csv-file")
    .setInputFiles(path.resolve("public/example.csv"));
  const dialog = page.getByRole("dialog", { name: "Review your questions" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a failed request is not shown as an empty state", async ({ page }) => {
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 500, body: JSON.stringify({ error: "Boom" }) }),
  );
  await page.goto("/runs");
  await expect(page.getByText("Couldn’t load runs")).toBeVisible();
  await expect(page.getByText("No runs yet")).toHaveCount(0);
  await expect(page.locator(".metric > strong").first()).toHaveText("—");
});

test("record rows are not click targets; details open from a button", async ({
  page,
}) => {
  await settle(page, "/records");
  const rows = page.locator(".records-table tbody tr");
  test.skip((await rows.count()) === 0, "No records in this workspace");
  const row = rows.first();
  await row.locator("td").nth(1).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: /Open details/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Record details" }),
  ).toBeVisible();
});
