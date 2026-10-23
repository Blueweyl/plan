// Phase 6 backend: Apps Script server code running against an in-memory mock of
// Sheets/Drive/Lock/Session. Users and data below are test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createGas, loadBackend} from './lib/gas-mock.mjs';
import {readJSON, ROOT} from './lib/engine.mjs';

const ADMIN = 'admin@example.com', EST = 'est@example.com', EST2 = 'est2@example.com', REV = 'rev@example.com', OUT = 'out@example.com';
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
let ridN = 0;
const rid = () => 'req' + String(++ridN).padStart(8, '0');
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

function fresh() {
  const gas = createGas({admin: ADMIN}), B = loadBackend(gas);
  B.setup();
  const call = (user, op, args = {}, requestId) => { gas.as(user); return B.api({op, args, requestId: requestId === undefined && B.OPS[op].write ? rid() : requestId}); };
  const base = B.migrate(fixture).state;
  const ready = () => {   // test inputs that clear the critical findings
    const s = JSON.parse(JSON.stringify(base));
    for (const p of Object.values(s.prices)) { p.source = 'user'; p.updatedAt = new Date().toISOString().slice(0, 10); }
    for (const l of Object.values(s.labor)) { l.source = 'user'; l.updatedAt = new Date().toISOString().slice(0, 10); }
    for (const m of Object.values(s.factorMeta)) m.verified = true;
    return s;
  };
  const project = (st = base, user = ADMIN) => {
    const r = call(user, 'createProject', {project: JSON.stringify(st)});
    assert.ok(r.ok, JSON.stringify(r.error));
    const pid = r.result.projectId;
    for (const [e, role] of [[EST, 'estimator'], [EST2, 'estimator'], [REV, 'reviewer']]) assert.ok(call(ADMIN, 'setMember', {projectId: pid, email: e, role}).ok);
    return pid;
  };
  const get = (user, pid) => { const r = call(user, 'getProject', {projectId: pid}); assert.ok(r.ok, JSON.stringify(r.error)); return {...r.result, state: JSON.parse(r.result.project)}; };
  const save = (user, pid, baseVersion, st, requestId) => call(user, 'saveProject', {projectId: pid, baseVersion, project: JSON.stringify(st)}, requestId);
  // A revision built the way the browser builds it (snapshot + recomputed results)
  const addRevision = (st, status = 'submitted', extra = {}) => {
    const snapshot = B.snapshotOf(st), b = B.buildBOQ(st), au = B.runAudit(st, {today: '2026-10-23'});
    const no = (st.revisions.reduce((m, r) => Math.max(m, r.no), 0)) + 1;
    st.revisions.push({no, id: 'rv' + no, createdAt: 'client-time', createdBy: 'forged@example.com', description: 'Rev ' + no, basedOn: null, status,
      versions: {engine: '1.0.0'}, snapshot, snapshotHash: B.hash64(snapshot), results: JSON.parse(JSON.stringify({totals: b.totals, divTotals: b.divTotals, rows: b.rows, hashes: au.hashes})),
      audit: {counts: au.counts}, statusLog: [{at: 'x', by: 'forged@example.com', from: null, to: status, note: ''}], comments: [], approval: null, ...extra});
    return st.revisions.at(-1);
  };
  return {gas, B, call, base, ready, project, get, save, addRevision};
}
const versionRows = (gas, pid) => gas.sheet('Versions').data.slice(1).filter(r => r[0] === pid);

test('B6-01 setup is idempotent: sheets with headers, deployer is admin, one backup trigger', () => {
  const {gas, B} = fresh();
  const again = B.setup();
  assert.deepEqual(JSON.parse(JSON.stringify(again.admins)), [ADMIN]);
  for (const [n, h] of Object.entries(B.CFG.SHEETS)) assert.deepEqual(gas.sheet(n).data[0], h, n);
  assert.equal(gas.st.triggers.length, 1);
});

