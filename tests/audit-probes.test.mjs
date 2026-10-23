// Reproductions of the issues listed in AUDIT.md. Each test PASSES while the
// issue still exists (it asserts the faulty behaviour). When a phase fixes an
// issue, invert its test into a guarantee and move it to the relevant suite.
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

test('A-C01 5" CHB mortar coefficients are interpolated, not from a cited table; no factor has a source', () => {
  const html = fs.readFileSync(path.join(ROOT, 'estimator.html'), 'utf8');
  assert.match(html, /5" is interpolated/);
  assert.doesNotMatch(html, /source:\s*['"]/i, 'no coefficient carries a source citation');
});

// ---------- Browser / security / storage issues
test('A-H01 XSS: a project file can run script when opened (unescaped element qty)', async () => {
  const f = clone(fixture); f.elements[0].qty = '<img src=x onerror="window.__pwned=1">';
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('elements'));
  await app.page.waitForTimeout(200);
  assert.equal(await app.page.evaluate(() => window.__pwned), 1);
  await app.close();
});

test('A-H01b XSS: unescaped factor keys on the Factors tab', async () => {
  const f = clone(fixture); f.factors.concrete['<img src=x onerror="window.__pwned=2">'] = {cement: 1, sand: 1, gravel: 1};
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('factors'));
  await app.page.waitForTimeout(200);
  assert.equal(await app.page.evaluate(() => window.__pwned), 2);
  await app.close();
});

test('A-H01c XSS: element id injected into an inline onclick handler', async () => {
  const f = clone(fixture); f.elements[0].id = "x');window.__pwned=3;('";
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('elements'));
  await app.page.locator('button', {hasText: 'Edit'}).first().click();
  assert.equal(await app.page.evaluate(() => window.__pwned), 3);
  await app.close();
});

test('A-C04b autosave failure (storage full / blocked) is swallowed with no message', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await app.page.evaluate(() => App.addLevel());
  const visible = await app.page.evaluate(() => /not saved|failed|error/i.test(document.body.innerText));
  assert.equal(visible, false, 'user is not told the change was not saved');
  assert.deepEqual(app.errors, []);
  await app.close();
});

test('A-H02 "Open…" replaces the current project without confirmation or backup', async () => {
  const app = await openApp(browser, {state: fixture});
  const other = clone(fixture); other.project.name = 'Other job'; other.elements = [];
  const file = path.join(ROOT, 'tests/fixtures/.tmp-open.json');
  fs.writeFileSync(file, JSON.stringify(other));
  try {
    await app.page.setInputFiles('#fileIn', file);
    await app.page.waitForFunction(() => S.project.name === 'Other job');
    assert.equal(await app.page.evaluate(() => S.elements.length), 0, '18 elements replaced');
    assert.deepEqual(app.dialogs, [], 'no confirmation');
  } finally { fs.unlinkSync(file); }
  await app.close();
});

test('A-M02 CSV export allows formula injection from user-editable names', async () => {
  const f = clone(fixture); f.prices.CEM.name = '=HYPERLINK("http://example.invalid","x")';
  const app = await openApp(browser, {state: f});
  const csv = await app.page.evaluate(() => boqCsv());
  assert.ok(csv.includes('"=HYPERLINK('), 'cell starts with "=" and is not neutralised');
  await app.close();
});

test('A-M03 default project date uses UTC, so early-morning Manila gets yesterday', async () => {
  const app = await openApp(browser, {contextOptions: {timezoneId: 'Asia/Manila'}});
  const d = await app.page.evaluate(() => { const real = Date; const t = new real('2026-10-23T06:30:00+08:00').getTime();
    globalThis.Date = class extends real { constructor(...a) { super(...(a.length ? a : [t])); } }; return defaultState().project.date; });
  assert.equal(d, '2026-10-22');
  await app.close();
});

test('A-M10 duplicate element marks are accepted without warning', async () => {
  const f = clone(fixture); f.elements[1].mark = f.elements[0].mark;
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('elements'));
  assert.equal(await app.page.locator('td b', {hasText: /^F1$/}).count(), 2);
  await app.close();
});
