// Phase 6 end-to-end: the real app in Chromium, online, against the real backend code
// (Node + Apps Script mock). Each user has their own browser context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readJSON, ROOT} from './lib/engine.mjs';
import {launch, openApp} from './lib/browser.mjs';
import {createServer, openOnline, settle} from './lib/online.mjs';

const ADMIN = 'admin@example.com', EST = 'est@example.com', EST2 = 'est2@example.com', REV = 'rev@example.com';
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

async function adminCreates(server) {
  const a = await openOnline(browser, server, ADMIN, {state: fixture});
  await settle(a.page);
  await a.page.evaluate(() => App.tab('project'));
  await a.page.click('button[data-act="serverSaveBtn"]');
  await settle(a.page);
  const pid = await a.page.evaluate(() => S.meta.server.projectId);
  for (const [email, role] of [[EST, 'estimator'], [EST2, 'estimator'], [REV, 'reviewer']]) assert.ok(server.B.OPS && (server.gas.as(ADMIN), server.B.api({op: 'setMember', args: {projectId: pid, email, role}, requestId: 'm' + Math.random().toString(36).slice(2, 12)})).ok);
  return {a, pid};
}
async function userOpens(server, user, pid) {
  const u = await openOnline(browser, server, user);
  await settle(u.page);
  await u.page.evaluate(pid => App.serverOpen(pid), pid);
  await settle(u.page);
  return u;
}

test('O6-01 the standalone file stays offline and says so', async () => {
  const app = await openApp(browser, {state: fixture});
  await app.page.evaluate(() => App.tab('project'));
  assert.equal(await app.page.evaluate(() => SERVER.available), false);
  assert.match(await app.page.textContent('#view'), /standalone file and works offline/);
  assert.equal(await app.page.locator('#serverChip').count(), 0);
  await app.close();
});

test('O6-02 create on the server: verified confirmation, then reload comes from the server', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server);
  const r = await a.page.evaluate(() => ({link: S.meta.server, v: SERVER.verified}));
  assert.equal(r.link.version, 1); assert.equal(r.link.dirty, false); assert.equal(r.v.ok, true);
  assert.match(await a.page.textContent('#serverChip'), /Server v1 ✓/);
  assert.match(pid, /^p[0-9a-f]{16}$/);
  await a.page.reload(); await settle(a.page);
  assert.equal(await a.page.evaluate(() => SERVER.status), 'ok');
  assert.equal(await a.page.evaluate(() => buildBOQ(S).totals.grand), readJSON('BASELINE_RESULTS.json').boq.totals.grand);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('O6-03 the browser cache is not authoritative', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server);
  await a.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('estimator.v1')); s.prices.CEM.price = 1; s.meta.server.dirty = false; localStorage.setItem('estimator.v1', JSON.stringify(s)); });
  await a.page.reload(); await settle(a.page);
  assert.equal(await a.page.evaluate(() => S.prices.CEM.price), 260, 'a tampered, "clean" cache is replaced by the server copy');
  await a.page.evaluate(() => { S.prices.CEM.price = 333; persist(); });
  await a.page.reload(); await settle(a.page);
  assert.equal(await a.page.evaluate(() => S.prices.CEM.price), 333, 'real unsynced changes are kept, not lost');
  assert.match(await a.page.textContent('#serverChip'), /unsynced/);
  assert.ok(pid);
  await a.close();
});

test('O6-04 concurrent edits: the second save gets a conflict with a diff; both resolutions work', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server); await a.close();
  const e1 = await userOpens(server, EST, pid), e2 = await userOpens(server, EST2, pid);
  await e1.page.evaluate(() => { S.prices.CEM.price = 300; persist(); serverSave(); }); await settle(e1.page);
  assert.equal(await e1.page.evaluate(() => S.meta.server.version), 2);
  await e2.page.evaluate(() => { S.elements[0].qty = 12; persist(); App.tab('project'); serverSave(); }); await settle(e2.page);
  const txt = await e2.page.textContent('#serverConflict');
  assert.match(txt, /Server version 2 was saved by est@example\.com/);
  assert.match(txt, /changed F1.*qty 9 → 12/s);
  assert.match(txt, /prices CEM\.price: 300 → 260/);
  assert.match(await e2.page.textContent('#serverChip'), /conflict/);
  // keep mine: saves as v3 on top of v2 (explicit, after confirmation)
  await e2.page.click('button[data-act="conflictKeepMine"]'); await settle(e2.page);
  assert.deepEqual(await e2.page.evaluate(() => [S.meta.server.version, S.elements[0].qty, S.prices.CEM.price]), [3, 12, 260]);
  // take server: est1 now conflicts with v3 and takes the server copy; the local copy is backed up
  await e1.page.evaluate(() => { S.prices.SAND.price = 1; persist(); serverSave(); }); await settle(e1.page);
  await e1.page.evaluate(() => App.tab('project'));
  await e1.page.click('button[data-act="conflictTakeServer"]'); await settle(e1.page);
  assert.deepEqual(await e1.page.evaluate(() => [S.meta.server.version, S.elements[0].qty, S.prices.SAND.price, backupKeys().some(k => k.includes('conflict-take-server'))]), [3, 12, 1500, true]);
  await e1.close(); await e2.close();
});