test('B6-02 authentication: Workspace session, verified ID token, rejected tokens', () => {
  const {gas, B} = fresh();
  gas.as(''); assert.equal(B.api({op: 'whoami'}).error.code, 'UNAUTHENTICATED');
  gas.st.props.CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const exp = Math.floor(Date.now() / 1000) + 600;
  const reply = claims => () => ({code: 200, body: JSON.stringify({iss: 'https://accounts.google.com', aud: 'client-123.apps.googleusercontent.com', email: 'Gmail.User@gmail.com', email_verified: 'true', exp, ...claims})});
  gas.st.fetch = reply({}); assert.equal(B.api({op: 'whoami', idToken: 't'}).result.email, 'gmail.user@gmail.com');
  for (const bad of [{aud: 'other'}, {email_verified: 'false'}, {exp: 1}, {iss: 'evil.example'}]) { gas.st.fetch = reply(bad); assert.equal(B.api({op: 'whoami', idToken: 't'}).error.code, 'UNAUTHENTICATED', JSON.stringify(bad)); }
  gas.st.fetch = () => ({code: 400, body: ''}); assert.equal(B.api({op: 'whoami', idToken: 't'}).error.code, 'UNAUTHENTICATED');
});

test('B6-03 who may create projects', () => {
  const {gas, call, base} = fresh();
  assert.equal(call(OUT, 'createProject', {project: JSON.stringify(base)}).error.code, 'FORBIDDEN');
  gas.st.props.CREATORS = '*';
  const r = call(OUT, 'createProject', {project: JSON.stringify(base)});
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse(JSON.stringify(call(OUT, 'whoami').result.memberships)), [{projectId: r.result.projectId, role: 'estimator'}]);
});

test('B6-04 project-specific access: outsiders see nothing; members see their projects', () => {
  const {call, project} = fresh();
  const pid = project();
  assert.equal(call(OUT, 'getProject', {projectId: pid}).error.code, 'FORBIDDEN');
  assert.equal(call(OUT, 'listProjects').result.items.length, 0);
  for (const u of [EST, REV, ADMIN]) assert.equal(call(u, 'listProjects').result.items[0].projectId, pid);
  assert.equal(call(REV, 'listProjects').result.items[0].role, 'reviewer');
});

test('B6-05 server-side validation: invalid data is rejected, never silently fixed or stored', () => {
  const {gas, call, project, get, save} = fresh();
  const pid = project(), before = versionRows(gas, pid).length;
  const st = get(EST, pid).state;
  assert.equal(call(EST, 'saveProject', {projectId: pid, baseVersion: 1, project: '{not json'}).error.code, 'INVALID');
  const bad = JSON.parse(JSON.stringify(st)); bad.elements[0].qty = '<img src=x onerror=alert(1)>'; bad.factors.concrete.Z = {cement: 1};
  const r = save(EST, pid, 1, bad);
  assert.equal(r.error.code, 'INVALID');
  assert.ok(r.error.report.some(x => x.code === 'INVALID_VALUE') && r.error.report.some(x => x.code === 'UNKNOWN_KEY'));
  assert.equal(call(EST, 'saveProject', {projectId: pid, baseVersion: 1, project: 'x'.repeat(5 * 1024 * 1024 + 1)}).error.code, 'TOO_LARGE');
  assert.equal(versionRows(gas, pid).length, before, 'nothing written');
});

test('B6-06 optimistic concurrency: a stale save is a conflict; retrying on the new version works', () => {
  const {call, project, get, save} = fresh();
  const pid = project();
  const a = get(EST, pid), b = get(EST2, pid);
  a.state.prices.CEM.price = 300; assert.equal(save(EST, pid, a.version, a.state).result.version, 2);
  b.state.prices.SAND.price = 1800;
  const c = save(EST2, pid, b.version, b.state);
  assert.equal(c.error.code, 'CONFLICT'); assert.equal(c.error.currentVersion, 2); assert.equal(c.error.savedBy, EST);
  const fresh2 = get(EST2, pid); fresh2.state.prices.SAND.price = 1800;
  assert.equal(save(EST2, pid, fresh2.version, fresh2.state).result.version, 3);
  const final = get(ADMIN, pid).state;
  assert.deepEqual([final.prices.CEM.price, final.prices.SAND.price], [300, 1800], 'both changes kept, none lost');
  assert.ok(call(ADMIN, 'listVersions', {projectId: pid}).result.items.map(v => v.version).join() === '3,2,1');
});

