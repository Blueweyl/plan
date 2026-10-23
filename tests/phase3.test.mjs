// Phase 3: expanded calculators. Legacy results must be identical with the
// modules loaded; every module has a schema, documented rules, a trace,
// hand-calculated examples, validation, and never guesses a coefficient.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAuditor, readJSON, plain} from './lib/engine.mjs';
import {engineResults} from '../scripts/make-baseline.mjs';
import {launch, openApp} from './lib/browser.mjs';

const A = loadAuditor(), TODAY = '2026-10-23';
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const BASE = readJSON('BASELINE_RESULTS.json');
const clone = x => JSON.parse(JSON.stringify(x));
const MODULE_TYPES = Object.entries(A.TYPES).filter(([, t]) => t.module).map(([k]) => k);
const LEGACY_DIVS = ['REBAR', 'CONC', 'FORM', 'MAS', 'PART', 'CEIL'];
let browser, V2;
test.before(async () => {
  browser = await launch();
  const app = await openApp(browser);
  V2 = await app.page.evaluate(raw => migrate(raw).state, fixture);
  await app.close();
});
test.after(async () => { await browser.close(); });

// One fully specified element of every module type (inputs as an estimator would enter them)
const SPEC = {
  excavation: {mode: 'pit', L: 1.5, W: 1.5, D: 1.5, ws: 0.3, slope: 0.5, struct: 1.076, haul: true, equip: true},
  roofing: {form: 'gable', L: 10, W: 8, oh: 0.6, pitch: 20, cw: 0.76, sheetCost: 450, ridgeLen: 2.4, ridgeCost: 380, waste: 5, psp: 0.6, pstock: 6, purlinCost: 620, gutter: true, gutterCost: 300},
  tiles: {surf: 'floor', L: 4, W: 5, tw: 600, th: 600, tt: 10, jw: 3, waste: 5, perBox: 4, tileCost: 120, skirt: true, skh: 100, doorW: 0.9},
  waterproof: {L: 3, W: 4, up: 0.3, sys: 'liquid', coats: 2, pack: 20, unitCost: 3500, primer: true, primerPack: 4, primerCost: 900},
  painting: {surf: 'wall', L: 18, H: 3, open: '0.9x2.1x1', pc: 1, fc: 2, cont: 4, primerCost: 700, finishCost: 950, putty: true, puttyBag: 20, puttyCost: 600},
  opening: {kind: 'door', desc: 'D1 flush door', w: 0.9, h: 2.1, unitCost: 8500, lockset: true, lockCost: 1200, sealant: true, sides: 2, cartLen: 6, sealCost: 250},
  steel: {kind: 'member', sect: 'W8x31', uw: 46.1, len: 6, conn: 5, waste: 2, bolts: 8, equip: true, craneHr: 0.5},
  plumbing: {cat: 'pipe', desc: 'PVC 4" S1000', qin: 25, stock: 3, waste: 5, unitCost: 650},
  electrical: {cat: 'wire', desc: 'THHN 3.5 mm²', qin: 230, pack: 150, waste: 5, unitCost: 4200},
};
const TEST_FACTORS = {earth: {swellPct: 25}, roof: {screwsPerSqm: 6}, tile: {adhesiveKgPerSqm: 5, adhesiveBagKg: 25, groutDensity: 1600},
  waterproof: {liquidKgPerSqmPerCoat: 1, primerLPerSqm: 0.2}, paint: {primerCoverage: 10, finishCoverage: 25, puttyKgPerSqm: 1.2}, steel: {density: 7850}};
const withModules = ({factors = true} = {}) => {
  const st = clone(V2);
  MODULE_TYPES.forEach((t, n) => st.elements.push({id: 'm-' + t, type: t, mark: A.TYPES[t].prefix + '9' + n, level: st.levels[n % 2].id, qty: t === 'opening' ? 4 : 1, inp: A.normInputs(t, SPEC[t])}));
  if (factors) for (const [g, o] of Object.entries(TEST_FACTORS)) Object.assign(st.factors[g], o);
  for (const c of ['TADH', 'TGRT', 'RSCR', 'STL', 'BOLT']) { st.prices[c].price = 10; st.prices[c].source = 'user'; }
  return st;
};
const audit = st => plain(A.runAudit(st, {today: TODAY}));
const rules = st => audit(st).findings.map(f => f.ruleId);

test('P3-01 legacy golden master is identical with the modules and auditor loaded', () => {
  const cur = engineResults(A, fixture);
  for (const k of ['elements', 'estimate', 'boq', 'reconciliation']) assert.deepEqual(JSON.parse(JSON.stringify(cur[k])), BASE[k], k);
});

