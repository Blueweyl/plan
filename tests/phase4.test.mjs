// Phase 4: labor and equipment. Wages, outputs and rates below are TEST INPUTS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAuditor, readJSON, plain} from './lib/engine.mjs';
import {engineResults} from '../scripts/make-baseline.mjs';
import {launch, openApp} from './lib/browser.mjs';

const A = loadAuditor(), TODAY = '2026-10-23';
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const BASE = readJSON('BASELINE_RESULTS.json');
const clone = x => JSON.parse(JSON.stringify(x));
let browser, V2;
test.before(async () => {
  browser = await launch();
  const app = await openApp(browser);
  V2 = await app.page.evaluate(raw => migrate(raw).state, fixture);
  await app.close();
});
test.after(async () => { await browser.close(); });

const boq = st => plain(A.buildBOQ(st));
const audit = st => plain(A.runAudit(st, {today: TODAY}));
const rules = st => audit(st).findings.map(f => f.ruleId);
const rowsOf = (b, code) => b.rows.filter(r => r.code === code);
const sum = (rs, k = 'amt') => rs.reduce((s, r) => s + r[k], 0);
const withCrew = () => {
  const st = clone(V2), LS = st.laborSetup;
  LS.trades.find(t => t.id === 'T_MASON').wage = 700; LS.trades.find(t => t.id === 'T_HELP').wage = 500;
  LS.crews.push({id: 'C1', name: 'Plaster crew', members: [{trade: 'T_MASON', count: 1}, {trade: 'T_HELP', count: 1}]});
  return st;
};
const EXC = {type: 'excavation', inp: {mode: 'pit', L: 1.5, W: 1.5, D: 1.5, ws: 0.3, slope: 0.5, struct: 1.076, haul: false}};
const withExcavation = (st, levels = [0]) => { levels.forEach(n => st.elements.push({id: 'ex' + n, mark: 'EX' + n, level: st.levels[n].id, qty: 1, ...clone(EXC), inp: A.normInputs('excavation', EXC.inp)})); return st; };
const backhoe = st => { st.laborSetup.equipment.push({id: 'E1', name: 'Backhoe', basis: 'hr', rate: 1500, minUnits: 4, mobilization: 5000}); return st; };

test('P4-01 legacy golden master is identical with the labor layer loaded', () => {
  const cur = engineResults(A, fixture);
  for (const k of ['elements', 'estimate', 'boq', 'reconciliation']) assert.deepEqual(JSON.parse(JSON.stringify(cur[k])), BASE[k], k);
  assert.deepEqual(boq(V2).rows, BASE.boq.rows, 'migrated v2 project with default labor setup');
});

test('P4-02 hand-calculated labor examples pass (in-app self-test)', () => {
  const r = plain(A.runLaborSelfTests());
  assert.equal(r.length, 4); assert.deepEqual(r.filter(x => !x.ok), []);
});

test('P4-03 productivity: cost = quantity ÷ output × crew day cost; everything else unchanged', () => {
  const st = withCrew(); Object.assign(st.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20});
  const b = boq(st), base = BASE.boq.rows.filter(r => r.code === 'L_PLAS');
  const rows = rowsOf(b, 'L_PLAS');
  assert.equal(rows.length, base.length, 'one row per level/division, as before');
  rows.forEach((r, n) => {
    assert.equal(r.qty, base[n].qty);
    assert.ok(Math.abs(r.amt - base[n].qty / 20 * 1200) < 1e-9);
    assert.ok(Math.abs(r.crewDays - base[n].qty / 20) < 1e-12);
    assert.match(r.name, /crew-days, Plaster crew\)$/);
  });
  const others = b.rows.filter(r => r.kind !== 'sub' && r.code !== 'L_PLAS'), baseOthers = BASE.boq.rows.filter(r => r.kind !== 'sub' && r.code !== 'L_PLAS');
  assert.deepEqual(others, baseOthers);
  assert.deepEqual(plain(A.reconcileChecks(b, st.settings)).failures, []);
});

