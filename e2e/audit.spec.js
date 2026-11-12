import { test, expect } from '@playwright/test';

const load = async (page, csv, name = 'audit.csv') => {
  await page.setInputFiles('#fileInput', { name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#importStatus')).not.toContainText('Parsing ');
};
const history = [
  '06/17/26 08:00:00,PG,SR,DT,PG=1',
  '06/17/26 08:00:00,ZN,WT,SY,PG=1,ZN=1',
  '06/17/26 13:00:00,ZN,DN,SY,ZN=1',
  '06/17/26 13:00:00,PG,DN,SY,PG=1',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.goto('/');
});
test.afterEach(async ({ page }) => {
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

test('rejects injected/invalid CSV atomically and reports skipped rows', async ({ page }) => {
  await load(page, '06/17/26 08:00:00,SY,BT,SY,TX=original', 'original.csv');
  await load(page, '06/17/26 08:00:00<img src=x onerror=window.__auditXss=1>,SY,BT,SY');
  expect(await page.evaluate(() => window.__auditXss)).toBeUndefined();
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineScriptRan = true';
    document.head.append(script);
  });
  expect(await page.evaluate(() => window.__inlineScriptRan)).toBeUndefined();
  await expect(page.locator('#fileName')).toHaveText('original.csv');
  await expect(page.locator('.feed-row')).toHaveCount(1);
  await load(page, '06/17/26 08:00:00,SY,ST,SY,"TX=unterminated');
  await expect(page.locator('#fileName')).toHaveText('original.csv');
  await expect(page.locator('#importStatus')).toContainText(/CSV|quoted|parse/i);
  await load(page, '02/31/26 08:00:00,SY,BT,SY\n06/17/26 08:00:00,SY,BT,SY,TX=valid');
  await expect(page.locator('#importStatus')).toContainText('1');
  await expect(page.locator('#importStatus')).toContainText(/skipped/i);
});

test('keeps complete run durations while filtering and counts expanded zones once', async ({ page }) => {
  await load(page, history);
  const bar = page.locator('.tl-bar[data-group="Program"]');
  const before = await bar.getAttribute('data-end');
  await page.locator('summary').filter({ hasText: 'More filters' }).click();
  await page.locator('#actionFilter').selectOption({ label: 'Start' });
  await expect(bar).toHaveAttribute('data-end', before);
  await page.locator('.lane-label[data-prog="1"]').click();
  await expect(page.locator('.scrub-run[data-group="Zone"]')).toHaveCount(1);
  await expect(page.locator('#statRuns')).toHaveText('2');
  await page.locator('#ddZoneBtn').click();
  await page.locator('#ddZoneList .ddItem').check();
  await expect(page.locator('#statRuns')).toHaveText('2');
});

test('handles unordered, invalid and priority telemetry with pressure-only support', async ({ page }) => {
  await load(page, '06/17/26 14:00:00,SY,ST,SY,AC=30\n06/17/26 08:00:00,SY,ST,SY,AC=10\n06/17/26 08:01:00,MG,ST,SY,PR=HI\n06/17/26 08:02:00,SY,ST,SY,AC=unavailable');
  await page.locator('#showAdvanced').check();
  await expect(page.locator('#scrubBody')).toContainText('37.9 L/min');
  await page.locator('[data-win="hour"]').click();
  await expect(page.locator('#scrubBody')).toContainText('37.9 L/min');
  await page.locator('#flowOn').check();
  await load(page, '06/17/26 08:00:00,SY,ST,SY,PR=60');
  await expect(page.locator('#scrubBody')).toContainText('413.6 kPa');
});

test('reveals exact marker across pagination and active search', async ({ page }) => {
  const rows = Array.from({ length: 1502 }, (_, i) => `06/17/26 08:${String(Math.floor(i / 60)).padStart(2,'0')}:${String(i % 60).padStart(2,'0')},SY,ST,SY,TX=event-${i}`);
  rows.push('06/17/26 08:25:01,SY,ST,SY,TX=same-second');
  await load(page, rows.join('\n'));
  await page.locator('#eventTlOn').check();
  await page.locator('.ev-mark[data-eid="1502"]').click({ force: true });
  await expect(page.locator('.feed-row[data-eid="1502"]')).toHaveClass(/feed-flash/);
  await expect(page.locator('[data-fdetail="1502"]')).not.toHaveClass(/hidden/);
  await page.locator('#feedSearch').fill('event-0');
  await expect(page.locator('#feedInfo')).toContainText(/match/);
  // Coincident markers overlap visually; keyboard activation chooses the exact event.
  await page.locator('.ev-mark[data-eid="1501"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.feed-row[data-eid="1501"]')).toHaveClass(/feed-flash/);
});

test('appends feed batches and creates details only on demand', async ({ page }) => {
  const rows = Array.from({ length: 1501 }, (_, i) => `06/17/26 08:00:00,SY,BT,SY,TX=event-${i}`);
  await load(page, rows.join('\n'));
  const nodes = await page.locator('#auditFeed *').count();
  console.log(`Initial 1,500-row feed: ${nodes} descendants`);
  expect(nodes).toBeLessThan(18000);
  await expect(page.locator('[data-fdetail="0"]')).toBeEmpty();
  await page.locator('.feed-expand').first().click();
  await expect(page.locator('[data-fdetail="0"]')).toContainText('event-0');
  await page.locator('.feed-load-more').click();
  await expect(page.locator('.feed-row')).toHaveCount(1501);
  await expect(page.locator('[data-fdetail="0"]')).not.toHaveClass(/hidden/);
  await load(page, history);
  await page.locator('#feedSearch').fill('Water');
  await expect(page.locator('.feed-row')).toHaveCount(1);
});

