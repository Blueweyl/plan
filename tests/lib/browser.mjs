// Playwright helpers: open estimator.html from disk with a given saved state.
import {createRequire} from 'node:module';
import {execSync} from 'node:child_process';
import path from 'node:path';
import {APP_HTML} from './engine.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); }
catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

export const APP_URL = 'file://' + APP_HTML;
export const STORAGE_KEY = 'estimator.v1';

export async function launch() { return pw.chromium.launch(); }

// Opens a fresh page. `state` (object or raw string) is written to localStorage
// before the app boots. Collects page errors and dialogs for assertions.
export async function openApp(browser, {state, contextOptions = {}, url = APP_URL, beforeLoad} = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, ...contextOptions});
  const page = await context.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push({type: d.type(), message: d.message()}); d.accept(); });
  await page.goto(url);
  await page.evaluate(({key, raw}) => {
    localStorage.clear();
    if (raw !== null) localStorage.setItem(key, raw);
  }, {key: STORAGE_KEY, raw: state === undefined ? null : (typeof state === 'string' ? state : JSON.stringify(state))});
  if (beforeLoad) await beforeLoad(page);
  await page.reload();
  return {context, page, errors, dialogs, close: () => context.close()};
}