test('P4-04 labor burden and parallel crews', () => {
  const st = withCrew(); st.laborSetup.burdenPct = 10; Object.assign(st.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20, crews: 2});
  const r = rowsOf(boq(st), 'L_PLAS')[0];
  assert.ok(Math.abs(r.amt - r.qty / 20 * 1320) < 1e-9);
  assert.ok(Math.abs(r.duration - r.crewDays / 2) < 1e-12);
  assert.ok(Math.abs(r.crewHours - r.crewDays * 8 * 2) < 1e-9, 'crew-hours = days × 8 h × 2 workers');
});

test('P4-05 pakyaw: one lump sum, allocated by quantity share across divisions and levels', () => {
  const st = clone(V2); Object.assign(st.labor.L_CHB, {mode: 'pakyaw', lump: 50000});
  const rows = rowsOf(boq(st), 'L_CHB'), Q = sum(rows, 'qty');
  assert.ok(rows.length >= 2, 'used by masonry and partitions');
  assert.ok(Math.abs(sum(rows) - 50000) < 1e-6, 'exactly the lump sum in total');
  rows.forEach(r => assert.ok(Math.abs(r.amt - 50000 * r.qty / Q) < 1e-9));
});

test('P4-06 switching methods back and forth leaves no residue (no double counting)', () => {
  const st = withCrew(); Object.assign(st.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20});
  Object.assign(st.labor.L_CHB, {mode: 'pakyaw', lump: 50000});
  st.labor.L_PLAS.mode = 'unit'; st.labor.L_CHB.mode = 'unit';
  assert.deepEqual(boq(st).rows, BASE.boq.rows, 'parameters of inactive methods are ignored');
  st.labor.L_PLAS.mode = 'productivity';
  const b = boq(st);
  assert.equal(b.rows.filter(r => r.kind === 'lab').length, BASE.boq.rows.filter(r => r.kind === 'lab').length, 'still one row per item and level');
});

test('P4-07 attached equipment: minimum charge, mobilization once for the whole project', () => {
  const st = backhoe(withExcavation(clone(V2), [0, 1]));
  st.labor.L_EXC.rate = 100; st.labor.L_EXC.source = 'user';
  st.labor.L_EXC.attach = [{equip: 'E1', output: 20}];
  const b = boq(st), eq = b.rows.filter(r => r.code === 'EQ:E1'), mob = b.rows.filter(r => r.code === 'MOB:E1');
  assert.equal(eq.length, 2);
  for (const r of eq) { assert.equal(r.qty, 4, '0.62 h billed at the 4 h minimum'); assert.equal(r.amt, 6000); }
  assert.equal(mob.length, 1); assert.equal(mob[0].amt, 5000);
  assert.deepEqual(plain(A.reconcileChecks(b, st.settings)).failures, []);
  const direct = b.totals.direct, without = boq((() => { const s = clone(st); delete s.labor.L_EXC.attach; return s; })()).totals.direct;
  assert.ok(Math.abs(direct - without - (2 * 6000 + 5000)) < 1e-6, 'equipment adds exactly its own cost');
});

test('P4-08 rental method on equipment lines: output per hour, hours direct, hour/day conversion', () => {
  const st = backhoe(withExcavation(clone(V2)));
  st.elements.find(e => e.type === 'excavation').inp.equip = true;
  Object.assign(st.labor.E_EXC, {mode: 'rental', equip: 'E1', eqOutput: 2});
  const r = rowsOf(boq(st), 'E_EXC')[0];
  // labor quantities are priced as shown in the BOQ (2 dp), like legacy unit-rate labor
  assert.equal(r.qty, 12.47);
  assert.ok(Math.abs(r.billed - r.qty / 2) < 1e-9, '12.47 m³ at 2 m³/h = 6.235 h (> 4 h minimum)');
  assert.ok(Math.abs(r.amt - r.qty / 2 * 1500) < 1e-6);
  const LS = A.defaultLaborSetup();
  assert.equal(A.billUnits(LS, {basis: 'day'}, 'hr', 16, 0), 2, '16 hours = 2 days at 8 h/day');
});

