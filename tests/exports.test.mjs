// Export regression in a real browser: CSV/XLS output for the sample project
// must be byte-identical to the baseline, and the UI must render every tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readJSON} from './lib/engine.mjs';
import {exportResults, FIXTURE, BASELINE} from '../scripts/make-baseline.mjs';
import {launch, openApp} from './lib/browser.mjs';

const base = readJSON(BASELINE), st = readJSON(FIXTURE);

test('CSV and XLS exports are identical to baseline', async () => {
  const cur = await exportResults(st);
  assert.equal(cur.csv, base.exports.csv);
  assert.equal(cur.csvSha256, base.exports.csvSha256);
  assert.equal(cur.xlsSha256, base.exports.xlsSha256);
  assert.equal(cur.browserElementCount, 18);
  assert.ok(Math.abs(cur.browserTotals.grand - base.boq.totals.grand) < 1e-9);
});

test('CSV grand total line equals engine grand total (export reconciliation)', () => {
  const last = base.exports.csv.trim().split('\r\n').pop();
  assert.match(last, /TOTAL PROJECT COST/);
  const val = Number(last.split(',').pop().replace(/"/g, ''));
  assert.equal(val, Math.round(base.boq.totals.grand * 100) / 100);
});

test('every tab renders the sample project without page errors', async () => {
  const browser = await launch();
  try {
    const app = await openApp(browser, {state: st});
    for (const t of ['dashboard', 'project', 'elements', 'rebar', 'boq', 'audit', 'prices', 'factors', 'selftest']) {
      await app.page.evaluate(t => App.tab(t), t);
      assert.ok((await app.page.textContent('#view')).length > 50, `tab ${t} rendered`);
    }
    assert.equal(await app.page.textContent('#selftest-summary'), '8/8 passed');
    assert.deepEqual(app.errors, []);
    await app.close();
  } finally { await browser.close(); }
});
