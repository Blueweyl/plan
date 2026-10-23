// Migration / compatibility tests for project JSON and browser storage.
// COMPAT-xx: v1 files keep loading with identical results.
// MIG-xx:    the v1 -> v2 migration guarantees from MIGRATION_PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readJSON, ROOT} from './lib/engine.mjs';
import {launch, openApp, STORAGE_KEY} from './lib/browser.mjs';

const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const BASE_GRAND = readJSON('BASELINE_RESULTS.json').boq.totals.grand;
const clone = x => JSON.parse(JSON.stringify(x));
const V1_URL = 'file://' + path.join(ROOT, 'original/estimator.v1.html');
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

async function inApp(fn, arg) { const app = await openApp(browser); const r = await app.page.evaluate(fn, arg); await app.close(); return r; }
const migrate = raw => inApp(raw => { const {state, report} = migrate(raw); return {state, report, grand: buildBOQ(state).totals.grand}; }, raw);

test('COMPAT-01 every v1 field of a saved project is preserved by the migration', async () => {
  const {state} = await migrate(fixture);
  for (const k of ['project', 'settings', 'levels', 'elements']) assert.deepEqual(state[k], fixture[k], k);
  for (const g of Object.keys(fixture.factors)) assert.deepEqual(state.factors[g], fixture.factors[g], 'factors.' + g);
  assert.deepEqual(state.factors.paint, {primerCoverage: null, finishCoverage: null, puttyKgPerSqm: null}, 'new calculators: coefficients not set');
  for (const [c, p] of Object.entries(fixture.prices)) assert.deepEqual({name: state.prices[c].name, unit: state.prices[c].unit, price: state.prices[c].price}, p, 'price ' + c);
  for (const [c, l] of Object.entries(fixture.labor)) for (const k of Object.keys(l)) assert.equal(state.labor[c][k], l[k], `labor ${c}.${k}`);
  assert.equal(state.version, 2);
});

test('COMPAT-02 v1 project in localStorage survives reload with identical BOQ total', async () => {
  const app = await openApp(browser, {state: fixture});
  const r = await app.page.evaluate(() => ({n: S.elements.length, grand: buildBOQ(S).totals.grand}));
  await app.page.evaluate(() => App.addLevel());          // forces a v2 write
  await app.page.reload();
  const r2 = await app.page.evaluate(() => ({n: S.elements.length, grand: buildBOQ(S).totals.grand, v: S.version}));
  assert.equal(r.n, 18); assert.equal(r2.n, 18); assert.equal(r.grand, BASE_GRAND); assert.equal(r2.grand, BASE_GRAND); assert.equal(r2.v, 2);
  await app.close();
});

test('COMPAT-03 file without version/settings/factors gets defaults filled in', async () => {
  const f = clone(fixture); delete f.version; delete f.settings; delete f.factors;
  const {state} = await migrate(f);
  assert.equal(state.version, 2); assert.equal(state.meta.migratedFrom, 1);
  assert.equal(state.settings.vat, 12); assert.equal(state.factors.rebar.lapFactor, 40); assert.equal(state.elements.length, 18);
});

test('COMPAT-04 partial price list keeps saved prices and fills missing materials', async () => {
  const f = clone(fixture); f.prices = {CEM: {name: 'Cement (custom)', unit: 'bag', price: 999}};
  const {state} = await migrate(f);
  assert.equal(state.prices.CEM.price, 999); assert.equal(state.prices.CEM.name, 'Cement (custom)'); assert.equal(state.prices.CEM.source, 'user');
  assert.equal(state.prices.RB16.price, fixture.prices.RB16.price); assert.equal(state.prices.RB16.source, 'sample');
});

test('COMPAT-05 user-edited factors are kept and marked user-entered; arrays replaced, not merged', async () => {
  const f = clone(fixture); f.factors.rebar.lapFactor = 48; f.factors.rebar.commercial = [6, 12];
  const {state} = await migrate(f);
  assert.equal(state.factors.rebar.lapFactor, 48); assert.deepEqual(state.factors.rebar.commercial, [6, 12]);
  assert.match(state.factorMeta['rebar.lapFactor'].source, /User-entered/);
  assert.equal(state.factorMeta['rebar.lapFactor'].verified, false);
});

