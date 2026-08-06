# Zone Lanes and Progressive Audit Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep selected and program-linked zones visible without runtimes, mark their blocking events, and make every eligible audit-feed row reachable in progressive 1,500-row batches.

**Architecture:** Preserve the existing direct-DOM render pipeline in `src/app.js`. Build explicit program-to-zone links once per loaded file, index zone blockers once per swimlane render, and reuse existing event colors/feed navigation. Replace the permanent feed cap with one visible-prefix counter while leaving full-set search, sort, filtering, and alarm pinning unchanged.

**Tech Stack:** Vanilla ES modules, Chart.js 4.4.1, PapaParse 5.4.1, TailwindCSS v4, Playwright 1.61, Vitest 2.1.

## Global Constraints

- CSV/event-log contents never leave the browser.
- Do not add dependencies or change CSV parsing.
- Do not infer program membership without an event containing both `PG=` and `ZN=`; exclude `PG=MR`.
- Zone blockers are only Alarm/Error, Pause, Disable, Skip/Drop, and Configuration Error.
- `FEED_CAP` remains exactly `1500`, now as the batch size.
- Search, filters, sorting, alarm pinning, forced feed reveals, and print clipping retain their current semantics.
- Preserve the pre-existing untracked `Object_Definitions_19.8.6.html` without staging or modifying it.

---

### Task 1: Empty Zone Lanes and Blocking Markers

**Files:**
- Modify: `e2e/smoke.spec.js`
- Modify: `src/app.js:62-65,154-220,384-725,800-855`
- Modify: `src/styles.css:8-55`

**Interfaces:**
- Consumes: parsed events with `program`, `progEff`, `zones`, `isAlert`, `actCode`, `_id`, and `ts`; existing `eventGroupOf`, `whyText`, `numCmp`, `laneAll`, `laneSel`, `zoneRunInProgram`, `feedRowHTML`, and `flashFeedRow`.
- Produces: `programZones: Map<string, Set<string>>`, `.zone-lane-label`, `.program-zone-lane-label`, and `.zone-block-mark[data-eid]` DOM hooks used by Playwright and event delegation.

- [ ] **Step 1: Add the failing browser regression test**

Append this test to `e2e/smoke.spec.js` and update the file header to describe focused DOM regressions rather than “deliberately ONE test”:

```js
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
  await expect(page.locator('.feed-row:has-text("Disable") + [data-fdetail]:not(.hidden)')).toBeVisible();

  await page.locator('.lane-label[data-prog="1"]').click();
  await expect(page.locator('.program-zone-lane-label[data-program="1"][data-zone="10"]')).toBeVisible();
});
```

- [ ] **Step 2: Build and run the focused test to verify it fails**

Run:

```powershell
npm.cmd run build
npx.cmd playwright test e2e/smoke.spec.js --grep "shows no-runtime zones"
```

Expected: FAIL because `.zone-lane-label` and `.zone-block-mark` do not exist and the direct zone loop still derives keys from `zoneRuns`.

- [ ] **Step 3: Build explicit program-zone links once per loaded file**

Add this state beside `laneAll`:

```js
let programZones = new Map(); // explicit PG= + ZN= links found anywhere in the loaded CSV
```

In `onDataLoaded`, immediately after `inferEffectivePrograms(allEvents)`, rebuild it:

```js
programZones = new Map();
for (const e of allEvents) {
  if (e.program == null || String(e.program) === MANUAL_PROG_TAG || !e.zones.length) continue;
  const key = String(e.program);
  const zones = programZones.get(key) || new Set();
  for (const z of e.zones) zones.add(String(z));
  programZones.set(key, zones);
}
```

- [ ] **Step 4: Add minimal blocker selection and feed reveal helpers**

Add beside the swimlane constants:

```js
const ZONE_BLOCK_ACTIONS = new Set(["PA", "DS", "SK", "DR", "CE"]);
const isZoneBlocker = e => e.isAlert || ZONE_BLOCK_ACTIONS.has(e.actCode);
```

Add beside `focusFeedEvent`:

