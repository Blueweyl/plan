// Phase 1: dashboard uses only real data, navigation works, data-safety and
// security fixes (A-H01, A-H02, A-C04b, A-M03) hold, theme / responsive / keyboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readJSON, ROOT} from './lib/engine.mjs';
import {launch, openApp} from './lib/browser.mjs';

const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const BASE = readJSON('BASELINE_RESULTS.json');
const clone = x => JSON.parse(JSON.stringify(x));
const TABS = ['dashboard', 'elements', 'rebar', 'boq', 'audit', 'prices', 'factors', 'project', 'selftest'];
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('P1-01 KPI cards show the engine totals', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  const r = await app.page.evaluate(() => {
    const dd = dashData(), v = id => document.querySelector(`[data-kpi="${id}"] .val`).textContent;
    return {grand: v('grand'), direct: v('direct'), rebar: v('rebar'), conc: v('concrete'),
      exp: {grand: peso(dd.b.totals.grand), direct: peso(dd.b.totals.direct), rebar: fmt(dd.rebarKg) + ' kg', conc: fmt(dd.conc, 2) + ' m³'}, grandNum: dd.b.totals.grand};
  });
  assert.equal(r.grand, r.exp.grand); assert.equal(r.direct, r.exp.direct); assert.equal(r.rebar, r.exp.rebar); assert.equal(r.conc, r.exp.conc);
  assert.equal(r.grandNum, BASE.boq.totals.grand);
  await app.close();
});

test('P1-02 division cards match BOQ division totals and add up to the direct cost', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  const r = await app.page.evaluate(() => ({cards: [...document.querySelectorAll('.divcard')].map(c => [c.dataset.arg, c.querySelector('.amt').textContent]),
    exp: buildBOQ(S).divTotals.map(d => [d.div, peso(d.amt)])}));
  assert.deepEqual(r.cards, r.exp);
  assert.equal(r.cards.length, BASE.boq.divTotals.length);
  await app.close();
});

test('P1-03 every peso amount on the dashboard is a computed value (no fabricated numbers)', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  const r = await app.page.evaluate(() => {
    const dd = dashData(), allowed = new Set([dd.b.totals.grand, dd.b.totals.direct, ...dd.divs.flatMap(d => [d.amt, d.mat, d.lab]), ...dd.perLevel.map(([, a]) => a)].map(peso));
    const found = document.getElementById('view').innerText.match(/₱[\d,]+\.\d\d/g) || [];
    return {found, bad: found.filter(x => !allowed.has(x))};
  });
  assert.ok(r.found.length >= 10);
  assert.deepEqual(r.bad, []);
  await app.close();
});

test('P1-04 every navigation item opens a working view', async () => {
  const app = await openApp(browser, {state: fixture});
  const n = await app.page.locator('#nav button').count();
  assert.equal(n, 8);
  for (let i = 0; i < n; i++) {
    const b = app.page.locator('#nav button').nth(i);
    await b.click();
    assert.equal(await b.getAttribute('aria-current'), 'page');
    assert.ok((await app.page.textContent('#view')).trim().length > 40);
  }
  await app.page.click('#sideFoot a');
  assert.equal(await app.page.textContent('#selftest-summary'), '8/8 passed');
  assert.deepEqual(app.errors, []);
  await app.close();
});

test('P1-05 every control on every view is wired to a real action (no dummy controls)', async () => {
  const app = await openApp(browser, {state: fixture});
  const known = ['addElBtn', 'edit', 'copy', 'del', 'lvUp', 'lvDown', 'lvDel', 'bkRestore', 'bkDownload', 'bkDelete', 'goDiv', 'closeEditor', 'saveEditor'];
  for (const t of TABS) {
    await app.page.evaluate(t => App.tab(t), t);
    const bad = await app.page.evaluate(known => [...document.querySelectorAll('[data-act]')].map(e => e.dataset.act)
      .filter(a => !(a.startsWith('tab:') || typeof App[a] === 'function' || known.includes(a))), known);
    assert.deepEqual(bad, [], 'tab ' + t);
    const buttonsWithoutAction = await app.page.evaluate(() => [...document.querySelectorAll('#view button')].filter(b => !b.closest('[data-act]') && !b.closest('dialog')).length);
    assert.equal(buttonsWithoutAction, 0, 'tab ' + t);
  }
  await app.close();
});

test('P1-06 clicking a division card opens the BOQ at that division', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  await app.page.click('.divcard[data-arg="CEIL"]');
  assert.equal(await app.page.evaluate(() => cur), 'boq');
  assert.equal(await app.page.evaluate(() => document.getElementById('div-CEIL').open), true);
  await app.close();
});