test('resizes overlays and supports mobile layout, keyboard controls and dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page, history);
  const bar = page.locator('.tl-bar[data-group="Program"]');
  const original = await bar.evaluate(el => el.style.left);
  await page.setViewportSize({ width: 1150, height: 1000 });
  await expect.poll(() => bar.evaluate(el => el.style.left)).not.toBe(original);
  await page.locator('#guideBtn').click();
  await expect(page.locator('#guideModal')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#guideBtn')).toBeFocused();
  await page.locator('.lane-label[data-prog="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.program-zone-lane-label')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('main').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('ignores obsolete imports and rejects oversized files without losing the active log', async ({ page }) => {
  // Delay only the first actual FileReader operation, allowing the newer import to complete first.
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function (...args) {
      if (!window.__releaseRead) {
        this.addEventListener('loadend', () => { window.__oldReadEnded = true; });
        window.__releaseRead = () => read.apply(this, args);
      } else read.apply(this, args);
    };
  });
  await page.setInputFiles('#fileInput', { name: 'older.csv', mimeType: 'text/csv', buffer: Buffer.from(history) });
  await expect(page.locator('#importStatus')).toContainText('Parsing');
  await load(page, '06/17/26 08:00:00,SY,BT,SY,TX=newest', 'newest.csv');
  await page.evaluate(() => window.__releaseRead());
  await expect.poll(() => page.evaluate(() => window.__oldReadEnded)).toBe(true);
  await expect(page.locator('#fileName')).toHaveText('newest.csv');
  await expect(page.locator('.feed-row')).toHaveCount(1);
  await page.setInputFiles('#fileInput', { name: 'oversized.csv', mimeType: 'text/csv', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 'a') });
  await expect(page.locator('#importStatus')).toContainText('exceeds 20 MB');
  await expect(page.locator('#fileName')).toHaveText('newest.csv');
  await expect(page.locator('.feed-row')).toHaveCount(1);
});

test('preserves centered navigation, keyboard time controls and print cleanup', async ({ page }) => {
  await load(page, history);
  await page.locator('[data-win="hour"]').click();
  const before = await page.locator('#dateFrom').inputValue();
  await page.locator('#navNext').click();
  const after = await page.locator('#dateFrom').inputValue();
  expect(Date.parse(after + 'Z') - Date.parse(before + 'Z')).toBe(3600000);
  await page.locator('#playhead').focus();
  await page.keyboard.press('Home');
  const slider = page.locator('#playhead');
  expect(await slider.getAttribute('aria-valuenow')).toBe(await slider.getAttribute('aria-valuemin'));
  await page.keyboard.press('End');
  expect(await slider.getAttribute('aria-valuenow')).toBe(await slider.getAttribute('aria-valuemax'));
  await page.locator('[data-win="all"]').click();
  await page.locator('#miniMap').focus();
  const from = await page.locator('#dateFrom').inputValue();
  await page.keyboard.press('+');
  await expect(page.locator('#dateFrom')).not.toHaveValue(from);
  for (const name of ['ref', 'feedback']) {
    await page.locator(`#${name}Btn`).click();
    await expect(page.locator(`#${name}Modal`)).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator(`#${name}Btn`)).toBeFocused();
  }
  await page.evaluate(() => {
    window.print = () => {
      window.__printedWidth = document.getElementById('dashboard').style.width;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.locator('#pdfBtn').click();
  await expect.poll(() => page.evaluate(() => window.__printedWidth)).toBe('1024px');
  await expect(page.locator('.pdf-stamp')).toHaveCount(0);
  expect(await page.locator('#dashboard').evaluate(el => el.style.width)).toBe('');
});

test('profiles a 20,000-event synthetic import with a bounded initial feed', async ({ page }) => {
  const csv = Array.from({ length: 20000 }, (_, i) => `06/17/26 08:00:00,SY,BT,SY,ZN=${200-i%200},TX=synthetic event ${i}`).join('\n');
  const start = performance.now();
  await load(page, csv);
  await expect(page.locator('.feed-row')).toHaveCount(1500);
  const loaded = performance.now();
  await page.locator('.feed-sort[data-col="subject"]').click();
  await expect(page.locator('.feed-row').first()).toContainText('Zone 1');
  console.log(`20,000-event synthetic import: ${Math.round(loaded-start)} ms; first subject sort: ${Math.round(performance.now()-loaded)} ms; CSV ${(Buffer.byteLength(csv)/1024/1024).toFixed(2)} MB`);
});

test('keyboard pan keeps the minimap window width at the data edge', async ({ page }) => {
  await load(page, history);
  await page.locator('[data-win="hour"]').click();
  const mini = page.locator('#miniMap'), box = page.locator('#miniWindow');
  await mini.focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowLeft'); // move well inside the 5 h log
  const width = (await box.boundingBox()).width;
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // pan past the right edge
  expect(Math.abs((await box.boundingBox()).width - width)).toBeLessThan(1);
});

test('outside click closes a lane dropdown and resets aria-expanded', async ({ page }) => {
  await load(page, history);
  await page.locator('#ddZoneBtn').click();
  await expect(page.locator('#ddZoneBtn')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#auditFeed').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#ddZoneBtn')).toHaveAttribute('aria-expanded', 'false');
});
