// Runs estimator.html in "online" mode in Chromium: google.script.run is replaced by a
// bridge to the real backend code running in Node against the in-memory Apps Script mock.
import {createGas, loadBackend} from './gas-mock.mjs';
import {openApp} from './browser.mjs';

export function createServer() {
  const gas = createGas({admin: 'admin@example.com'}), B = loadBackend(gas);
  B.setup();
  return {gas, B, failNextCall: false};
}
export async function openOnline(browser, server, user, opts = {}) {
  return openApp(browser, {...opts, beforeLoad: async page => {
    await page.exposeFunction('__gasApi', async json => {
      if (server.failNextCall) { server.failNextCall = false; throw new Error('Network connection lost'); }
      server.gas.as(user);
      return JSON.stringify(server.B.api(JSON.parse(json)));
    });
    await page.addInitScript(() => {
      const runner = (ok, fail) => new Proxy({}, {get(_, k) {
        if (k === 'withSuccessHandler') return fn => runner(fn, fail);
        if (k === 'withFailureHandler') return fn => runner(ok, fn);
        return arg => { window.__gasApi(JSON.stringify(arg)).then(r => ok && ok(JSON.parse(r)), e => fail && fail(e)); };
      }});
      window.google = {script: {run: runner(null, null)}};
    });
    if (opts.beforeLoad) await opts.beforeLoad(page);
  }});
}
// Waits until no server call is in flight and the UI has re-rendered
export const settle = page => page.waitForFunction(() => SERVER.status !== 'connecting' && SERVER.inflight === 0, null, {timeout: 5000}).then(() => page.waitForTimeout(80));