test('P3-02 hand-calculated module examples pass (in-app self-test)', () => {
  const r = plain(A.runModuleSelfTests());
  assert.equal(r.length, 10);
  assert.deepEqual(r.filter(x => !x.ok), []);
});

test('P3-03 every module defines schema, division, documentation and a trace', () => {
  assert.equal(MODULE_TYPES.length, 9);
  for (const t of MODULE_TYPES) {
    const T = A.TYPES[t];
    assert.ok(T.fields.some(f => f.k) && A.DIV_NAME[T.div], t);
    for (const k of ['measure', 'conversions', 'net', 'deductions', 'waste', 'purchase', 'materials', 'labor', 'equipment', 'sources']) assert.ok(T.doc && T.doc[k], `${t}.doc.${k}`);
    const o = plain(A.computeElement({type: t, inp: SPEC[t]}, withModules().factors));
    assert.ok(o.trace.length >= 1, t + ' trace');
    for (const [label, formula] of o.trace) assert.ok(label && formula, t);
  }
});

test('P3-04 a new element with default (empty) inputs is never silently priced', () => {
  for (const t of MODULE_TYPES) {
    const st = clone(V2); st.elements = [{id: 'z', type: t, mark: 'Z1', level: st.levels[0].id, qty: 1, inp: A.normInputs(t, {})}];
    const f = audit(st).findings.filter(f => f.refs.elementIds.includes('z'));
    assert.ok(f.some(x => x.severity === 'critical'), `${t}: empty inputs must raise a critical finding`);
  }
});

test('P3-05 optional zero inputs are accepted; irrelevant fields are not checked', () => {
  const ok = (t, inp) => plain(A.elementChecks({type: t, mark: 'X', qty: 1, inp: A.normInputs(t, inp)}, withModules().factors)).map(c => c.rule);
  assert.deepEqual(ok('excavation', {L: 2, W: 2, D: 1}), [], 'working space, slope and structure may be 0');
  assert.deepEqual(ok('roofing', {form: 'shed', L: 6, W: 4, pitch: 10, cw: 0.76, sheetCost: 1}), [], 'shed roof: no ridge fields required');
  assert.ok(ok('roofing', {form: 'gable', L: 6, W: 4, pitch: 10, cw: 0.76, sheetCost: 1}).includes('R-DIM-003'), 'gable roof needs the ridge roll length');
});

test('P3-06 a missing coefficient omits the item, raises R-COEF-003, and clears once set', () => {
  const st = withModules({factors: false});
  const f = audit(st).findings.filter(f => f.ruleId === 'R-COEF-003');
  const missing = [...new Set(f.flatMap(x => x.evidence.coefficients))].sort();
  assert.deepEqual(missing, ['earth.swellPct', 'paint.finishCoverage', 'paint.primerCoverage', 'paint.puttyKgPerSqm', 'roof.screwsPerSqm', 'tile.adhesiveBagKg', 'tile.adhesiveKgPerSqm', 'tile.groutDensity', 'waterproof.liquidKgPerSqmPerCoat', 'waterproof.primerLPerSqm']);
  assert.ok(f.every(x => x.severity === 'critical'));
  const paint = plain(A.computeElement(st.elements.find(e => e.type === 'painting'), st.factors));
  assert.ok(!paint.custom.some(c => /paint/i.test(c.name)), 'no paint quantity without a coverage');
  const set = withModules();
  assert.ok(!rules(set).includes('R-COEF-003'));
  const coef = audit(set).findings.find(f => f.ruleId === 'R-COEF-001');
  assert.ok(coef.evidence.coefficients.some(c => c.path === 'paint.finishCoverage'), 'entered but not yet verified → R-COEF-001');
});

test('P3-07 BOQ: legacy rows unchanged, module divisions appended in order, totals reconcile', () => {
  const st = withModules(), b = plain(A.buildBOQ(st));
  const legacyRows = [], divs = [];
  let cur = null;
  for (const r of b.rows) { if (r.kind === 'div') { cur = r.text; divs.push(r.text); } if (LEGACY_DIVS.map(k => A.DIV_NAME[k]).includes(cur)) legacyRows.push(r); }
  assert.deepEqual(legacyRows, BASE.boq.rows, 'every legacy row (items, subtotals) is exactly the baseline');
  assert.deepEqual(divs, plain(A.DIVS).map(d => d[1]).filter(n => divs.includes(n)), 'divisions in catalog order');
  for (const k of ['EARTH', 'ROOF', 'TILE', 'WP', 'PAINT', 'DW', 'STEEL', 'PLUMB', 'ELEC']) assert.ok(divs.includes(A.DIV_NAME[k]), k);
  assert.deepEqual(plain(A.reconcileChecks(b, st.settings)).failures, []);
  const sum = b.divTotals.reduce((s, d) => s + d.amt, 0);
  assert.ok(Math.abs(sum - b.totals.direct) < 1e-6);
  assert.ok(!rules(st).includes('R-REC-001'));
});