test('B6-07 idempotent saves: a replayed requestId returns the same result without a second version', () => {
  const {gas, call, project, get, save} = fresh();
  const pid = project(), st = get(EST, pid).state; st.prices.CEM.price = 300;
  const r1 = save(EST, pid, 1, st, 'replay-0001'), rows = versionRows(gas, pid).length;
  const r2 = save(EST, pid, 1, st, 'replay-0001');
  assert.equal(r2.result.version, r1.result.version); assert.equal(r2.result.replayed, true); assert.equal(r2.result.project, r1.result.project);
  assert.equal(versionRows(gas, pid).length, rows);
  assert.equal(call(EST2, 'saveProject', {projectId: pid, baseVersion: 2, project: JSON.stringify(st)}, 'replay-0001').error.code, 'BAD_REQUEST', 'another user cannot reuse it');
  assert.equal(call(EST, 'saveProject', {projectId: pid, baseVersion: 2, project: '{}'}, 'x').error.code, 'BAD_REQUEST', 'requestId required');
});

test('B6-08 atomic commit: a failure before the commit leaves the previous version current and is recovered', () => {
  const {gas, call, project, get, save} = fresh();
  const pid = project(), st = get(EST, pid).state; st.prices.CEM.price = 300;
  gas.failNext('setValues:Projects');
  const r = save(EST, pid, 1, st, 'atomic-0001');
  assert.equal(r.error.code, 'INTERNAL');
  assert.equal(gas.st.locked, false, 'lock released');
  assert.equal(get(ADMIN, pid).version, 1, 'still version 1');
  assert.equal(get(ADMIN, pid).state.prices.CEM.price, 260);
  assert.ok(versionRows(gas, pid).some(row => row[1] === 2), 'orphan chunks of the failed write exist');
  const retry = save(EST, pid, 1, st, 'atomic-0001');
  assert.equal(retry.result.version, 2, 'the retry with the same requestId succeeds');
  assert.equal(versionRows(gas, pid).filter(row => row[1] === 2).length, 1, 'orphans were removed before the retry');
  gas.failNext('setValues:Versions');
  const st2 = get(EST, pid).state; st2.prices.SAND.price = 9;
  assert.equal(save(EST, pid, 2, st2).error.code, 'INTERNAL');
  assert.equal(get(ADMIN, pid).version, 2);
});

test('B6-09 large projects are chunked across cells and verified on read', () => {
  const {gas, call, project, get, save} = fresh();
  const pid = project(), st = get(EST, pid).state;
  st.project.notes = 'n'.repeat(120000);
  const r = save(EST, pid, 1, st);
  assert.ok(r.ok);
  const rows = versionRows(gas, pid).filter(row => row[1] === 2);
  assert.ok(rows.length >= 4, `${rows.length} chunks`);
  assert.equal(get(ADMIN, pid).state.project.notes.length, 120000);
  rows[1][4] = rows[1][4].slice(0, -1) + 'X';
  assert.equal(call(ADMIN, 'getProject', {projectId: pid}).error.code, 'CORRUPT', 'tampered chunk fails the checksum');
});

test('B6-10 server-verified save confirmation', () => {
  const {B, project, get, save} = fresh();
  const pid = project(), st = get(EST, pid).state; st.prices.CEM.price = 300;
  const r = save(EST, pid, 1, st).result;
  assert.equal(r.sha256, sha(r.project), 'hash of exactly what was stored');
  assert.ok(Math.abs(B.buildBOQ(JSON.parse(r.project)).totals.grand - r.grandTotal) < 1e-9, 'server-computed total');
});

