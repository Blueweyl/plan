// Headless check: opens estimator.html, runs the built-in self-test, then adds
// one element of every type and confirms the BOQ renders with a total.
// Usage: node tests/selftest.mjs [screenshotDir]
import {createRequire} from 'node:module';
import {execSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.resolve(here, '..', 'estimator.html');
const shots = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

await page.goto(url + '#selftest');
const summary = await page.textContent('#selftest-summary');
const fails = await page.$$eval('#selftest td.fail', tds => tds.map(td => td.parentElement.innerText));
console.log('Self-test:', summary);
fails.forEach(f => console.log('  ' + f.replace(/\s+/g, ' ')));
if (shots) await page.screenshot({path: path.join(shots, 'selftest.png'), fullPage: true});

// Add one of each element type with default inputs
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => App.tab('elements'));
const types = await page.evaluate(() => Object.keys(TYPES));
for (const t of types) {
  await page.evaluate(t => App.addEl(t), t);
  if (shots && t === 'column') await page.screenshot({path: path.join(shots, 'editor-column.png')});
  await page.click('dialog .btn.pri');
}
const count = await page.evaluate(() => S.elements.length);
console.log(`Elements added: ${count}/${types.length}`);
if (shots) await page.screenshot({path: path.join(shots, 'elements.png'), fullPage: true});

for (const t of ['project', 'rebar', 'prices', 'factors', 'boq']) {
  await page.evaluate(t => App.tab(t), t);
  if (shots) await page.screenshot({path: path.join(shots, t + '.png'), fullPage: true});
}
const total = await page.evaluate(() => buildBOQ(S).totals.grand);
console.log('BOQ grand total: PHP', total.toFixed(2));

const csv = await page.evaluate(() => boqCsv());
const xls = await page.evaluate(() => boqHtmlTable(true));
console.log(`CSV rows: ${csv.split('\r\n').length}, XLS bytes: ${xls.length}`);

// Save -> reload keeps state
await page.reload();
const after = await page.evaluate(() => S.elements.length);
console.log(`Elements after reload: ${after}`);

if (errors.length) console.log('Page errors:\n  ' + errors.join('\n  '));
await browser.close();
const ok = !fails.length && count === types.length && total > 0 && after === count && !errors.length;
console.log(ok ? 'ALL OK' : 'FAILED');
process.exit(ok ? 0 : 1);