test('P1-07 quick action adds a real element and the KPIs update', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  const before = await app.page.textContent('[data-kpi="concrete"] .val');
  await app.page.click('.qa [data-arg="column"]');
  await app.page.click('dialog .btn.pri');
  assert.equal(await app.page.evaluate(() => S.elements.length), 19);
  const after = await app.page.textContent('[data-kpi="concrete"] .val');
  assert.notEqual(after, before);
  assert.equal(after, await app.page.evaluate(() => fmt(dashData().conc, 2) + ' m³'));
  await app.close();
});

test('P1-08 "Needs attention" reports real counts and clears when resolved', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('dashboard'));
  const used = await app.page.evaluate(() => new Set(buildBOQ(S).rows.filter(r => r.kind === 'mat').map(r => r.code)).size);
  assert.match(await app.page.textContent('#view'), new RegExp(`${used} of ${used} priced materials use sample prices`));
  await app.page.evaluate(() => { for (const p of Object.values(S.prices)) p.source = 'user'; persist(); render(); });
  assert.doesNotMatch(await app.page.textContent('#view'), /use sample prices/);
  await app.close();
});

test('P1-09 (fixes A-C04b) a failed autosave is shown, not swallowed', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await app.page.evaluate(() => App.addLevel());
  assert.match(await app.page.textContent('#saveStatus'), /Not saved/);
  await app.page.evaluate(() => App.tab('dashboard'));
  assert.match(await app.page.textContent('#view'), /Changes are not being saved in this browser/);
  await app.close();
});

test('P1-10 light theme by default; dark toggle persists across reloads', async () => {
  const app = await openApp(browser, {state: fixture});
  assert.equal(await app.page.getAttribute('html', 'data-theme'), 'light');
  await app.page.click('#themeBtn');
  assert.equal(await app.page.getAttribute('html', 'data-theme'), 'dark');
  await app.page.reload();
  assert.equal(await app.page.getAttribute('html', 'data-theme'), 'dark');
  const bg = await app.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(22, 27, 36)');
  await app.close();
});

test('P1-11 (fixes A-H01) no script from a project file runs on any view', async () => {
  const x = n => `<img src=x onerror="window.__pwned=(window.__pwned||[]).concat(${n})">`;
  const f = clone(fixture);
  f.elements[0].qty = x(1); f.elements[1].id = "x');window.__pwned=[2];('"; f.elements[2].mark = x(3);
  f.elements[3].inp.b = x(4); f.elements[5].inp.open = x(5); f.elements[4].inp.cls = x(6);
  f.levels[0].name = x(7); f.levels[1].h = '"><img src=x onerror=window.__pwned=[8]>';
  f.project.name = x(9); f.project.location = x(10); f.prices.CEM.name = x(11); f.prices.SAND.price = x(12);
  f.labor.L_RB.name = x(13); f.factors.concrete[x(14)] = {cement: 1, sand: 1, gravel: 1}; f.factors.rebar.lapFactor = x(15);
  f.elements.push({id: 'q1', type: x(16), mark: x(17), level: 'lvl-ground', qty: 1, inp: {}});
  f[x(18)] = 1;
  const app = await openApp(browser, {state: f});
  for (const t of TABS) { await app.page.evaluate(t => App.tab(t), t); await app.page.waitForTimeout(50); }
  await app.page.evaluate(() => App.tab('elements'));
  for (const b of await app.page.locator('button', {hasText: 'Edit'}).all()) { await b.click(); await app.page.evaluate(() => closeEditor()); }
  await app.page.waitForTimeout(100);
  assert.equal(await app.page.evaluate(() => window.__pwned), undefined);
  assert.match(await app.page.textContent('#projName'), /<img src=x/, 'shown as text, not executed');
  assert.deepEqual(app.errors, []);
  await app.close();
});

test('P1-12 (fixes A-H02) Open… asks first and keeps a backup; Cancel changes nothing', async () => {
  const other = clone(fixture); other.project.name = 'Other job'; other.elements = [];
  const file = path.join(ROOT, 'tests/fixtures/.tmp-open.json');
  fs.writeFileSync(file, JSON.stringify(other));
  try {
    // Cancel
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto('file://' + path.join(ROOT, 'estimator.html'));
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('estimator.v1', s); }, JSON.stringify(fixture));
    await page.reload();
    page.on('dialog', d => d.dismiss());
    await page.setInputFiles('#fileIn', file);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => S.elements.length), 18);
    await ctx.close();
    // Accept
    const app = await openApp(browser, {state: fixture});
    await app.page.setInputFiles('#fileIn', file);
    await app.page.waitForFunction(() => S.project.name === 'Other job');
    assert.equal(app.dialogs.length, 1); assert.match(app.dialogs[0].message, /Replace the current project/);
    const bk = await app.page.evaluate(() => backupKeys().filter(k => k.endsWith('.before-open')).map(k => JSON.parse(localStorage.getItem(k)).elements.length));
    assert.deepEqual(bk, [18]);
    await app.page.evaluate(() => App.restoreBackup(backupKeys().find(k => k.endsWith('.before-open'))));
    assert.equal(await app.page.evaluate(() => S.elements.length), 18, 'restored from backup');
    await app.close();
  } finally { fs.unlinkSync(file); }
});