test('COMPAT-06 numeric inputs saved as strings compute the same as numbers', async () => {
  const f = clone(fixture); for (const e of f.elements) for (const [k, v] of Object.entries(e.inp)) if (typeof v === 'number') e.inp[k] = String(v);
  f.elements.forEach(e => { e.qty = String(e.qty); });
  const {grand} = await migrate(f);
  assert.equal(grand, BASE_GRAND);
});

test('COMPAT-07 elements saved before a field existed get that field\'s default', async () => {
  const f = clone(fixture); delete f.elements[2].inp.Lo; delete f.elements[2].inp.sLo;
  const {state} = await migrate(f);
  assert.equal(state.elements[2].inp.Lo, undefined, 'missing input stays missing (default applied at calculation)');
  assert.equal(await inApp(inp => normInputs('column', inp).Lo, state.elements[2].inp), 0);
});

test('MIG-01 migrated fixture gives the golden-master grand total', async () => {
  assert.equal((await migrate(fixture)).grand, BASE_GRAND);
});

test('MIG-02 migration is idempotent', async () => {
  const r = await inApp(raw => { const a = migrate(raw).state, b = migrate(JSON.parse(JSON.stringify(a))); return {same: JSON.stringify(a) === JSON.stringify(b.state), report: b.report}; }, fixture);
  assert.ok(r.same); assert.deepEqual(r.report, []);
});

test('MIG-03 (fixes A-H03) unknown element types are quarantined, reported and preserved through save/reload', async () => {
  const f = clone(fixture); f.elements.push({id: 'el-x', type: 'helipad', mark: 'H1', level: 'lvl-ground', qty: 1, inp: {pad: 30}});
  const {state, report, grand} = await migrate(f);
  assert.equal(state.elements.length, 18);
  assert.deepEqual(state.quarantine.elements, [f.elements[18]]);
  assert.ok(report.some(r => r.code === 'UNKNOWN_TYPE'));
  assert.equal(grand, BASE_GRAND);
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.addLevel());
  await app.page.reload();
  assert.equal(await app.page.evaluate(() => S.quarantine.elements[0].type), 'helipad');
  await app.close();
});

test('MIG-04 (fixes A-C03) orphan elements move to "Unassigned (recovered)" and are costed', async () => {
  const f = clone(fixture); f.levels = f.levels.slice(0, 1);
  const {state, report, grand} = await migrate(f);
  const rec = state.levels.find(l => l.name === 'Unassigned (recovered)');
  assert.ok(rec);
  assert.equal(state.elements.filter(e => e.level === rec.id).length, 7);
  assert.equal(report.filter(r => r.code === 'ORPHAN_ELEMENT').length, 7);
  assert.ok(Math.abs(grand - BASE_GRAND) < 1e-6, 'nothing silently missing from the total');
});

test('MIG-04b (fixes A-C03b) a file with no levels keeps every element costed', async () => {
  const f = clone(fixture); f.levels = [];
  const {state, grand} = await migrate(f);
  assert.deepEqual(state.levels.map(l => l.name), ['Unassigned (recovered)']);
  assert.ok(state.elements.every(e => e.level === state.levels[0].id));
  // one merged level changes rebar purchase optimization, so compare a quantity that does not depend on it
  const conc = await inApp(st => buildEstimate(st)[0].divs.CONC.labor.get('L_CONC'), state);
  const base = readJSON('BASELINE_RESULTS.json').estimate.reduce((s, l) => s + (l.divisions.CONC ? l.divisions.CONC.labor.L_CONC : 0), 0);
  assert.ok(Math.abs(conc - base) < 1e-9 && grand > 0);
});