test('P3-08 element-priced items multiply by element quantity; %-labor includes them', () => {
  const st = withModules(); st.labor.L_PLUMB.rate = 10; st.labor.L_PLUMB.source = 'user';
  const b = plain(A.buildBOQ(st));
  const door = b.rows.find(r => r.custom && /Door 0.9×2.1/.test(r.name));
  assert.equal(door.qty, 4); assert.equal(door.amt, 4 * 8500);
  const pipe = b.rows.find(r => r.custom && /PVC 4"/.test(r.name));
  assert.equal(pipe.qty, Math.ceil(25 * 1.05 / 3));
  const lab = b.rows.find(r => r.code === 'L_PLUMB');
  assert.ok(Math.abs(lab.amt - pipe.amt * 0.10) < 1e-9, 'plumbing labor = 10% of plumbing materials');
});

test('P3-09 an element-priced item without a unit cost is critical and names the element', () => {
  const st = withModules(); st.elements.find(e => e.type === 'tiles').inp.tileCost = 0;
  const f = audit(st).findings.find(f => f.ruleId === 'R-PRICE-001' && f.refs.elementIds.includes('m-tiles'));
  assert.equal(f.severity, 'critical');
});

test('P3-10 factorsUsed is complete for every module type (perturbation)', () => {
  const F0 = withModules().factors, get = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  const paths = Object.entries(TEST_FACTORS).flatMap(([g, o]) => Object.keys(o).map(k => g + '.' + k));
  const variants = {excavation: [SPEC.excavation, {...SPEC.excavation, mode: 'trench', haul: false}], roofing: [SPEC.roofing, {...SPEC.roofing, form: 'shed'}],
    tiles: [SPEC.tiles, {...SPEC.tiles, jw: 0}], waterproof: [SPEC.waterproof, {...SPEC.waterproof, sys: 'sheet', pack: 10, primer: false}], painting: [SPEC.painting, {...SPEC.painting, pc: 0, putty: false}],
    opening: [SPEC.opening], steel: [SPEC.steel, {kind: 'plate', pl: 0.3, pw: 0.3, pt: 12}], plumbing: [SPEC.plumbing], electrical: [SPEC.electrical]};
  for (const [t, list] of Object.entries(variants)) for (const inp of list) {
    const el = {type: t, inp: A.normInputs(t, inp)}, used = A.factorsUsed(el, F0), base = JSON.stringify(plain(A.computeElement(el, F0)));
    for (const p of paths) {
      const F = clone(F0), ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], F)[last] = get(F0, p) * 1.37 + 0.11;
      if (JSON.stringify(plain(A.computeElement(el, F))) !== base) assert.ok(used.has(p), `${t} reads ${p} but factorsUsed misses it`);
    }
  }
});

test('P3-11 unit and plausibility checks for module inputs', () => {
  const chk = (t, inp) => plain(A.elementChecks({type: t, mark: 'X', qty: 1, inp: A.normInputs(t, {...SPEC[t], ...inp})}, withModules().factors)).map(c => c.rule);
  assert.ok(chk('roofing', {pitch: 0.35}).includes('R-UNIT-001'), 'pitch entered as a ratio');
  assert.ok(chk('tiles', {tw: 0.6, th: 0.6}).includes('R-UNIT-001'), 'tile size in metres');
  assert.ok(chk('excavation', {slope: 5}).includes('R-UNIT-001'));
  assert.ok(chk('tiles', {skh: 700}).includes('R-MOD-002'), 'skirting taller than the tile');
  for (const t of MODULE_TYPES) assert.deepEqual(chk(t, {}), [], t + ' fully specified example is clean');
});

test('P3-12 deductions, conversions, waste and purchase rounding', () => {
  const F = withModules().factors, run = (t, inp) => plain(A.computeElement({type: t, inp}, F));
  const p = run('painting', {surf: 'wall', L: 10, H: 3, open: '1x1x2', fc: 1, cont: 4, finishCost: 1});
  assert.equal(p.labor[0].qty, 28, 'net area 30 − 2');
  const t = run('tiles', {surf: 'wall', L: 2, W: 1, tw: 300, th: 600, jw: 0, waste: 10, tileCost: 1});
  assert.equal(t.custom[0].qty, Math.ceil(2 / 0.18 * 1.1), 'mm → m, ceil after waste');
  const e = run('electrical', {cat: 'device', qin: 7, waste: 0, unitCost: 1});
  assert.equal(e.custom[0].qty, 7);
  const x = run('excavation', {mode: 'pit', L: 1, W: 1, D: 1, struct: 5, haul: false});
  assert.equal(x.labor.find(l => l.code === 'L_BF'), undefined, 'backfill never negative');
});