```js
function revealFeedEvent(e) {
  if (!e) return;
  revealedFeedIds.add(e._id);
  lastFeedSig = null;
  renderFeed();
  scrollPageTo($("feedScroll"), "nearest");
  const row = $("auditFeed").querySelector(`.feed-row[data-eid="${e._id}"]`);
  if (row) flashFeedRow(row);
}
```

- [ ] **Step 5: Index blocker events once and render reusable marker buttons**

Inside `renderSwimlane`, after `runTypeOk`, build the per-zone index for the current view:

```js
const blockersByZone = new Map();
for (const e of filtered) {
  const t = e.ts.getTime();
  if (!isZoneBlocker(e) || t < range.start || t >= range.end) continue;
  for (const z of e.zones) {
    const list = blockersByZone.get(String(z)) || [];
    list.push(e);
    blockersByZone.set(String(z), list);
  }
}
const blockerMarks = (zone, program = null) => (blockersByZone.get(String(zone)) || [])
  .filter(e => program == null || String(e.progEff) === String(program))
  .map(e => {
    const group = eventGroupOf(e);
    const title = `${fmtTime(e.ts.getTime(), range.end - range.start)} — Zone ${zone} — ${e.action}: ${whyText(e)}`;
    return `<button type="button" class="zone-block-mark" data-eid="${e._id}" data-zone="${escapeHtml(zone)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" style="left:${xOf(e.ts.getTime())}px;background:${group.color};"></button>`;
  }).join("");
```

This is one pass over `filtered`; do not scan the full event array once per zone.

- [ ] **Step 6: Render inventory-backed direct and program-child zone rows**

In the expanded-program block, replace the run-only `zKeys` with the union of runtime and explicit keys:

```js
const runKeys = sortedKeys(zoneRunsAll.filter(inProg));
const linkedKeys = [...(programZones.get(String(k)) || [])];
const zKeys = [...new Set([...runKeys, ...linkedKeys])].sort(numCmp);
```

Render each program child label and track with stable hooks and blocker buttons:

```js
const zlbl = `<span class="program-zone-lane-label" data-program="${escapeHtml(k)}" data-zone="${escapeHtml(z)}" style="${lblBase}color:#cbd5e1;padding-left:12px;" title="Zone ${escapeHtml(z)} in Program ${escapeHtml(k)}">↳ ${swatch(col)}Z${escapeHtml(z)}</span>`;
html += track(zlbl, zbars + blockerMarks(z, k), "rgba(148,163,184,0.04)");
```

In the standalone Zones block, derive keys from inventory rather than runs and render an empty-row tooltip when needed:

```js
const zKeys = laneAll.zone.filter(k => laneSel.zone.has(k));
for (const k of zKeys) {
  const col = zoneColor(k);
  const runs = zoneByKey.get(k) || [];
  const title = runs.length ? `Zone ${k}` : `Zone ${k} — no runtime in this window`;
  const label = `<span class="zone-lane-label" data-zone="${escapeHtml(k)}" style="color:#cbd5e1;${lblBase}" title="${escapeHtml(title)}">${swatch(col)}Z${escapeHtml(k)}</span>`;
  html += track(label, runs.map(iv => zoneBars(iv, xOf, range, col)).join("") + blockerMarks(k));
}
```

- [ ] **Step 7: Wire marker activation and styling**

At the top of the existing delegated swimlane click handler, before bar handling, add:

```js
const blocker = ev.target.closest(".zone-block-mark[data-eid]");
if (blocker) {
  ev.stopPropagation();
  revealFeedEvent(allEvents[Number(blocker.getAttribute("data-eid"))]);
  return;
}
```

Add to `src/styles.css` beside `.ev-mark`:

```css
.zone-block-mark { position:absolute; top:50%; width:9px; height:9px; padding:0; border:0; border-radius:2px;
  transform:translate(-50%, -50%) rotate(45deg); cursor:pointer; z-index:5; }
.zone-block-mark:hover, .zone-block-mark:focus-visible { outline:2px solid #e2e8f0; outline-offset:2px; }
```

- [ ] **Step 8: Build and run the focused test to verify it passes**

Run:

```powershell
npm.cmd run build
npx.cmd playwright test e2e/smoke.spec.js --grep "shows no-runtime zones"
```

Expected: PASS.

