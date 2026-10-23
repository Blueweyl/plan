// Phase 5: revision control. Snapshots are immutable and hashed; statuses move
// Submitted → Approved / Returned, older approvals become Superseded; restore
// creates a new revision; comparisons split changes into quantity and price parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAuditor, readJSON, plain} from './lib/engine.mjs';
import {launch, openApp} from './lib/browser.mjs';

const A = loadAuditor();
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

// What an estimator does before approval (test inputs): own prices and verified factors
const ready = () => {
  const st = clone(V2);
  for (const p of Object.values(st.prices)) { p.source = 'user'; p.updatedAt = '2026-10-23'; }
  for (const l of Object.values(st.labor)) { l.source = 'user'; l.updatedAt = '2026-10-23'; }
  for (const m of Object.values(st.factorMeta)) m.verified = true;
  return st;
};
async function app(state) {
  const a = await openApp(browser, {state, answer: d => d.type() === 'prompt' ? 'Reviewer note' : undefined});
  await a.page.evaluate(() => localStorage.setItem('estimator.user', 'QA Tester'));
  return a;
}
const submit = (page, desc) => page.evaluate(desc => { App.tab('revisions'); document.getElementById('revDesc').value = desc; App.revSubmit(); return S.revisions.at(-1).no; }, desc);

// ---------- pure comparison (Node)
test('P5-01 quantity/price decomposition is exact: Δ = (q1−q0)·p0 + (p1−p0)·q1', () => {
  const a = ready(), b = clone(a);
  b.prices.CEM.price = 300;                                   // price-driven
  b.elements[2].inp.H = 3.3;                                  // quantity-driven (C1 column height)
  const d = plain(A.diffBOQ(plain(A.buildBOQ(a)), plain(A.buildBOQ(b))));
  assert.ok(Math.abs(d.summary.quantityDriven + d.summary.priceDriven - d.summary.direct) < 1e-6, 'effects add up to the change in direct cost');
  for (const l of d.lines) assert.ok(Math.abs(l.qEff + l.pEff - l.da) < 1e-6, l.key);
  const cem = d.lines.find(l => l.key === 'M:CEM');
  assert.ok(Math.abs(cem.pEff - (300 - 260) * cem.q1) < 1e-6);
});

test('P5-02 a price-only change is all price-driven; a quantity-only change is all quantity-driven', () => {
  const a = ready(), p = clone(a), q = clone(a);
  p.prices.SAND.price = 1800;
  q.elements[0].qty = 10;
  const dp = plain(A.diffBOQ(plain(A.buildBOQ(a)), plain(A.buildBOQ(p)))), dq = plain(A.diffBOQ(plain(A.buildBOQ(a)), plain(A.buildBOQ(q))));
  assert.ok(Math.abs(dp.summary.quantityDriven) < 1e-6 && dp.summary.priceDriven > 0);
  const nonPct = dq.lines.filter(l => !l.unit.includes('of materials'));
  assert.ok(nonPct.every(l => Math.abs(l.pEff) < 1e-6 || l.kind === 'material' && /deformed bar|Tie wire/.test(l.name)), 'only rebar purchase optimisation can shift the effective rate');
  assert.ok(dq.summary.quantityDriven > 0);
});

test('P5-03 element-level and input-level differences', () => {
  const a = ready(), b = clone(a);
  b.elements[2].inp.H = 3.3; b.elements.splice(4, 1); b.elements.push({...clone(a.elements[0]), id: 'new1', mark: 'F2'});
  b.prices.CEM.price = 300; b.factors.rebar.lapFactor = 48; b.settings.vat = 0;
  const e = plain(A.diffElements(a, b)), i = plain(A.diffInputs(a, b));
  assert.deepEqual(e.map(x => [x.status, x.mark]).sort(), [['added', 'F2'], ['changed', 'C1'], ['removed', 'ST1']]);
  assert.deepEqual(e.find(x => x.mark === 'C1').changes, [['inp.H', 3, 3.3]]);
  assert.deepEqual(i.map(x => x.area + ':' + x.path).sort(), ['factors:rebar.lapFactor', 'prices:CEM.price', 'settings:vat']);
});

test('P5-04 labor and equipment differences are classified', () => {
  const a = ready(), b = clone(a), LS = b.laborSetup;
  LS.trades.find(t => t.id === 'T_MASON').wage = 700; LS.trades.find(t => t.id === 'T_HELP').wage = 500;
  LS.crews.push({id: 'C1', name: 'Plaster crew', members: [{trade: 'T_MASON', count: 1}, {trade: 'T_HELP', count: 1}]});
  Object.assign(b.labor.L_PLAS, {mode: 'productivity', crew: 'C1', output: 20});
  LS.equipment.push({id: 'E1', name: 'Mixer', basis: 'day', rate: 1800, minUnits: 1, mobilization: 3000});
  b.labor.L_CONC.attach = [{equip: 'E1', output: 15}];
  const d = plain(A.diffBOQ(plain(A.buildBOQ(a)), plain(A.buildBOQ(b))));
  const plas = d.lines.find(l => l.key === 'L:L_PLAS');
  assert.ok(Math.abs(plas.qEff) < 1e-9 && plas.pEff !== 0, 'same quantity, new effective rate → price-driven');
  assert.ok(d.summary.byKind.equipment.da > 3000 && Math.abs(d.summary.byKind.equipment.pEff) < 1e-9, 'new equipment and mobilization are added items');
});