test('P3-13 equipment lines appear only when requested', () => {
  const F = withModules().factors, codes = inp => plain(A.computeElement({type: 'excavation', inp: {...SPEC.excavation, ...inp}}, F)).labor.map(l => l.code);
  assert.ok(codes({equip: true}).includes('E_EXC')); assert.ok(!codes({equip: false}).includes('E_EXC'));
  assert.ok(A.EQUIPMENT_CODES.has('E_EXC') && A.EQUIPMENT_CODES.has('E_CRANE'));
});

test('P3-14 a Phase 2 (v2) project file migrates with the new coefficients unset, without warnings, idempotently', async () => {
  const p2 = clone(V2); for (const g of Object.keys(TEST_FACTORS)) delete p2.factors[g];
  for (const p of Object.keys(p2.factorMeta)) if (/^(earth|roof|tile|waterproof|paint|steel)\./.test(p)) delete p2.factorMeta[p];
  const app = await openApp(browser);
  const r = await app.page.evaluate(raw => { const a = migrate(raw), b = migrate(JSON.parse(JSON.stringify(a.state))); return {a, same: JSON.stringify(a.state) === JSON.stringify(b.state), rep2: b.report}; }, p2);
  await app.close();
  assert.equal(r.a.state.factors.paint.finishCoverage, null);
  assert.equal(r.a.state.factors.steel.density, 7850);
  assert.match(r.a.state.factorMeta['paint.finishCoverage'].source, /^Not set/);
  assert.deepEqual(r.a.report.filter(x => x.level !== 'info'), []);
  assert.ok(r.same); assert.deepEqual(r.rep2, []);
});

test('P3-15 UI: every module can be added in the editor; BOQ, trace, factors and takeoff show it', async () => {
  const st = withModules(); st.elements = st.elements.filter(e => !e.id.startsWith('m-'));
  const app = await openApp(browser, {state: st});
  for (const t of MODULE_TYPES) {
    await app.page.evaluate(({t, spec}) => { App.addEl(t); for (const [k, v] of Object.entries(spec)) { const n = document.getElementById('f_' + k); if (!n) continue; if (n.type === 'checkbox') n.checked = !!v; else n.value = v; } document.getElementById('dlg').dispatchEvent(new Event('input')); }, {t, spec: SPEC[t]});
    if (t === 'roofing') assert.match(await app.page.textContent('#pv'), /Calculation trace.*Slope factor/s);
    await app.page.click('dialog .btn.pri');
  }
  assert.equal(await app.page.evaluate(() => S.elements.filter(e => TYPES[e.type].module).length), 9);
  await app.page.evaluate(() => App.tab('boq'));
  const boq = await app.page.textContent('#view');
  for (const n of ['Earthworks', 'Roofing Works', 'Tile Works', 'Waterproofing Works', 'Painting Works', 'Doors & Windows', 'Structural Steel Works', 'Plumbing Works', 'Electrical Works']) assert.ok(boq.includes(n), n);
  await app.page.evaluate(() => App.tab('factors'));
  assert.ok(await app.page.locator('input[data-bind="factor:paint.finishCoverage:value"]').count() === 1);
  await app.page.evaluate(() => App.tab('audit'));
  assert.equal(await app.page.locator('select[data-bind^="takeoff:"]').count(), 18 * 2);
  await app.page.evaluate(() => App.tab('selftest'));
  assert.equal(await app.page.textContent('#selftest-summary'), '22/22 passed');
  for (const t of ['dashboard', 'elements', 'rebar', 'prices', 'project']) await app.page.evaluate(t => App.tab(t), t);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test('P3-16 UI: clearing a module coefficient returns it to "not set"; legacy factors cannot be cleared to null', async () => {
  const st = withModules();
  const app = await openApp(browser, {state: st});
  await app.page.evaluate(() => App.tab('factors'));
  await app.page.fill('input[data-bind="factor:paint.finishCoverage:value"]', '');
  await app.page.dispatchEvent('input[data-bind="factor:paint.finishCoverage:value"]', 'change');
  assert.equal(await app.page.evaluate(() => S.factors.paint.finishCoverage), null);
  await app.page.fill('input[data-bind="factor:rebar.lapFactor:value"]', '');
  await app.page.dispatchEvent('input[data-bind="factor:rebar.lapFactor:value"]', 'change');
  assert.equal(await app.page.evaluate(() => S.factors.rebar.lapFactor), 0, 'legacy factor becomes 0, which the auditor flags');
  await app.close();
});
