import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Whole-app smoke test: load the built page, drop a CSV in, and assert the app actually rendered.
//
// This is deliberately ONE test, not a suite. Its job is to catch whole-app breakage that no unit
// test can see — a broken import, a Chart.js/PapaParse upgrade, a render path that throws — at low
// maintenance cost. The pure logic is covered far better and far faster by the Vitest suite; adding
// interaction tests here trades a lot of flake for little that Node tests can't already pin.
//
// The fixture is Evnt_flow_test.csv because it is the only log committed to the repo: the real
// controller logs are gitignored for privacy, so CI has no others to reach for.
const FIXTURE = fileURLToPath(new URL("../Evnt_flow_test.csv", import.meta.url));

test("loads a CSV and renders the timeline, feed, and stats", async ({ page }) => {
  // Any console error at all is a failure — a thrown render is exactly the class of bug this catches,
  // and app.js routes its own failures through pushError/showErrorBanner rather than crashing loudly.
  const consoleErrors = [];
  page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", err => consoleErrors.push(String(err)));

  await page.goto("/");
  await expect(page.locator("#subtitle")).toContainText("Upload a controller event log");

  // #fileInput is class="hidden" (the visible control is the styled #dropZone); setInputFiles drives
  // the input directly, which is what the drop zone's click handler ends up doing anyway.
  await page.setInputFiles("#fileInput", FIXTURE);

  // The fixture is 44 rows, all of which parse — pinned exactly in tests/pipeline.test.js.
  await expect(page.locator("#subtitle")).toContainText("44 events");
  await expect(page.locator("#fileName")).toContainText("Evnt_flow_test.csv");

  // The three panes that make up the dashboard: stat strip, swimlane timeline, audit feed.
  // 42, not 44: the stat strip counts FILTERED events in the current window, and Advanced is off by
  // default, which hides this fixture's two noise-category rows (SB,RD + NW,RY). The subtitle above
  // counts every parsed event. That gap between the two numbers is intended behavior.
  await expect(page.locator("#statTotal")).toHaveText("42");
  await expect(page.locator("#statAlerts")).toHaveText("2");
  await expect(page.locator(".tl-bar").first()).toBeVisible();
  await expect(page.locator(".feed-row").first()).toBeVisible();

  // The scrubber comes on by default and brings the "what's running now" panel with it.
  await expect(page.locator("#scrubPanel")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("shows no-runtime zones and opens their blocking event", async ({ page }) => {
  const csv = [
    "06/17/26 06:00:00,PG,SR,DT,PG=1",
    "06/17/26 06:00:01,ZN,WT,SY,ZN=2,PG=1",
    "06/17/26 06:10:00,ZN,DN,SY,ZN=2,PG=1",
    "06/17/26 06:10:01,PG,DN,SY,PG=1",
    "06/17/26 06:11:00,PZ,SE,BM,PZ=1,ZN=10,PG=1,KY=RT,NV=300",
    "06/17/26 06:12:00,ZN,DS,SY,ZN=10",
  ].join("\n");

  await page.goto("/");
  await page.setInputFiles("#fileInput", {
    name: "no-runtime-zone.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await page.locator("#ddZoneBtn").click();
  await page.locator("#ddZonePanel .ddAll").check();
  await expect(page.locator(".zone-lane-label")).toHaveText(["Z2", "Z10"]);

  const blocker = page.locator('.zone-block-mark[data-zone="10"]');
  await expect(blocker).toHaveCount(1);
  await expect(blocker).toHaveAttribute("aria-label", /Zone 10.*Disable/i);
  await blocker.click();
  const disableRow = page.locator(".feed-row").filter({ hasText: "Disable" });
  const detail = page.locator(`[data-fdetail="${await disableRow.getAttribute("data-idx")}"]`);
  await expect(detail).not.toHaveClass(/hidden/);
  await expect(detail).toContainText("06/17/26 06:12:00,ZN,DS,SY,ZN=10");

  await page.locator('.lane-label[data-prog="1"]').click();
  await expect(page.locator('.program-zone-lane-label[data-program="1"][data-zone="10"]')).toBeVisible();
});