test('B6-11 reviewers can comment but not change inputs; identities are stamped by the server', () => {
  const {call, project, get, save, addRevision, ready} = fresh();
  const pid = project(ready()), s1 = get(EST, pid).state;
  addRevision(s1);
  const r1 = save(EST, pid, 1, s1).result, stored = JSON.parse(r1.project).revisions[0];
  assert.equal(stored.createdBy, EST, 'server replaced the forged creator');
  assert.ok(stored.statusLog.every(l => l.by === EST));
  const rv = get(REV, pid).state;
  rv.prices.CEM.price = 1;
  assert.equal(save(REV, pid, 2, rv).error.code, 'FORBIDDEN');
  const rc = get(REV, pid).state;
  rc.revisions[0].comments.push({at: 'x', by: 'someone-else@example.com', text: 'Check CHB1 openings'});
  const r = save(REV, pid, 2, rc).result;
  assert.deepEqual([JSON.parse(r.project).revisions[0].comments[0].by, JSON.parse(r.project).revisions[0].comments[0].text], [REV, 'Check CHB1 openings']);
  assert.equal(call(OUT, 'saveProject', {projectId: pid, baseVersion: 3, project: r.project}).error.code, 'FORBIDDEN');
});

test('B6-12 revision rules: immutable history, append-only logs, role-based approval, server-checked results', () => {
  const {call, project, get, save, addRevision, ready, base} = fresh();
  const pid = project(ready());
  let s = get(EST, pid).state; addRevision(s); assert.ok(save(EST, pid, 1, s).ok);
  // forged results / tampered snapshot are rejected
  s = get(EST, pid).state; const f = addRevision(s); f.results.totals.grand += 1000;
  assert.match(save(EST, pid, 2, s).error.message, /results do not match/);
  s = get(EST, pid).state; const t = addRevision(s); t.snapshot = t.snapshot.replace('"price":260', '"price":1');
  assert.match(save(EST, pid, 2, s).error.message, /snapshot does not match its hash/);
  // history cannot be changed or removed
  s = get(EST, pid).state; s.revisions[0].description = 'rewritten'; assert.equal(save(EST, pid, 2, s).error.code, 'IMMUTABLE');
  s = get(EST, pid).state; s.revisions = []; assert.equal(save(EST, pid, 2, s).error.code, 'IMMUTABLE');
  // estimators cannot approve; reviewers can, and the approval is stamped
  const approve = (st, by) => { const r = st.revisions[0]; r.status = 'approved'; r.statusLog.push({at: 'x', by, from: 'submitted', to: 'approved', note: ''}); r.approval = {at: 'x', by}; st.audit.approval = {revisionNo: 1, by, at: 'x', hashes: {}}; st.meta.status = 'approved'; return st; };
  assert.equal(save(EST, pid, 2, approve(get(EST, pid).state, EST)).error.code, 'FORBIDDEN');
  const ok = save(REV, pid, 2, approve(get(REV, pid).state, 'forged@example.com'));
  assert.ok(ok.ok, JSON.stringify(ok.error));
  const done = JSON.parse(ok.result.project);
  assert.deepEqual([done.revisions[0].approval.by, done.audit.approval.by], [REV, REV]);
  // an existing comment cannot be edited
  s = get(REV, pid).state; s.revisions[0].comments.push({text: 'first'}); const c1 = save(REV, pid, 3, s).result;
  s = JSON.parse(c1.project); s.revisions[0].comments[0].text = 'edited'; assert.equal(save(REV, pid, 4, s).error.code, 'IMMUTABLE');
  // separation of duties: a user cannot approve their own submission
  const pid2 = project(ready());
  let s2 = get(EST, pid2).state; addRevision(s2); assert.ok(save(EST, pid2, 1, s2).ok);
  assert.ok(call(ADMIN, 'setMember', {projectId: pid2, email: EST, role: 'reviewer'}).ok);
  assert.match(save(EST, pid2, 2, approve(get(EST, pid2).state, EST)).error.message, /submitted/);
  // a revision with critical findings cannot be approved, even by a reviewer
  const pid3 = project(base);
  let s3 = get(EST, pid3).state; addRevision(s3); assert.ok(save(EST, pid3, 1, s3).ok);
  assert.equal(save(REV, pid3, 2, approve(get(REV, pid3).state, REV)).error.code, 'BLOCKED');
});