- [ ] **Step 9: Commit the independently working zone feature**

```powershell
git add -- src/app.js src/styles.css e2e/smoke.spec.js
git commit -m "Show empty zone lanes with blocker markers"
```

---

### Task 2: Progressive Audit Feed Batches

**Files:**
- Modify: `e2e/smoke.spec.js`
- Modify: `src/app.js:50-70,181-225,1070-1180`

**Interfaces:**
- Consumes: `FEED_CAP`, `selectFeedRows`, `revealedFeedIds`, `lastFeedSig`, `feedQuery`, `feedSortCol`, and the stable `#feedScroll`/`#auditFeed` containers.
- Produces: `feedLimit: number` and `.feed-load-more` delegated control.

- [ ] **Step 1: Add the failing progressive-feed browser test**

Append this test to `e2e/smoke.spec.js`:

```js
test("loads every feed event in progressive batches", async ({ page }) => {
  const rows = Array.from({ length: 1501 }, (_, i) => {
    const mm = String(Math.floor(i / 60)).padStart(2, "0");
    const ss = String(i % 60).padStart(2, "0");
    return `06/17/26 08:${mm}:${ss},SY,BT,SY,TX=Feed event ${i}`;
  });

  await page.goto("/");
  await page.setInputFiles("#fileInput", {
    name: "large-feed.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(rows.join("\n")),
  });

  await expect(page.locator(".feed-row")).toHaveCount(1500);
  await expect(page.locator("#feedInfo")).toContainText("1,500 of 1,501");
  await expect(page.locator("text=Feed event 1500")).toHaveCount(0);
  await page.locator(".feed-load-more").click();
  await expect(page.locator(".feed-row")).toHaveCount(1501);
  await expect(page.locator("text=Feed event 1500")).toHaveCount(1);
  await expect(page.locator(".feed-load-more")).toHaveCount(0);

  await page.locator("#feedSearch").fill("Feed event");
  await expect(page.locator(".feed-row")).toHaveCount(1500);
  await page.locator(".feed-load-more").click();
  await page.locator('.feed-sort[data-col="date"]').click();
  await expect(page.locator(".feed-row")).toHaveCount(1500);
});
```

- [ ] **Step 2: Build and run the focused test to verify it fails**

Run:

```powershell
npm.cmd run build
npx.cmd playwright test e2e/smoke.spec.js --grep "progressive batches"
```

Expected: FAIL because `.feed-load-more` does not exist and the 1,501st event cannot be reached.

- [ ] **Step 3: Add and reset the visible feed limit**

Add beside the feed state:

```js
let feedLimit = FEED_CAP;
```

Set `feedLimit = FEED_CAP` in `onDataLoaded` before `applyFilters`, and in `applyFilters` before `render()`.

Reset the limit in the debounced search callback:

```js
feedSearchTimer = setTimeout(() => {
  feedQuery = v;
  feedLimit = FEED_CAP;
  refreshFeed();
}, 150);
```

Reset it in the feed sort handler immediately before `refreshFeed()`:

```js
feedLimit = FEED_CAP;
refreshFeed();
```

- [ ] **Step 4: Change `renderFeed` from a permanent cap to a visible prefix**

Include `feedLimit` in the content signature:

```js
const sig = `${feedQuery}\u0001${feedSortCol}\u0001${feedSortDir}\u0001${filtered.length}\u0001${revealedFeedIds.size}\u0001${feedLimit}`;
```

Replace the fixed slice and forced-reveal loop with:

```js
const shown = ordered.slice(0, feedLimit);
for (const e of ordered.slice(feedLimit)) if (revealedFeedIds.has(e._id)) shown.push(e);
const total = ordered.length;
const remaining = Math.max(0, total - Math.min(total, feedLimit));
const next = Math.min(FEED_CAP, remaining);
const more = remaining
  ? `<div class="px-4 py-3 text-center border-t border-slate-800"><button type="button" class="feed-load-more bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 text-xs font-semibold px-4 py-2 rounded-md">Load ${next.toLocaleString()} more <span class="text-slate-500">(${remaining.toLocaleString()} remaining)</span></button></div>`
  : "";
host.innerHTML = shown.length
  ? shown.map((e, idx) => feedRowHTML(e, idx)).join("") + more
  : `<div class="px-5 py-8 text-center text-slate-500 text-sm">${searching ? "No events match your search." : "No events loaded."}</div>`;
```