// ---------- workflow (browser)
test('P5-05 submitting creates an immutable, reproducible revision', async () => {
  const a = await app(ready());
  const no = await submit(a.page, 'Initial estimate for review');
  assert.equal(no, 1);
  const r = await a.page.evaluate(() => { const rev = S.revisions[0]; const st = revisionState(rev); return {intact: revisionIntact(rev), status: rev.status, stored: rev.results.totals.grand, now: buildBOQ(st).totals.grand, work: buildBOQ(S).totals.grand, ver: rev.versions}; });
  assert.ok(r.intact); assert.equal(r.status, 'submitted');
  assert.equal(r.stored, BASE.boq.totals.grand); assert.equal(r.now, r.stored); assert.equal(r.work, r.stored);
  assert.deepEqual(Object.keys(r.ver).sort(), ['app', 'audit', 'engine', 'engineCode', 'labor', 'modules', 'revisions']);
  await a.page.evaluate(() => { S.prices.CEM.price = 999; S.elements[0].inp.L = 9; persist(); });
  const after = await a.page.evaluate(() => ({grand: S.revisions[0].results.totals.grand, again: buildBOQ(revisionState(S.revisions[0])).totals.grand, intact: revisionIntact(S.revisions[0])}));
  assert.deepEqual(after, {grand: BASE.boq.totals.grand, again: BASE.boq.totals.grand, intact: true}, 'later edits never change a revision');
  await a.close();
});

test('P5-06 statuses: submitted → approved; a later approval supersedes it; returned to draft', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => App.revApprove(1));
  await a.page.evaluate(() => { S.prices.CEM.price = 280; persist(); });
  await submit(a.page, 'Cement price update');
  await a.page.evaluate(() => App.revApprove(2));
  await a.page.evaluate(() => { S.elements[0].qty = 10; persist(); });
  await submit(a.page, 'More footings');
  await a.page.evaluate(() => App.revReturn(3));
  const r = await a.page.evaluate(() => ({st: S.revisions.map(x => x.status), appr: S.audit.approval.revisionNo, log: S.revisions[0].statusLog.map(l => l.to), ret: S.revisions[2].statusLog.at(-1)}));
  assert.deepEqual(r.st, ['superseded', 'approved', 'draft']);
  assert.equal(r.appr, 2);
  assert.deepEqual(r.log, ['submitted', 'approved', 'superseded']);
  assert.equal(r.ret.note, 'Reviewer note'); assert.equal(r.ret.by, 'QA Tester');
  assert.match(await a.page.textContent('#revChip'), /Rev 2 · Approved – changed since/);
  await a.close();
});

test('P5-07 approval is blocked while the revision has critical findings', async () => {
  const a = await app(V2);   // sample prices and unverified factors → critical
  await submit(a.page, 'Draft with placeholders');
  await a.page.evaluate(() => App.revApprove(1));
  assert.equal(await a.page.evaluate(() => S.revisions[0].status), 'submitted');
  assert.match(a.dialogs.at(-1).message, /critical finding/);
  await a.close();
});

test('P5-08 restore creates a new revision and never changes history', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => { S.prices.CEM.price = 400; S.elements.splice(0, 1); persist(); });
  await submit(a.page, 'Rev 2 – removed F1');
  const before = await a.page.evaluate(() => JSON.stringify(S.revisions.map(r => [r.snapshot, r.snapshotHash, r.results])));
  await a.page.evaluate(() => App.revRestore(1));
  const r = await a.page.evaluate(() => ({n: S.revisions.length, last: S.revisions.at(-1), work: buildBOQ(S).totals.grand, hist: JSON.stringify(S.revisions.slice(0, 2).map(r => [r.snapshot, r.snapshotHash, r.results])), bk: backupKeys().some(k => k.endsWith('.before-restore-rev'))}));
  assert.equal(r.n, 3); assert.equal(r.last.basedOn, 1); assert.match(r.last.description, /Restored from Rev 1/); assert.equal(r.last.status, 'submitted');
  assert.equal(r.work, BASE.boq.totals.grand, 'working draft has Rev 1 inputs again');
  assert.equal(r.hist, before, 'revisions 1 and 2 untouched'); assert.ok(r.bk, 'previous draft backed up');
  await a.close();
});

