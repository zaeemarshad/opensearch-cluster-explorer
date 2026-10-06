/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] || process.env.DASHBOARDS_URL || 'http://127.0.0.1:15601';
const index = process.env.SMOKE_INDEX || 'cluster-explorer-demo';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let snapshots = 0;
  page.on('request', request => { if (request.url().includes('/api/cluster_explorer/snapshot')) snapshots++; });
  await page.goto(`${base}/app/clusterExplorer`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const shard = page.getByRole('button', {
    name: new RegExp(`^${index}, shard \\d+, primary, Started,`),
  }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await shard.waitFor({ timeout: 20000 }); break; }
    catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(5000);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    }
  }
  assert.equal(await page.getByLabel('Refresh interval').inputValue(), '0');
  if (process.env.SMOKE_RATES === '1') {
    const before = snapshots;
    for (let n = 0; n < 3; n++) {
      const search = await fetch(`http://127.0.0.1:19200/${index}/_search?size=0`);
      assert.equal(search.status, 200);
    }
    await page.waitForTimeout(31000);
    assert.equal(snapshots, before, 'Manual mode must not poll');
    const refreshed = page.waitForResponse(r => r.url().includes('/api/cluster_explorer/snapshot'));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    assert.equal((await refreshed).status(), 200);
    await page.getByRole('tab', { name: 'Indices', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: index, exact: true }) });
    await row.getByRole('cell').nth(5).getByText('0', { exact: true }).waitFor();
    const searchRate = Number(await row.getByRole('cell').nth(6).innerText());
    assert.ok(searchRate > 0, `Expected a measured search rate, got ${searchRate}`);
    await page.getByRole('tab', { name: 'Allocation', exact: true }).click();
    console.log('PASS: no default polling for 31s; second sample shows a positive live search rate.');
  }
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/cluster_explorer/shard') && response.request().method() === 'POST');
  await shard.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const details = await response.json();
  assert.ok(details.metrics.documents > 0, JSON.stringify(details));
  assert.ok(details.metrics.segments > 0, JSON.stringify(details));
  const metrics = page.getByLabel('Key shard metrics');
  await metrics.waitFor();
  for (const [label, value] of [['Live documents', details.metrics.documents], ['Segments', details.metrics.segments]]) {
    const panel = metrics.locator('.euiPanel').filter({ has: page.getByText(label, { exact: true }) });
    await panel.getByText(value.toLocaleString('en-AU'), { exact: true }).waitFor();
    assert.equal(await panel.locator('strong').innerText(), value.toLocaleString('en-AU'));
  }
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  const screenshot = process.argv[3] || process.env.SMOKE_SCREENSHOT;
  if (screenshot) await page.screenshot({ path: screenshot, animations: 'disabled' });
  console.log(`PASS: clicked shard; flyout displays ${details.metrics.documents} live documents and ${details.metrics.segments} segments.`);
} finally {
  await browser.close();
}
