// Reproductions of the OPEN issues listed in AUDIT.md. Each test PASSES while the
// issue still exists (it asserts the faulty behaviour). When a phase fixes an
// issue, its test is inverted into a guarantee and moved to that phase's suite
// (Phase 1 fixes: tests/phase1.test.mjs and tests/migration.test.mjs).
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
test('A-C02 rebar silently disappears from the BOQ when no commercial length exceeds the lap', () => {
  const st = clone(fixture); st.settings.stock = '6'; st.factors.rebar.lapFactor = 400;   // 16mm lap = 6.4 m > 6 m stock
  const est = E.buildEstimate(st);
  const g = est[0].divs.REBAR;
  assert.ok(g.bars.get(16).length > 0, '16mm bars were scheduled');
  assert.equal(g.lines.has('RB16'), false, 'but no 16mm line reaches the BOQ and no warning is raised');
});

test('A-H04 negative, empty and NaN dimensions produce zero quantities with no warning', () => {
  for (const H of [-3, '', 'abc', NaN]) {
    const o = E.computeElement({type: 'column', inp: {H}}, F());
    assert.equal(o.lines.length, 0, `H=${String(H)}: no concrete`);
    assert.ok(!o.info.some(([k]) => /error|invalid|⚠/i.test(k)), `H=${String(H)}: no warning`);
  }
});

test('A-H05 zero spacing silently drops bars; cover larger than the section gives an absurd tie length', () => {
  const z = E.computeElement({type: 'slab', inp: {sBx: 0, sBy: 0}}, F());
  assert.equal(z.bars.filter(b => /Bottom/.test(b.desc)).length, 0, 'spacing 0 → no bottom bars');
  const c = E.computeElement({type: 'column', inp: {b: 0.05, h: 0.05, cover: 40}}, F());
  const tie = c.bars.find(b => b.desc === 'Ties');
  assert.equal(tie.len, 0.03, 'negative inner perimeter + 2 hooks → 30 mm tie accepted without warning');
});

test('A-M05 openings larger than the wall clamp net area to zero silently', () => {
  const o = E.computeElement({type: 'chbwall', inp: {L: 2, H: 2, open: '3x3'}}, F());
  assert.equal(lines(o, 'CHB4'), 0);
  assert.ok(!o.info.some(([k]) => /⚠/.test(k)));
});

test('A-M04 fractional element quantity is silently rounded (2.5 → 3)', () => {
  const st = clone(fixture); st.elements = [{...st.elements[2], qty: 2.5}];   // C1 column, 0.48 m³ each
  const conc = E.buildEstimate(st)[0].divs.CONC.labor.get('L_CONC');
  assert.ok(Math.abs(conc - 3 * 0.48) < 1e-9);
});

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
test('A-M02 CSV export allows formula injection from user-editable names', async () => {
  const f = clone(fixture); f.prices.CEM.name = '=HYPERLINK("http://example.invalid","x")';
  const app = await openApp(browser, {state: f});
  const csv = await app.page.evaluate(() => boqCsv());
  assert.ok(csv.includes('"=HYPERLINK('), 'cell starts with "=" and is not neutralised');
  await app.close();
});

test('A-M10 duplicate element marks are accepted without warning', async () => {
  const f = clone(fixture); f.elements[1].mark = f.elements[0].mark;
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('elements'));
  assert.equal(await app.page.locator('td b', {hasText: /^F1$/}).count(), 2);
  await app.close();
});
