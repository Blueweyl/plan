// Reproductions of the OPEN issues listed in AUDIT.md. Each test PASSES while the
// issue still exists (it asserts the faulty behaviour). When a phase fixes an
// issue, its test is inverted into a guarantee and moved to that phase's suite
// (Phase 1: tests/phase1.test.mjs, tests/migration.test.mjs; Phase 2: tests/phase2.test.mjs).
// The engine itself is frozen: issues it cannot report are detected by the auditor instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadEngine, readJSON, ROOT} from './lib/engine.mjs';
import {launch, openApp, STORAGE_KEY} from './lib/browser.mjs';

const E = loadEngine(), F = () => E.defaultFactors();
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const clone = x => JSON.parse(JSON.stringify(x));
const lines = (o, code) => o.lines.filter(l => l.code === code).reduce((s, l) => s + l.qty, 0);
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

// ---------- Calculation / input issues (engine only)
test('A-M06 round() half-way cases are wrong due to binary floating point (1.005 → 1)', () => {
  assert.equal(E.round(1.005, 2), 1);
  assert.equal(E.qtyRound(1.005, 'm²'), 1);
});

test('A-M01 BOQ line amounts are not rounded to centavos; displayed lines may not add up to the total', () => {
  const st = clone(fixture); st.prices.SAND.price = 1333.333;
  const b = E.buildBOQ(st), amts = b.rows.filter(r => r.kind === 'mat' || r.kind === 'lab').map(r => r.amt);
  assert.ok(amts.some(a => Math.abs(a * 100 - Math.round(a * 100)) > 1e-6), 'some line amounts have sub-centavo fractions');
});

test('A-L05 slab "top bars at supports" adds bars but no tie-wire intersections', () => {
  const a = E.computeElement({type: 'slab', inp: {top: 'none'}}, F()), b = E.computeElement({type: 'slab', inp: {top: 'supports'}}, F());
  assert.ok(b.bars.length > a.bars.length);
  assert.equal(b.x, a.x);
});

test('A-C01 (open) coefficients have a recorded source but are unverified; 5" CHB mortar is interpolated', async () => {
  const app = await openApp(browser);
  const fm = await app.page.evaluate(() => defaultFactorMeta());
  await app.close();
  assert.match(fm['concrete.A.cement'].source, /Fajardo/);
  assert.equal(fm['concrete.A.cement'].verified, false, 'not yet checked against the book');
  assert.equal(fm['chb.mortar.5.B'].source, 'None – interpolated');
  assert.equal(Object.values(fm).filter(m => m.verified).length, 8, 'only geometry and policy settings start verified');
});

// ---------- Browser / security / storage issues