test('P4-09 equipment line and attached equipment in the same division/level → R-LAB-003', () => {
  const st = backhoe(withExcavation(clone(V2)));
  st.elements.find(e => e.type === 'excavation').inp.equip = true;
  st.labor.L_EXC.attach = [{equip: 'E1', output: 20}];
  assert.ok(rules(st).includes('R-LAB-003'));
  delete st.labor.L_EXC.attach;
  assert.ok(!rules(st).includes('R-LAB-003'));
});

test('P4-10 incomplete methods are critical and never silently costed', () => {
  const st = clone(V2);
  Object.assign(st.labor.L_PLAS, {mode: 'productivity'});
  Object.assign(st.labor.L_CHB, {mode: 'pakyaw'});
  const au = audit(st), r = au.findings.map(f => f.ruleId);
  assert.ok(r.includes('R-LAB-001') && r.includes('R-LAB-002'));
  assert.ok(au.findings.filter(f => /^R-LAB-00[12]/.test(f.ruleId)).every(f => f.severity === 'critical'));
  assert.ok(rowsOf(boq(st), 'L_PLAS').every(x => x.amt === 0 && x.incomplete));
  const w = withCrew(); w.laborSetup.trades.find(t => t.id === 'T_HELP').wage = null; Object.assign(w.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20});
  assert.ok(audit(w).findings.some(f => f.ruleId === 'R-LAB-001' && /Laborer \/ helper/.test(f.description)), 'names the trade with the missing wage');
});

test('P4-11 sample-rate warnings do not apply to items costed by productivity or pakyaw', () => {
  const st = withCrew(); Object.assign(st.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20});
  const f = audit(st).findings.find(x => x.ruleId === 'R-PRICE-005');
  assert.ok(!f.evidence.codes.includes('L_PLAS'));
});

test('P4-12 upgrading a Phase 3 project keeps an existing approval valid (hash unchanged)', () => {
  const st = clone(V2), before = clone(st); delete before.laborSetup;
  assert.deepEqual(plain(A.inputHashes(st)), plain(A.inputHashes(before)));
  const changed = withCrew();
  assert.notEqual(plain(A.inputHashes(changed)).all, plain(A.inputHashes(st)).all, 'entering wages does change the hash');
});

test('P4-13 migration of labor setup: defaults, sanitising, idempotent', async () => {
  const app = await openApp(browser);
  const r = await app.page.evaluate(raw => {
    const bad = JSON.parse(JSON.stringify(raw));
    bad.laborSetup = {hoursPerDay: -1, burdenPct: 'x', trades: [{id: 'T_MASON', name: 'Mason', wage: 650}, {id: "x');alert(1)//", name: 'bad'}], crews: [{id: 'C1', name: '<b>c</b>', members: [{trade: 'T_MASON', count: 2.6}]}], equipment: [{id: 'E1', name: 'Mixer', basis: 'week', rate: 'abc'}]};
    bad.labor.L_PLAS.mode = 'magic'; bad.labor.L_CHB.attach = [{equip: 'E1', output: 3}, {equip: '<x>'}];
    const a = migrate(bad), b = migrate(JSON.parse(JSON.stringify(a.state)));
    return {ls: a.state.laborSetup, mode: a.state.labor.L_PLAS.mode, att: a.state.labor.L_CHB.attach, warns: a.report.filter(x => x.level === 'warn').length, same: JSON.stringify(a.state) === JSON.stringify(b.state), plain: migrate(raw).state.laborSetup};
  }, fixture);
  await app.close();
  assert.equal(r.ls.hoursPerDay, 8); assert.equal(r.ls.burdenPct, 0);
  assert.equal(r.ls.trades.find(t => t.id === 'T_MASON').wage, 650);
  assert.ok(!r.ls.trades.some(t => t.id.includes("'")));
  assert.equal(r.ls.crews[0].members[0].count, 3);
  assert.deepEqual([r.ls.equipment[0].basis, r.ls.equipment[0].rate], ['hr', null]);
  assert.equal(r.mode, 'unit'); assert.deepEqual(r.att, [{equip: 'E1', output: 3}]);
  assert.ok(r.warns >= 4); assert.ok(r.same);
  assert.deepEqual(r.plain.trades.map(t => t.wage), Array(10).fill(null), 'no wage is preset');
});