test('B6-13 soft delete and restore', () => {
  const {call, project, get, save} = fresh();
  const pid = project();
  assert.equal(call(EST, 'deleteProject', {projectId: pid}).error.code, 'FORBIDDEN');
  assert.ok(call(ADMIN, 'deleteProject', {projectId: pid}).ok);
  assert.equal(call(EST, 'listProjects').result.items.length, 0);
  assert.equal(call(EST, 'getProject', {projectId: pid}).error.code, 'NOT_FOUND');
  assert.equal(call(ADMIN, 'listProjects').result.items.length, 0);
  assert.equal(call(ADMIN, 'listProjects', {includeDeleted: true}).result.items[0].deleted, true);
  assert.equal(save(ADMIN, pid, 1, get(ADMIN, pid).state).error.code, 'NOT_FOUND');
  assert.ok(call(ADMIN, 'restoreProject', {projectId: pid}).ok);
  assert.equal(get(EST, pid).version, 1, 'data intact after restore');
});

test('B6-14 paginated listings (projects, versions, audit log)', () => {
  const {call, base} = fresh();
  for (let i = 0; i < 25; i++) assert.ok(call(ADMIN, 'createProject', {project: JSON.stringify(base)}).ok);
  const p1 = call(ADMIN, 'listProjects', {pageSize: 10}).result, p2 = call(ADMIN, 'listProjects', {pageSize: 10, pageToken: p1.nextPageToken}).result, p3 = call(ADMIN, 'listProjects', {pageSize: 10, pageToken: p2.nextPageToken}).result;
  assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p3.nextPageToken, p1.total], [10, 10, 5, null, 25]);
  assert.equal(new Set([...p1.items, ...p2.items, ...p3.items].map(x => x.projectId)).size, 25);
  assert.equal(call(ADMIN, 'listProjects', {pageToken: 'abc'}).error.code, 'BAD_REQUEST');
  assert.equal(call(ADMIN, 'listProjects', {pageSize: 1000}).result.items.length, 25, 'page size capped at 100');
  const a = call(ADMIN, 'listAudit', {pageSize: 5}).result;
  assert.equal(a.items.length, 5); assert.ok(a.items[0].at >= a.items[4].at, 'newest first');
});

test('B6-15 audit log records writes, replays and refusals with request ids', () => {
  const {gas, call, project, get, save} = fresh();
  const pid = project(), st = get(EST, pid).state;
  save(EST, pid, 1, st, 'audit-0001'); save(EST, pid, 1, st, 'audit-0001');
  call(OUT, 'getProject', {projectId: pid});
  const log = call(ADMIN, 'listAudit', {projectId: pid, pageSize: 100}).result.items;
  assert.ok(log.some(l => l.op === 'saveProject' && l.requestId === 'audit-0001' && l.result === 'ok'));
  assert.ok(log.some(l => l.op === 'saveProject' && l.result === 'replayed'));
  assert.ok(log.some(l => l.user === OUT && l.result === 'FORBIDDEN'));
  assert.equal(call(EST, 'listAudit', {}).error.code, 'FORBIDDEN', 'only admins see the global log');
  assert.ok(gas.sheet('AuditLog').data.length > 5);
});

test('B6-16 drawings: PDF only, size-limited, estimator only, stored in Drive with a checksum', () => {
  const {B, gas, call, project} = fresh();
  const pid = project(), pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const up = (u, args) => call(u, 'uploadDrawing', {projectId: pid, name: 'S-1 Foundation plan.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64'), ...args});
  const r = up(EST, {});
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.result.sha256, crypto.createHash('sha256').update(pdf).digest('hex'));
  assert.equal(gas.st.files.get(r.result.driveFileId).getSize(), pdf.length);
  assert.equal(up(EST, {base64: Buffer.from('hello').toString('base64')}).error.code, 'INVALID');
  assert.equal(up(EST, {mimeType: 'image/png'}).error.code, 'INVALID');
  assert.equal(up(REV, {}).error.code, 'FORBIDDEN');
  assert.equal(up(OUT, {}).error.code, 'FORBIDDEN');
  assert.equal(up(EST, {name: '../../etc/passwd<script>.pdf'}).result.name, '.._.._etc_passwd_script_.pdf');
  B.CFG.MAX_DRAWING_BYTES = 10;
  assert.equal(up(EST, {}).error.code, 'TOO_LARGE');
  assert.equal(call(REV, 'listDrawings', {projectId: pid}).result.items.length, 2);
});