Remove the later duplicate `const total = ordered.length`. Replace `feedInfo` assignment with:

```js
const noun = searching ? `match${total === 1 ? "" : "es"}` : `event${total === 1 ? "" : "s"}`;
$("feedInfo").textContent = total
  ? `Showing ${shown.length.toLocaleString()} of ${total.toLocaleString()} ${noun}${alertCount ? ` · ${alertCount} alerts` : ""}`
  : searching ? "0 matches across all events" : "0 events";
```

- [ ] **Step 5: Handle Load More through existing delegation**

At the top of the `#auditFeed` delegated click handler, add:

```js
const more = ev.target.closest(".feed-load-more");
if (more) {
  const box = $("feedScroll");
  const top = box.scrollTop;
  feedLimit += FEED_CAP;
  renderFeed();
  box.scrollTop = top;
  return;
}
```

No new listener, pagination state, or virtual row component is needed.

- [ ] **Step 6: Build and run the focused test to verify it passes**

Run:

```powershell
npm.cmd run build
npx.cmd playwright test e2e/smoke.spec.js --grep "progressive batches"
```

Expected: PASS.

- [ ] **Step 7: Commit the independently working feed feature**

```powershell
git add -- src/app.js e2e/smoke.spec.js
git commit -m "Load the full audit feed in batches"
```

---

### Task 3: Documentation and Full Verification

**Files:**
- Modify: `src/app.js:1565-1610` (in-app guide copy)
- Modify: `index.html:52-70,255-285` (tooltips/feed summary copy if needed)
- Modify: `docs/HOW_TO_USE.md`
- Modify: `docs/DEMO_GUIDE.md`
- Modify: `NOTES.md`
- Modify: `AI_HANDOFF.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: accurate user/developer documentation and a verified build.

- [ ] **Step 1: Update user-facing help text**

Make these statements explicit in both `buildGuide()` and `docs/HOW_TO_USE.md`:

```text
Selected zones keep a timeline row even when they have no runtime in the current window. Blocking alarms, pauses, disables, skips/drops, and configuration errors appear as clickable diamonds on that zone’s row.
```

```text
The Activity Audit Feed searches and sorts the whole matching log. It renders the first 1,500 rows for responsiveness; use Load 1,500 more until every matching row is shown.
```

Update the Zones dropdown tooltip in `index.html` to say selected zones remain visible without runtimes. Remove wording in `docs/DEMO_GUIDE.md` that calls the feed permanently capped.

- [ ] **Step 2: Update developer handoff documentation**

In `NOTES.md`, document:

```text
- Zone row keys come from the selected inventory, not only run intervals.
- Expanded programs add explicit PG= + ZN= links but never guess membership.
- Zone blocker markers reuse EVENT_GROUPS colors and reveal their exact feed row.
- FEED_CAP is a progressive batch size, not a permanent cap; feedLimit resets only when feed ordering changes.
```

Prepend an `AI_HANDOFF.md` Last session entry summarizing both changes, their tests, and the unchanged privacy behavior. Update Current state to replace “feed cap” with progressive batches.

- [ ] **Step 3: Run unit tests**

Run:

```powershell
npm.cmd run test:run
```

Expected: all existing Vitest tests pass.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm.cmd run build
```

Expected: Vite exits 0 and emits `dist/` with no build errors.

- [ ] **Step 5: Run all browser tests**

Run:

```powershell
npx.cmd playwright test e2e/smoke.spec.js
```

Expected: the original smoke plus both new regressions pass with zero console errors in the original smoke.

- [ ] **Step 6: Check the final diff and repository state**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended source, test, and documentation changes are listed. `Object_Definitions_19.8.6.html` remains untracked and unstaged.

- [ ] **Step 7: Commit documentation**

```powershell
git add -- src/app.js index.html docs/HOW_TO_USE.md docs/DEMO_GUIDE.md NOTES.md AI_HANDOFF.md
git commit -m "Document complete zone and audit visibility"
```