test('P4-14 UI: wages, crew, productivity, equipment attachment through the Labor tab', async () => {
  const st = withExcavation(clone(V2));
  const app = await openApp(browser, {state: st});
  await app.page.evaluate(() => App.tab('labor'));
  const set = async (sel, v) => { await app.page.fill(sel, String(v)); await app.page.dispatchEvent(sel, 'change'); };
  await set('input[data-bind="trade:T_MASON:wage"]', 700);
  await set('input[data-bind="trade:T_HELP:wage"]', 500);
  await app.page.click('button[data-act="crewAdd"]');
  const cid = await app.page.evaluate(() => S.laborSetup.crews[0].id);
  await app.page.click(`button[data-act="memberAdd"][data-arg="${cid}"]`);
  await app.page.selectOption(`select[data-bind="member:${cid}~0:trade"]`, 'T_MASON');
  await app.page.click(`button[data-act="memberAdd"][data-arg="${cid}"]`);
  await app.page.selectOption(`select[data-bind="member:${cid}~1:trade"]`, 'T_HELP');
  await app.page.selectOption('select[data-bind="labor:L_PLAS:mode"]', 'productivity');
  await app.page.selectOption('select[data-bind="labor:L_PLAS:crew"]', cid);
  await set('input[data-bind="labor:L_PLAS:output"]', 20);
  const plas = await app.page.evaluate(() => buildBOQ(S).rows.filter(r => r.code === 'L_PLAS'));
  assert.ok(plas.every(r => Math.abs(r.amt - r.qty / 20 * 1200) < 1e-9));
  assert.match(await app.page.textContent('tr[data-labor="L_PLAS"]'), /crew-days/);
  await app.page.click('button[data-act="eqAdd"]');
  const eid = await app.page.evaluate(() => S.laborSetup.equipment[0].id);
  await set(`input[data-bind="equip:${eid}:rate"]`, 1500);
  await set(`input[data-bind="equip:${eid}:mobilization"]`, 5000);
  await app.page.click('button[data-act="attAdd"][data-arg="L_EXC"]');
  await set('input[data-bind="att:L_EXC~0:output"]', 20);
  const r = await app.page.evaluate(() => { const b = buildBOQ(S); return {q: b.rows.find(x => x.code === 'L_EXC').qty, eq: b.rows.filter(x => x.eq).map(x => [x.code.split(':')[0], x.amt])}; });
  assert.deepEqual(r.eq.map(x => x[0]), ['EQ', 'MOB'], 'equipment row, then mobilization once');
  assert.ok(Math.abs(r.eq[0][1] - 1500 * r.q / 20) < 1e-9, 'no minimum set: billed hours × rate'); assert.equal(r.eq[1][1], 5000);
  for (const t of ['dashboard', 'boq', 'audit', 'prices']) await app.page.evaluate(t => App.tab(t), t);
  assert.match(await app.page.evaluate(() => { App.tab('dashboard'); return document.getElementById('view').innerText; }), /crew-days/);
  assert.deepEqual(app.errors, []);
  await app.page.reload();
  assert.equal(await app.page.evaluate(() => S.labor.L_PLAS.mode), 'productivity', 'saved');
  await app.close();
});