test('B6-17 backups: admin only, newest copies kept, daily trigger logs', () => {
  const {gas, B, call} = fresh();
  gas.st.props.BACKUP_KEEP = '2';
  assert.equal(call(EST, 'runBackup').error.code, 'FORBIDDEN');
  for (let i = 0; i < 3; i++) assert.ok(call(ADMIN, 'runBackup').ok);
  const folder = gas.st.folders.get(gas.st.props.BACKUP_FOLDER_ID);
  assert.deepEqual([folder.files.length, folder.files.filter(f => f.isTrashed()).length], [3, 1]);
  const copy = gas.st.ss.get(folder.files[2].getId());
  assert.ok(copy.getSheetByName('Projects'), 'backup is a full copy of the spreadsheet');
  B.dailyBackup();
  assert.ok(gas.sheet('AuditLog').data.some(r => r[2] === 'backup'));
});

test('B6-18 the lock serialises writes; reads still work while it is held', () => {
  const {gas, call, project, get} = fresh();
  const pid = project();
  gas.st.locked = true;
  assert.equal(call(EST, 'saveProject', {projectId: pid, baseVersion: 1, project: JSON.stringify(get(EST, pid).state)}).error.code, 'BUSY');
  assert.ok(call(EST, 'getProject', {projectId: pid}).ok);
});

test('B6-19 members: validation and revocation', () => {
  const {call, project} = fresh();
  const pid = project();
  assert.equal(call(ADMIN, 'setMember', {projectId: pid, email: 'not an email', role: 'estimator'}).error.code, 'INVALID');
  assert.equal(call(ADMIN, 'setMember', {projectId: pid, email: 'x@example.com', role: 'owner'}).error.code, 'INVALID');
  assert.ok(call(ADMIN, 'setMember', {projectId: pid, email: EST, role: null}).ok);
  assert.equal(call(EST, 'getProject', {projectId: pid}).error.code, 'FORBIDDEN');
  assert.ok(call(REV, 'listMembers', {projectId: pid}).result.items.every(m => m.email !== EST));
});

test('B6-20 exports are saved to the project folder in Drive', () => {
  const {gas, call, project} = fresh();
  const pid = project();
  const r = call(REV, 'saveExport', {projectId: pid, name: 'BOQ Rev 1.csv', content: '"a","b"'});
  assert.ok(r.ok); assert.equal(gas.st.files.get(r.result.driveFileId).getName(), 'BOQ Rev 1.csv');
});

test('B6-21 the web app serves the same page as estimator.html and embeds no secrets', () => {
  const {B} = fresh();
  const out = B.doGet(), html = out.getContent();
  assert.equal(html, fs.readFileSync(path.join(ROOT, 'estimator.html'), 'utf8'));
  assert.equal(out.meta.xframe, 'DEFAULT');
  for (const re of [/client_secret/i, /AIza[0-9A-Za-z_-]{35}/, /ya29\.[0-9A-Za-z_-]+/, /BEGIN (RSA )?PRIVATE KEY/, /SPREADSHEET_ID\s*[:=]\s*['"][A-Za-z0-9_-]{20,}/]) assert.doesNotMatch(html, re);
});

test('B6-22 generated backend files are up to date with estimator.html', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-backend.mjs'), '--check'], {stdio: 'pipe'});
});

test('B6-23 unknown operations and malformed requests are rejected and logged', () => {
  const {B, gas} = fresh();
  gas.as(EST);
  assert.equal(B.api({op: 'dropAllTables'}).error.code, 'BAD_REQUEST');
  assert.equal(B.api(null).error.code, 'BAD_REQUEST');
  for (const op of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(B.api({op}).error.code, 'BAD_REQUEST', op);
});