test('P1-13 (fixes A-M03) default project date is the local date (Manila, 06:30)', async () => {
  const app = await openApp(browser, {contextOptions: {timezoneId: 'Asia/Manila'}});
  const d = await app.page.evaluate(() => { const real = Date; const t = new real('2026-10-23T06:30:00+08:00').getTime();
    globalThis.Date = class extends real { constructor(...a) { super(...(a.length ? a : [t])); } }; return defaultState().project.date; });
  assert.equal(d, '2026-10-23');
  await app.close();
});

for (const width of [375, 768, 1280]) {
  test(`P1-14 layout at ${width}px: no horizontal page scroll on any view`, async () => {
    const app = await openApp(browser, {state: fixture, contextOptions: {viewport: {width, height: 800}}});
    for (const t of TABS) {
      await app.page.evaluate(t => App.tab(t), t);
      const over = await app.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `tab ${t} overflows by ${over}px`);
    }
    const sideVisible = await app.page.evaluate(() => document.getElementById('side').getBoundingClientRect().right > 0);
    assert.equal(sideVisible, width > 900, 'sidebar docked only on wide screens');
    if (width <= 900) {
      await app.page.click('.menu-btn');
      await app.page.waitForTimeout(300);
      assert.ok(await app.page.evaluate(() => document.getElementById('side').getBoundingClientRect().left >= 0), 'drawer opens');
      await app.page.locator('#nav button', {hasText: 'Prices'}).click();
      assert.equal(await app.page.evaluate(() => cur), 'prices');
    }
    await app.close();
  });
}

test('P1-15 navigation works from the keyboard', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.focus('#nav button:nth-child(4)');
  await app.page.keyboard.press('Enter');
  assert.equal(await app.page.evaluate(() => cur), 'boq');
  await app.page.keyboard.press('Tab');
  assert.match(await app.page.evaluate(() => document.activeElement.textContent.trim()), /^Audit/);
  await app.close();
});

test('P1-16 empty project shows a guided start, no NaN or undefined', async () => {
  const app = await openApp(browser);
  await app.page.evaluate(() => App.tab('dashboard'));
  const txt = await app.page.textContent('#view');
  assert.match(txt, /Add your first column/);
  for (const t of TABS) { await app.page.evaluate(t => App.tab(t), t); assert.doesNotMatch(await app.page.textContent('#view'), /NaN|undefined|Infinity/, t); }
  await app.close();
});

test('P1-17 revision chip and file-save status reflect real state', async () => {
  const app = await openApp(browser, {state: fixture});
  assert.match(await app.page.textContent('#revChip'), /Rev 0 · Working draft/);
  await app.page.evaluate(() => { App.addLevel(); App.addLevel(); });
  assert.match(await app.page.textContent('#saveStatus'), /2 unsaved to file/);
  await app.page.evaluate(() => App.saveFile());
  assert.match(await app.page.textContent('#saveStatus'), /File saved/);
  assert.equal(await app.page.evaluate(() => S.meta.changesSinceFile), 0);
  await app.close();
});

test('P1-18 (mitigates A-C02) un-purchasable rebar is shown as critical', async () => {
  const f = clone(fixture); f.settings.stock = '6'; f.factors.rebar.lapFactor = 400;
  const app = await openApp(browser, {state: f});
  await app.page.evaluate(() => App.tab('dashboard'));
  assert.match(await app.page.textContent('#view'), /Rebar missing from the BOQ/);
  await app.page.evaluate(() => App.tab('rebar'));
  assert.match(await app.page.textContent('#view'), /Not purchasable/);
  await app.close();
});

test('P1-19 every non-geometry coefficient starts unverified and verification is recorded', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('factors'));
  const box = app.page.locator('input[data-bind="factor:concrete.A.cement:verified"]');
  assert.equal(await box.isChecked(), false);
  await app.page.fill('input[data-bind="factor:concrete.A.cement:ref"]', 'Table 1-3, p. 12');
  await app.page.locator('input[data-bind="factor:concrete.A.cement:ref"]').dispatchEvent('change');
  await app.page.locator('input[data-bind="factor:concrete.A.cement:verified"]').check();
  const m = await app.page.evaluate(() => S.factorMeta['concrete.A.cement']);
  assert.equal(m.verified, true); assert.equal(m.ref, 'Table 1-3, p. 12');
  assert.equal(await app.page.evaluate(() => buildBOQ(S).totals.grand), BASE.boq.totals.grand, 'metadata never changes numbers');
  await app.close();
});
