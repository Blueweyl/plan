// Records the golden-master baseline for the sample project:
// per-element bars/materials/labor, per-level rebar optimization, BOQ rows,
// totals, self-test results and the exact CSV / XLS export text.
// Usage: node scripts/make-baseline.mjs [--check]   (--check compares instead of writing)
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, APP_HTML, ORIGINAL_HTML, loadEngine, readJSON, plain, sha256} from '../tests/lib/engine.mjs';
import {launch, openApp, APP_URL} from '../tests/lib/browser.mjs';

export const ORIGINAL_URL = 'file://' + ORIGINAL_HTML;

export const FIXTURE = 'tests/fixtures/sample-18.estimate.json';
export const BASELINE = 'BASELINE_RESULTS.json';

export function engineResults(E, st) {
  const elements = st.elements.map(el => {
    const r = plain(E.computeElement(el, st.factors));
    return {id: el.id, mark: el.mark, type: el.type, level: el.level, qty: el.qty, inputs: plain(E.normInputs(el.type, el.inp)),
      bars: r.bars, lines: r.lines, labor: r.labor, intersections: r.x, rebarKgNet: r.kg, info: r.info};
  });
  const estimate = plain(E.buildEstimate(st)).map(({level, divs}) => ({
    level: level.id,
    divisions: Object.fromEntries(Object.entries(divs).map(([k, d]) => [k, {materials: d.lines, labor: d.labor, intersections: d.x, rebarPurchase: d.rebar}])),
  }));
  const boq = plain(E.buildBOQ(st));
  const lineAmts = boq.rows.filter(r => r.kind === 'mat' || r.kind === 'lab').map(r => r.amt);
  const reconciliation = {
    sumOfUnroundedLineAmounts: lineAmts.reduce((a, b) => a + b, 0),
    sumOfLineAmountsRoundedToCentavo: lineAmts.reduce((a, b) => a + Math.round(b * 100) / 100, 0),
    directCost: boq.totals.direct,
  };
  return {elements, estimate, boq: {rows: boq.rows, divTotals: boq.divTotals, totals: boq.totals}, reconciliation, selfTest: plain(E.runSelfTests())};
}

export async function exportResults(st, url = APP_URL) {
  const browser = await launch();
  try {
    const app = await openApp(browser, {state: st, url});
    const out = await app.page.evaluate(() => ({csv: boqCsv(), xls: boqHtmlTable(true), boqTotals: buildBOQ(S).totals, elementCount: S.elements.length}));
    if (app.errors.length) throw new Error('Page errors: ' + app.errors.join('; '));
    await app.close();
    return {csv: out.csv, csvSha256: sha256(out.csv), xlsSha256: sha256(out.xls), xlsLength: out.xls.length, browserTotals: out.boqTotals, browserElementCount: out.elementCount};
  } finally { await browser.close(); }
}

// The baseline is always recorded from the untouched original (engine v1), so
// later app changes cannot move the reference they are tested against.
export async function buildBaseline() {
  const E = loadEngine(ORIGINAL_HTML), st = readJSON(FIXTURE);
  const res = engineResults(E, st);
  const exp = await exportResults(st, ORIGINAL_URL);
  const types = [...new Set(st.elements.map(e => e.type))];
  return {
    meta: {
      description: 'Golden-master baseline for estimator.html (engine v1) using the 18-element sample project. Regenerate only after an intended, reviewed formula change.',
      recordedFrom: 'original/estimator.v1.html (engine and exports)',
      originalCopy: 'original/estimator.v1.html', originalSha256: sha256(fs.readFileSync(path.join(ROOT, 'original/estimator.v1.html'))),
      fixture: FIXTURE, fixtureSha256: sha256(fs.readFileSync(path.join(ROOT, FIXTURE))),
      elementCount: st.elements.length, elementTypesCovered: types, allEngineTypes: Object.keys(E.TYPES),
      comparisonTolerance: 'numbers: |a-b| <= 1e-9 * max(1,|b|); strings exact',
    },
    ...res,
    exports: exp,
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const b = await buildBaseline();
  const file = path.join(ROOT, BASELINE);
  if (process.argv.includes('--check')) {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const same = JSON.stringify({...old, meta: null}) === JSON.stringify({...b, meta: null});
    console.log(same ? 'Baseline unchanged' : 'Baseline DIFFERS'); process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(file, JSON.stringify(b, null, 1) + '\n');
  const t = b.boq.totals;
  console.log(`Wrote ${BASELINE}: ${b.elements.length} elements, ${b.boq.rows.length} BOQ rows, grand total ₱${t.grand.toFixed(2)}`);
  console.log('Self-test:', b.selfTest.filter(x => x.ok).length + '/' + b.selfTest.length, '| browser total matches engine:', Math.abs(b.exports.browserTotals.grand - t.grand) < 1e-9);
  console.log('Reconciliation:', b.reconciliation);
}