test('P5-09 tampering with a stored snapshot is detected (R-REV-001) and blocks approval/restore', async () => {
  const st = ready();
  const a = await app(st);
  await submit(a.page, 'Rev 1');
  const saved = await a.page.evaluate(() => { const s = JSON.parse(JSON.stringify(S)); s.revisions[0].snapshot = s.revisions[0].snapshot.replace('"price":260', '"price":1'); return s; });
  await a.close();
  const b = await app(saved);
  const r = await b.page.evaluate(() => ({intact: revisionIntact(S.revisions[0]), f: getAud().findings.filter(f => f.ruleId === 'R-REV-001').map(f => f.severity)}));
  assert.equal(r.intact, false); assert.deepEqual(r.f, ['critical']);
  await b.page.evaluate(() => App.revApprove(1));
  assert.match(b.dialogs.at(-1).message, /integrity/);
  assert.equal(await b.page.evaluate(() => S.revisions[0].status), 'submitted');
  await b.close();
});

test('P5-10 historical export uses the original numbers and states the status', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => App.revApprove(1));
  await a.page.evaluate(() => { S.prices.CEM.price = 999; persist(); });
  const csv = await a.page.evaluate(() => { let out; const orig = window.download; window.download = (blob) => { out = blob; }; App.revExport(1); window.download = orig; return out.text(); });
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.match(lines[0], /^"APPROVED REVISION 1 – /);
  assert.ok(csv.endsWith(await a.page.evaluate(() => boqCsv(S.revisions[0].results))));
  assert.equal(lines.at(-1), '"","TOTAL PROJECT COST","","","","1560700.85"', 'original grand total, not the edited draft');
  await a.close();
});

test('P5-11 recalculation check: reproduces exactly; a changed stored result is reported, not replaced', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => App.revVerify(1));
  assert.match(await a.page.textContent('#revVerifyResult'), /reproduces the stored totals exactly/);
  await a.page.evaluate(() => { S.revisions[0].results.totals.grand += 100; App.revVerify(1); });
  assert.match(await a.page.textContent('#revVerifyResult'), /different totals/);
  assert.equal(await a.page.evaluate(() => S.revisions[0].results.totals.grand), BASE.boq.totals.grand + 100, 'stored record kept');
  await a.close();
});

test('P5-12 reviewer comments are append-only, named and persisted', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => App.revView(1));
  await a.page.fill('#revComment', 'Check the CHB wall openings against A-3');
  await a.page.click('button[data-act="revComment"]');
  await a.page.reload();
  const c = await a.page.evaluate(() => S.revisions[0].comments);
  assert.equal(c.length, 1); assert.deepEqual([c[0].by, c[0].text], ['QA Tester', 'Check the CHB wall openings against A-3']);
  await a.page.evaluate(() => App.tab('revisions'));
  assert.equal(await a.page.locator('[data-act*="commentDel"], [data-act*="commentEdit"]').count(), 0, 'no way to edit or delete');
  await a.close();
});

test('P5-13 the Audit-tab approval creates an approved revision', async () => {
  const a = await app(ready());
  await a.page.evaluate(() => { App.tab('audit'); });
  await a.page.click('button[data-act="approve"]');
  const r = await a.page.evaluate(() => ({revs: S.revisions.map(x => [x.no, x.status]), appr: S.audit.approval.revisionNo}));
  assert.deepEqual(r.revs, [[1, 'approved']]); assert.equal(r.appr, 1);
  await a.close();
});

test('P5-14 comparison screen: working draft vs revision', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  await a.page.evaluate(() => { S.prices.CEM.price = 300; S.elements[2].inp.H = 3.3; persist(); App.tab('revisions'); });
  await a.page.selectOption('#cmpA', '1'); await a.page.selectOption('#cmpB', 'work'); await a.page.click('button[data-act="revCompare"]');
  assert.match(await a.page.textContent('#cmpElements'), /C1.*inp\.H: 3 → 3\.3/s);
  assert.ok(await a.page.locator('#cmpLines tr').count() > 3);
  const r = await a.page.evaluate(() => { const d = diffBOQ(S.revisions[0].results, buildBOQ(S)); return d.summary; });
  assert.ok(Math.abs(r.quantityDriven + r.priceDriven - r.direct) < 1e-6);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('P5-15 migration: revisions are kept, sanitised, idempotent; older files get none', async () => {
  const a = await app(ready());
  await submit(a.page, 'Rev 1');
  const st = await a.page.evaluate(() => JSON.parse(JSON.stringify(S)));
  await a.close();
  const b = await app();
  const r = await b.page.evaluate(({st, fixture}) => {
    const bad = JSON.parse(JSON.stringify(st)); bad.revisions.push({no: 2, status: 'hacked', snapshot: '{}', results: {}}, {nope: 1});
    const m = migrate(bad), again = migrate(JSON.parse(JSON.stringify(m.state)));
    return {n: m.state.revisions.length, st2: m.state.revisions[1].status, intact1: revisionIntact(m.state.revisions[0]), same: JSON.stringify(m.state) === JSON.stringify(again.state), old: migrate(fixture).state.revisions, unk: Object.keys(m.state.quarantine.unknownKeys.revisions || {})};
  }, {st, fixture});
  assert.equal(r.n, 2); assert.equal(r.st2, 'draft'); assert.ok(r.intact1); assert.ok(r.same); assert.deepEqual(r.old, []); assert.deepEqual(r.unk, ['2']);
  await b.close();
});