test('MIG-05 (fixes A-C04) corrupt localStorage is backed up, reported, and never lost', async () => {
  const bad = '{"project": {"name": "Important job"';
  const app = await openApp(browser, {state: bad});
  const r = await app.page.evaluate(prefix => ({
    name: S.project.name,
    backups: Object.keys(localStorage).filter(k => k.startsWith(prefix) && k.endsWith('.corrupt')).map(k => localStorage.getItem(k)),
    report: store.report.map(x => x.code),
  }), 'estimator.backup.');
  assert.equal(r.name, 'New project');
  assert.deepEqual(r.backups, [bad], 'byte-identical copy kept');
  assert.ok(r.report.includes('CORRUPT_STORAGE'));
  await app.page.evaluate(() => App.tab('dashboard'));
  assert.match(await app.page.textContent('#view'), /Saved data could not be read/);
  await app.page.evaluate(() => App.addLevel());
  assert.equal(await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.endsWith('.corrupt')).map(k => localStorage.getItem(k))[0]), bad, 'backup survives later edits');
  await app.close();
});

test('MIG-05b if the corrupt data cannot be backed up, autosave pauses instead of overwriting it', async () => {
  const bad = '{"broken":';
  const app = await openApp(browser, {state: bad, beforeLoad: p => p.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('estimator.backup.')) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
  })});
  await app.page.evaluate(() => App.addLevel());
  assert.equal(await app.page.evaluate(k => localStorage.getItem(k), STORAGE_KEY), bad, 'original untouched');
  assert.match(await app.page.textContent('#saveStatus'), /Not saved/);
  await app.close();
});

test('MIG-06 (fixes A-H01) malicious values are quarantined at load time', async () => {
  const f = clone(fixture);
  f.elements[0].qty = '<img src=x onerror="window.__pwned=1">';
  f.elements[1].id = "x');window.__pwned=1;('";
  f.levels[0].h = '"><img src=x onerror=window.__pwned=1>';
  f.factors.concrete['<img onerror=window.__pwned=1>'] = {cement: 1};
  f.prices.CEM.price = '<b>9</b>';
  const {state, report} = await migrate(f);
  assert.equal(state.elements[0].qty, 0);
  assert.match(state.elements[1].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(state.levels[0].h, 3);
  assert.equal(Object.keys(state.factors.concrete).length, 4);
  assert.equal(state.prices.CEM.price, 0);
  assert.ok(state.quarantine.invalidValues.length >= 3);
  assert.ok(state.quarantine.unknownKeys.factors);
  assert.ok(report.filter(r => r.level === 'warn').length >= 4);
});

test('MIG-06b prototype-pollution keys in a file are ignored', async () => {
  const raw = '{"factors": {"__proto__": {"polluted": 1}}, "elements": [{"id":"a","type":"column","mark":"C1","level":"zz","qty":1,"inp":{"__proto__":{"polluted":2}}}]}';
  const r = await inApp(raw => { migrate(JSON.parse(raw)); return ({}).polluted === undefined; }, raw);
  assert.ok(r);
});

test('MIG-07 a v2 file still calculates identically in the original v1 app (forward compatibility)', async () => {
  const v2 = (await migrate(fixture)).state;
  const app = await openApp(browser, {state: v2, url: V1_URL});
  const r = await app.page.evaluate(() => ({n: S.elements.length, grand: buildBOQ(S).totals.grand}));
  assert.equal(r.n, 18); assert.equal(r.grand, BASE_GRAND);
  await app.close();
});

test('MIG-08 the original v1 data is kept byte-identical under the pre-v2 backup key', async () => {
  const text = JSON.stringify(fixture);
  const app = await openApp(browser, {state: text});
  assert.equal(await app.page.evaluate(() => localStorage.getItem('estimator.v1.pre-v2-backup')), text);
  await app.page.evaluate(() => App.addLevel());
  await app.page.reload();
  assert.equal(await app.page.evaluate(() => localStorage.getItem('estimator.v1.pre-v2-backup')), text, 'not overwritten by later loads');
  await app.close();
});
