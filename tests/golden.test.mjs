// Golden-master regression: the engine must reproduce BASELINE_RESULTS.json
// exactly (within floating tolerance) for the 18-element sample project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEngine, readJSON} from './lib/engine.mjs';
import {engineResults, FIXTURE, BASELINE} from '../scripts/make-baseline.mjs';

const base = readJSON(BASELINE);
const cur = engineResults(loadEngine(), readJSON(FIXTURE));

// Deep compare with numeric tolerance; reports the first differing path.
function diff(a, b, p = '$') {
  if (typeof b === 'number' && typeof a === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) ? null : `${p}: ${a} != ${b}`;
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return `${p}: length ${a && a.length} != ${b.length}`;
    for (let i = 0; i < b.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  if (b && typeof b === 'object') {
    const ka = Object.keys(a || {}).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${p}: keys [${ka}] != [${kb}]`;
    for (const k of kb) { const d = diff(a[k], b[k], `${p}.${k}`); if (d) return d; }
    return null;
  }
  return a === b ? null : `${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

test('fixture is the one the baseline was recorded with', () => {
  assert.equal(cur.elements.length, 18);
  assert.equal(base.meta.elementCount, 18);
});

test('all 12 engine element types are covered by the fixture', () => {
  const E = loadEngine();
  assert.deepEqual([...base.meta.elementTypesCovered].sort(), Object.keys(E.TYPES).sort());
});

for (const [i, el] of base.elements.entries()) {
  test(`element ${el.mark} (${el.type}): bars, materials, labor match baseline`, () => {
    const d = diff(cur.elements[i], el, el.mark);
    assert.equal(d, null, d);
  });
}

test('per-level rebar purchase optimization matches baseline', () => {
  const d = diff(cur.estimate, base.estimate, 'estimate'); assert.equal(d, null, d);
});
test('BOQ rows match baseline', () => { const d = diff(cur.boq.rows, base.boq.rows, 'rows'); assert.equal(d, null, d); });
test('division totals and grand total match baseline', () => {
  const d = diff(cur.boq.divTotals, base.boq.divTotals, 'divTotals') || diff(cur.boq.totals, base.boq.totals, 'totals');
  assert.equal(d, null, d);
});
test('BOQ totals reconcile: direct cost = sum of line amounts', () => {
  const r = cur.reconciliation;
  assert.ok(Math.abs(r.sumOfUnroundedLineAmounts - r.directCost) < 1e-6);
});
test('built-in self-test: all hand-calculated examples pass', () => {
  const fails = cur.selfTest.filter(t => !t.ok);
  assert.equal(fails.length, 0, JSON.stringify(fails));
});