test('O6-05 reviewer: cannot change inputs; comments are saved under the reviewer identity', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server);
  await a.page.evaluate(() => { localStorage.setItem('estimator.user', 'Admin'); App.tab('revisions'); document.getElementById('revDesc').value = 'For review'; App.revSubmit(); serverSave(); });
  await settle(a.page); await a.close();
  const r = await userOpens(server, REV, pid);
  await r.page.evaluate(() => { localStorage.setItem('estimator.user', 'Forged Name'); S.prices.CEM.price = 1; persist(); App.tab('project'); serverSave(); }); await settle(r.page);
  assert.match(await r.page.textContent('#serverError'), /reviewer cannot change quantities, prices or settings/);
  await r.page.evaluate(() => App.serverReload()); await settle(r.page);
  await r.page.evaluate(() => { App.tab('revisions'); App.revView(1); }); await r.page.fill('#revComment', 'Please confirm the CHB openings'); await r.page.click('button[data-act="revComment"]');
  await r.page.evaluate(() => serverSave()); await settle(r.page);
  const c = await r.page.evaluate(() => S.revisions[0].comments[0]);
  assert.deepEqual([c.by, c.text], [REV, 'Please confirm the CHB openings'], 'the server replaced the typed name with the signed-in account');
  await r.close();
});

test('O6-06 a lost connection does not lose or duplicate the save: retry sends the same request', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server);
  await a.page.evaluate(() => { S.prices.CEM.price = 290; persist(); });
  server.failNextCall = true;
  await a.page.evaluate(() => { App.tab('project'); serverSave(); }); await settle(a.page);
  assert.match(await a.page.textContent('#serverError'), /Not saved: Network connection lost/);
  const rid = await a.page.evaluate(() => SERVER.pending.rid);
  await a.page.click('button[data-act="serverRetry"]'); await settle(a.page);
  assert.equal(await a.page.evaluate(() => S.meta.server.version), 2);
  server.gas.as(ADMIN);
  const versions = server.B.api({op: 'listVersions', args: {projectId: pid}}).result.items.map(v => v.version);
  assert.deepEqual(JSON.parse(JSON.stringify(versions)), [2, 1]);
  assert.ok(rid.length === 32);
  await a.close();
});

test('O6-07 members, drawings, versions, audit log and project list through the UI', async () => {
  const server = createServer();
  const {a, pid} = await adminCreates(server);
  await a.page.evaluate(() => App.tab('project'));
  await a.page.click('button[data-act="serverPanels"]'); await settle(a.page);
  assert.equal(await a.page.locator('#serverMembers tr').count(), 4);
  await a.page.fill('#srvMemberEmail', 'new.reviewer@example.com'); await a.page.selectOption('#srvMemberRole', 'reviewer');
  await a.page.click('button[data-act="serverMemberAdd"]'); await settle(a.page);
  assert.match(await a.page.textContent('#serverMembers'), /new\.reviewer@example\.com/);
  const pdf = path.join(ROOT, 'tests/fixtures/.tmp-drawing.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n%test drawing\n%%EOF');
  try { await a.page.setInputFiles('#srvDrawing', pdf); await a.page.waitForFunction(() => SERVER.drawings && SERVER.drawings.length === 1); }
  finally { fs.unlinkSync(pdf); }
  await settle(a.page);
  assert.match(await a.page.textContent('#serverDrawings'), /\.tmp-drawing\.pdf/);
  await a.page.click('button[data-act="serverAuditBtn"]'); await settle(a.page);
  assert.match(await a.page.textContent('#serverAudit'), /uploadDrawing/);
  await a.page.click('button[data-act="serverList"]'); await settle(a.page);
  assert.match(await a.page.textContent('#serverList'), new RegExp(pid));
  for (const t of ['dashboard', 'elements', 'rebar', 'boq', 'audit', 'revisions', 'prices', 'labor', 'factors', 'project']) await a.page.evaluate(t => App.tab(t), t);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('O6-08 sign-in required: an unauthenticated session shows the sign-in state', async () => {
  const server = createServer();
  const u = await openOnline(browser, server, '');
  await settle(u.page);
  assert.equal(await u.page.evaluate(() => SERVER.status), 'signin');
  await u.page.evaluate(() => App.tab('project'));
  assert.match(await u.page.textContent('#serverCard'), /Sign in with your Google account/);
  await u.close();
});
