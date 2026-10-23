// Migration / compatibility tests for project JSON and browser storage.
// "COMPAT" tests are guarantees that must keep passing after every phase.
// "KNOWN-ISSUE" tests reproduce current data-loss behaviour documented in
// AUDIT.md; MIGRATION_PLAN.md says how each one flips when it is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readJSON} from './lib/engine.mjs';
import {launch, openApp, STORAGE_KEY} from './lib/browser.mjs';

const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const clone = x => JSON.parse(JSON.stringify(x));
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

async function load(raw) {
  const app = await openApp(browser);
  const st = await app.page.evaluate(raw => loadState(raw), raw);
  await app.close();
  return st;
}

test('COMPAT-01 saved v1 project file round-trips through loadState unchanged', async () => {
  assert.deepEqual(await load(fixture), fixture);
});

test('COMPAT-02 v1 project in localStorage survives reload with identical BOQ total', async () => {
  const app = await openApp(browser, {state: fixture});
  const r = await app.page.evaluate(() => ({n: S.elements.length, grand: buildBOQ(S).totals.grand}));
  await app.page.reload();
  const r2 = await app.page.evaluate(() => ({n: S.elements.length, grand: buildBOQ(S).totals.grand}));
  assert.deepEqual(r2, r); assert.equal(r.n, 18);
  await app.close();
});

test('COMPAT-03 file without version/settings/factors gets defaults filled in', async () => {
  const f = clone(fixture); delete f.version; delete f.settings; delete f.factors;
  const st = await load(f);
  assert.equal(st.version, 1);
  assert.equal(st.settings.vat, 12);
  assert.equal(st.factors.rebar.lapFactor, 40);
  assert.equal(st.elements.length, 18);
});

test('COMPAT-04 partial price list keeps saved prices and fills missing materials', async () => {
  const f = clone(fixture); f.prices = {CEM: {name: 'Cement (custom)', unit: 'bag', price: 999}};
  const st = await load(f);
  assert.equal(st.prices.CEM.price, 999);
  assert.equal(st.prices.CEM.name, 'Cement (custom)');
  assert.equal(st.prices.RB16.price, fixture.prices.RB16.price);
});

test('COMPAT-05 user-edited factors are kept; commercial-length array replaced, not merged', async () => {
  const f = clone(fixture); f.factors.rebar.lapFactor = 48; f.factors.rebar.commercial = [6, 12];
  const st = await load(f);
  assert.equal(st.factors.rebar.lapFactor, 48);
  assert.deepEqual(st.factors.rebar.commercial, [6, 12]);
});

test('COMPAT-06 numeric inputs saved as strings compute the same as numbers', async () => {
  const app = await openApp(browser);
  const r = await app.page.evaluate(() => {
    const F = defaultFactors();
    const a = computeElement({type: 'column', inp: {b: 0.4, h: 0.4, H: 3, nM: 8}}, F);
    const b = computeElement({type: 'column', inp: {b: '0.4', h: '0.4', H: '3', nM: '8'}}, F);
    return [a.kg, b.kg];
  });
  assert.equal(r[0], r[1]);
  await app.close();
});

test('COMPAT-07 elements saved before a field existed get that field\'s default', async () => {
  const f = clone(fixture); delete f.elements[3].inp.Lo; delete f.elements[3].inp.sLo;
  const app = await openApp(browser, {state: f});
  const lo = await app.page.evaluate(() => normInputs('column', S.elements[3].inp).Lo);
  assert.equal(lo, 0);
  await app.close();
});

test('KNOWN-ISSUE A-H03: elements of an unknown type are silently dropped on load', async () => {
  const f = clone(fixture); f.elements.push({id: 'el-x', type: 'roofing', mark: 'R1', level: 'lvl-ground', qty: 1, inp: {}});
  const st = await load(f);
  assert.equal(st.elements.length, 18, 'roofing element removed without warning');
});

test('KNOWN-ISSUE A-C03: elements whose level id is missing are excluded from the BOQ', async () => {
  const f = clone(fixture); f.levels = f.levels.slice(0, 1);   // drop "Second floor"
  const app = await openApp(browser, {state: f});
  const r = await app.page.evaluate(() => ({kept: S.elements.length, inEstimate: buildEstimate(S).length, grand: buildBOQ(S).totals.grand}));
  assert.equal(r.kept, 18, 'elements are still stored');
  assert.equal(r.inEstimate, 1, 'only one level is costed');
  assert.ok(r.grand < readJSON('BASELINE_RESULTS.json').boq.totals.grand, 'second-floor elements silently missing from total');
  await app.close();
});

test('KNOWN-ISSUE A-C03b: file with no levels gets a new default level; all elements become orphans', async () => {
  const f = clone(fixture); f.levels = [];
  const app = await openApp(browser, {state: f});
  const grand = await app.page.evaluate(() => buildBOQ(S).totals.grand);
  assert.equal(grand, 0);
  await app.close();
});

test('KNOWN-ISSUE A-C04: corrupt localStorage silently resets, then is overwritten on first edit', async () => {
  const app = await openApp(browser, {state: '{"project": {"name": "Important job"'});   // truncated JSON
  const name = await app.page.evaluate(() => S.project.name);
  assert.equal(name, 'New project', 'started from an empty project with no message');
  assert.equal(await app.page.evaluate(k => localStorage.getItem(k), STORAGE_KEY), '{"project": {"name": "Important job"', 'corrupt data still present before edit');
  await app.page.evaluate(() => App.addLevel());
  const after = await app.page.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
  assert.notEqual(after, '{"project": {"name": "Important job"', 'original data overwritten');
  assert.deepEqual(app.dialogs, [], 'no warning shown');
  await app.close();
});
