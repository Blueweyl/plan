// Phase 2: Smart Estimate Auditor. Rules run in Node against the same engine
// and auditor code that ships in estimator.html; UI flows run in Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAuditor, readJSON, plain} from './lib/engine.mjs';
import {launch, openApp} from './lib/browser.mjs';

const A = loadAuditor(), TODAY = '2026-10-23';
const fixture = readJSON('tests/fixtures/sample-18.estimate.json');
const BASE = readJSON('BASELINE_RESULTS.json');
const clone = x => JSON.parse(JSON.stringify(x));
let browser, V2;   // V2 = the fixture after the app's own v1 -> v2 migration
test.before(async () => {
  browser = await launch();
  const app = await openApp(browser);
  V2 = await app.page.evaluate(raw => migrate(raw).state, fixture);
  await app.close();
});
test.after(async () => { await browser.close(); });

const audit = (st, opt = {today: TODAY}) => plain(A.runAudit(st, opt));
const rules = au => au.findings.map(f => f.ruleId);
const has = (st, rule) => rules(audit(st)).includes(rule);
const el = (type, inp = {}, extra = {}) => ({id: 'e-' + type, type, mark: 'X1', level: V2.levels[0].id, qty: 1, inp: A.normInputs(type, inp), ...extra});
const checks = (type, inp, extra) => plain(A.elementChecks(el(type, inp, extra), A.defaultFactors())).map(c => c.rule);
const resolveCriticals = st => {   // what an estimator does before approval: own prices, verified coefficients
  for (const p of Object.values(st.prices)) { p.source = 'user'; p.updatedAt = TODAY; }
  for (const l of Object.values(st.labor)) { l.source = 'user'; l.updatedAt = TODAY; }
  for (const m of Object.values(st.factorMeta)) { m.verified = true; m.ref = 'checked'; }
  return st;
};

// ---------- Baseline project
test('P2-01 sample project: exact findings and approval blocked by 2 critical findings', () => {
  const au = audit(V2);
  assert.deepEqual(au.findings.map(f => `${f.ruleId}:${f.severity}`).sort(), [
    'R-COEF-001:critical', 'R-OVL-001:minor', 'R-OVL-002:minor', 'R-OVL-002:minor', 'R-PRICE-002:critical', 'R-PRICE-005:major', 'R-TO-002:major', 'R-TO-002:major'].sort());
  assert.equal(au.blocking.length, 2);
  assert.equal(au.totals.grand, BASE.boq.totals.grand, 'auditing never changes the numbers');
});

test('P2-02 every finding carries id, severity, rule, references, evidence, action, status and history', () => {
  const st = clone(V2); st.elements[2].inp.cover = 300; st.settings.vat = 10; st.elements[3].mark = st.elements[2].mark;
  for (const f of audit(st).findings) {
    assert.match(f.id, /^F-[0-9a-f]{16}$/);
    assert.ok(A.RULES[f.ruleId], f.ruleId);
    assert.ok(['critical', 'major', 'minor', 'info'].includes(f.severity));
    assert.equal(f.refs.projectId, V2.meta.projectId); assert.equal(f.refs.revision, 0);
    assert.ok(Array.isArray(f.refs.elementIds) && Array.isArray(f.refs.paths) && Array.isArray(f.refs.marks));
    assert.ok(f.title && f.description && f.suggestion, f.ruleId);
    assert.equal(typeof f.evidence, 'object');
    assert.ok(['open', 'acknowledged', 'reopened'].includes(f.status));
    assert.ok(Array.isArray(f.history));
  }
});

test('P2-03 finding IDs are unique and stable (rerun, reordered elements, unrelated edits)', () => {
  const a = audit(V2), ids = a.findings.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(audit(V2).findings.map(f => f.id), ids);
  const r = clone(V2); r.elements.reverse();
  assert.deepEqual(audit(r).findings.map(f => f.id).sort(), [...ids].sort());
  const u = clone(V2); u.elements[0].inp.L = 1.6;
  const kept = audit(u).findings.map(f => f.id);
  for (const f of a.findings.filter(f => f.ruleId !== 'R-OVL-001' && f.ruleId !== 'R-OVL-002')) assert.ok(kept.includes(f.id), f.ruleId);
});

test('P2-04 the audit is deterministic and pure (no clock, no mutation of the project)', () => {
  const st = clone(V2), before = JSON.stringify(st);
  assert.equal(JSON.stringify(audit(st)), JSON.stringify(audit(st)));
  assert.equal(JSON.stringify(st), before);
});

// ---------- Element rules (positive and negative)
test('R-DIM-001 non-numeric input', () => {
  assert.ok(checks('column', {}, {inp: {H: 'abc'}}).includes('R-DIM-001'));
  assert.ok(!checks('column', {H: 3}).includes('R-DIM-001'));
});
test('R-DIM-002 / R-DIM-003 negative and zero dimensions (fixes A-H04)', () => {
  assert.ok(checks('column', {H: -3}).includes('R-DIM-002'));
  assert.ok(checks('footing', {L: 0}).includes('R-DIM-003'));
  assert.ok(checks('slab', {sBx: 0}).includes('R-DIM-003'), 'zero spacing (fixes A-H05)');
  assert.ok(!checks('column', {Lo: 0}).includes('R-DIM-003'), 'optional zero is allowed');
  assert.ok(!checks('beam', {nXT: 0, lXT: 0}).includes('R-DIM-003'), 'length of absent extra bars is not checked');
});
test('R-DIM-004 zero or fractional element quantity (fixes A-M04)', () => {
  assert.ok(checks('column', {}, {qty: 0}).includes('R-DIM-004'));
  assert.ok(checks('column', {}, {qty: 2.5}).includes('R-DIM-004'));
  assert.ok(!checks('column', {}, {qty: 3}).includes('R-DIM-004'));
});
test('R-DIM-005 / R-DIM-006 openings larger than the wall, unreadable openings (fixes A-M05)', () => {
  assert.ok(checks('chbwall', {L: 2, H: 2, open: '3x3'}).includes('R-DIM-005'));
  assert.ok(checks('drywall', {open: '0.9 by 2.1'}).includes('R-DIM-006'));
  assert.deepEqual(checks('chbwall', {open: '0.9x2.1x2'}), []);
});
test('R-UNIT-001 values that look like a unit slip', () => {
  assert.ok(checks('column', {H: 3000}).includes('R-UNIT-001'), 'mm typed into metres');
  assert.ok(checks('column', {b: 400}).includes('R-UNIT-001'), 'section in mm');
  assert.ok(checks('column', {cover: 0.04}).includes('R-UNIT-001'), 'cover in metres');
  assert.ok(checks('slab', {sBx: 0.2}).includes('R-UNIT-001'), 'spacing in metres');
  assert.ok(checks('chbwall', {plt: 1.6}).includes('R-UNIT-001'), 'plaster in cm');
  assert.ok(!checks('chbwall', {plt: 16}).includes('R-UNIT-001'));
  for (const e of V2.elements) assert.deepEqual(plain(A.elementChecks(e, V2.factors)), [], e.mark + ' (sample inputs are clean)');
});
test('R-RB-001 cover leaves no room for bars (fixes A-H05: no more 30 mm ties)', () => {
  assert.ok(checks('column', {b: 0.05, h: 0.05, cover: 40}).includes('R-RB-001'));
  assert.ok(checks('footing', {L: 0.1, W: 0.1, cover: 75}).includes('R-RB-001'));
  assert.ok(!checks('column', {}).includes('R-RB-001'));
});
test('R-RB-002 spacing larger than the member', () => {
  assert.ok(checks('footing', {W: 0.6, L: 0.6, sL: 600}).includes('R-RB-002'));
  assert.ok(!checks('footing', {}).includes('R-RB-002'));
});
test('R-RB-003 rebar that cannot be bought is reported, with the elements (fixes A-C02)', () => {
  const st = clone(V2); st.settings.stock = '6'; st.factors.rebar.lapFactor = 400;
  const f = audit(st).findings.filter(f => f.ruleId === 'R-RB-003');
  assert.ok(f.length >= 1);
  assert.equal(f[0].severity, 'critical');
  assert.ok(f[0].refs.elementIds.length > 0);
  assert.ok(!has(V2, 'R-RB-003'));
});
test('R-RB-004 confined zone longer than the member', () => {
  assert.ok(checks('column', {H: 3, Lo: 2, sLo: 100}).includes('R-RB-004'));
  assert.ok(!checks('column', {H: 3, Lo: 0.5, sLo: 100}).includes('R-RB-004'));
});
test('R-QTY-001 inputs that produce nothing are never silent', () => {
  assert.ok(checks('ceiling', {}, {inp: {sys: 'unknown-system'}}).includes('R-QTY-001'));
  assert.ok(!checks('ceiling', {}).includes('R-QTY-001'));
});

// ---------- Price rules
test('R-PRICE-001 unpriced BOQ material', () => {
  const st = clone(V2); st.prices.CEM.price = 0;
  assert.ok(has(st, 'R-PRICE-001')); assert.ok(!has(V2, 'R-PRICE-001'));
});
test('R-PRICE-002 / R-PRICE-005 sample prices and labor rates', () => {
  const au = audit(V2), f = au.findings.find(f => f.ruleId === 'R-PRICE-002');
  assert.equal(f.evidence.codes.length, 36);
  assert.ok(!has(resolveCriticals(clone(V2)), 'R-PRICE-002'));
  assert.ok(!has(resolveCriticals(clone(V2)), 'R-PRICE-005'));
});
test('R-PRICE-003 / R-PRICE-006 expired and undated prices', () => {
  const st = resolveCriticals(clone(V2)); st.prices.CEM.updatedAt = '2026-05-01'; st.prices.SAND.updatedAt = null;
  const au = audit(st);
  assert.deepEqual(au.findings.find(f => f.ruleId === 'R-PRICE-003').evidence.prices.map(p => p.path), ['prices.CEM']);
  assert.ok(rules(au).includes('R-PRICE-006'));
  st.audit.policy.priceValidityDays = 365;
  assert.ok(!has(st, 'R-PRICE-003'));
});
test('R-PRICE-004 zero labor rate', () => {
  const st = clone(V2); st.labor.L_CONC.rate = 0;
  assert.ok(has(st, 'R-PRICE-004'));
});

// ---------- Coefficients
test('R-COEF-001 unverified coefficients: critical by default, major by policy, gone when verified', () => {
  const f = audit(V2).findings.find(f => f.ruleId === 'R-COEF-001');
  assert.equal(f.severity, 'critical');
  assert.ok(f.evidence.coefficients.some(c => c.path === 'concrete.A.cement' && /Fajardo/.test(c.source)));
  const st = clone(V2); st.audit.policy.unverifiedCoefficients = 'major';
  assert.equal(audit(st).findings.find(f => f.ruleId === 'R-COEF-001').severity, 'major');
  const v = clone(V2); for (const m of Object.values(v.factorMeta)) m.verified = true;
  assert.ok(!has(v, 'R-COEF-001'));
});
test('R-COEF-002 the interpolated 5" CHB mortar row blocks approval when used', () => {
  const st = clone(V2); st.elements[5].inp.size = '5';
  const f = audit(st).findings.find(f => f.ruleId === 'R-COEF-002');
  assert.equal(f.severity, 'critical');
  assert.deepEqual(f.refs.marks, ['CHB1']);
});
test('factorsUsed is complete: every coefficient that changes an element\'s result is listed', () => {
  const F0 = A.defaultFactors(), paths = [];
  (function walk(o, p) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + k + '.'); else paths.push(p + k); } })(F0, '');
  const els = [...V2.elements, el('chbwall', {size: '5', faces: 0}), el('ceiling', {sys: 'fc', board: 'GYP9'}), el('footing', {hook: false})];
  const get = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  for (const e of els) {
    const used = A.factorsUsed(e, F0), base = JSON.stringify(plain(A.computeElement(e, F0)));
    for (const p of paths) {
      const F = clone(F0), ks = p.split('.'), last = ks.pop(), o = ks.reduce((a, k) => a[k], F);
      o[last] = Array.isArray(o[last]) ? [5.5, 13] : get(F0, p) * 1.37 + 0.11;
      const changed = JSON.stringify(plain(A.computeElement(e, F))) !== base;
      if (changed) assert.ok(used.has(p), `${e.mark} (${e.type}) reads ${p} but factorsUsed misses it`);
    }
  }
});

// ---------- Duplicates and overlaps
test('R-DUP-001 / R-DUP-002 duplicate elements and marks (fixes A-M10)', () => {
  const st = clone(V2); st.elements.push({...clone(st.elements[2]), id: 'dup1', mark: 'C1b'});
  assert.ok(has(st, 'R-DUP-001'));
  const m = clone(V2); m.elements[1].mark = m.elements[0].mark;
  assert.ok(has(m, 'R-DUP-002'));
  assert.ok(!has(V2, 'R-DUP-001') && !has(V2, 'R-DUP-002'));
});
test('R-OVL-001 / R-OVL-002 overlap upper bounds are exact arithmetic', () => {
  const au = audit(V2), lv2 = V2.levels[1].id;
  const o1 = au.findings.find(f => f.ruleId === 'R-OVL-001');
  assert.ok(Math.abs(o1.evidence.overlapUpperBound_m3 - 0.3 * 5 * 0.125 * 10) < 1e-12, 'B2: b × L × slab t × qty');
  const o2 = au.findings.filter(f => f.ruleId === 'R-OVL-002').find(f => f.evidence.level === 'Second floor');
  assert.ok(Math.abs(o2.evidence.overlapUpperBound_m3 - 0.3 * 0.3 * 0.5 * 9) < 1e-12, 'C2: b × h × beam depth × qty');
  const st = clone(V2); st.elements = st.elements.filter(e => e.type !== 'slab');
  assert.ok(!has(st, 'R-OVL-001'));
  assert.ok(lv2);
});

// ---------- Reconciliation, markups
test('R-REC-001 reconciliation detects a tampered BOQ; the real BOQ reconciles', () => {
  const b = plain(A.buildBOQ(V2));
  assert.deepEqual(plain(A.reconcileChecks(b, V2.settings)).failures, []);
  const t = clone(b); t.rows.find(r => r.kind === 'mat').amt += 1;
  assert.ok(plain(A.reconcileChecks(t, V2.settings)).failures.length >= 2);
  const g = clone(b); g.totals.grand += 0.01;
  assert.ok(plain(A.reconcileChecks(g, V2.settings)).failures.some(x => /grand/.test(x)), 'one centavo on a ₱1.5M total is detected');
  const d = clone(b); d.divTotals[0].amt += 0.01;
  assert.ok(plain(A.reconcileChecks(d, V2.settings)).failures.some(x => /division/.test(x)));
});
test('R-REC-002 printed rounding differences are reported (mitigates A-M01)', () => {
  // three lines of ₱0.004 print as 0.00 each but their subtotal prints as 0.01
  const syn = {rows: [{kind: 'mat', qty: 1, rate: 0.004, amt: 0.004}, {kind: 'mat', qty: 1, rate: 0.004, amt: 0.004}, {kind: 'mat', qty: 1, rate: 0.004, amt: 0.004}, {kind: 'sub', amt: 0.012, text: 'x'}],
    divTotals: [{amt: 0.012}], totals: {direct: 0.012, ocm: 0, profit: 0, cont: 0, sub: 0.012, vat: 0, grand: 0.012}};
  assert.equal(plain(A.reconcileChecks(syn, {ocm: 0, profit: 0, contingency: 0, vat: 0})).printedSubs, 1);
  const st = clone(V2); st.prices.CUB.price = 0.0026; st.labor.L_CUB.rate = 0.0026;   // 2 sets → ₱0.0052 per line
  assert.ok(has(st, 'R-REC-002')); assert.ok(!has(V2, 'R-REC-002'));
});
test('R-REC-003 non-finite totals (a NaN price is read as 0 by the engine and caught by R-PRICE-001)', () => {
  const st = clone(V2); st.settings.ocm = NaN;
  const r = rules(audit(st));
  assert.ok(r.includes('R-REC-003') && r.includes('R-MKP-001'));
  const p = clone(V2); p.prices.CEM.price = NaN;
  assert.ok(rules(audit(p)).includes('R-PRICE-001'));
});
test('R-MKP-001 / R-MKP-002 invalid and unusual markups and VAT', () => {
  const a = clone(V2); a.settings.vat = -1; assert.ok(has(a, 'R-MKP-001'));
  const b = clone(V2); b.settings.vat = 10; assert.ok(has(b, 'R-MKP-002'));
  const c = clone(V2); c.settings.vat = 0; assert.ok(!has(c, 'R-MKP-002'), 'VAT-exempt work is allowed');
  const d = clone(V2); d.settings.ocm = 60; assert.ok(has(d, 'R-MKP-002'));
});

// ---------- Takeoff completeness, quarantine
test('R-TO-001…004 takeoff register', () => {
  const st = clone(V2), [g, s2] = st.levels.map(l => l.id);
  st.levels.push({id: 'empty', name: 'Roof deck', h: 3});
  assert.ok(audit(st).findings.some(f => f.ruleId === 'R-TO-001' && /Roof deck/.test(f.description)));
  st.takeoff[g] = Object.fromEntries(A.TAKEOFF_SCOPES.map(([k, , types]) => [k, st.elements.some(e => e.level === g && types.includes(e.type)) ? 'complete' : 'na']));
  assert.ok(!audit(st).findings.some(f => f.ruleId === 'R-TO-002' && f.description.startsWith('Ground floor')));
  st.takeoff[s2] = {SLAB: 'na', STR: 'complete'};
  const r = rules(audit(st));
  assert.ok(r.includes('R-TO-003'), 'stairs complete but none on 2nd floor');
  assert.ok(r.includes('R-TO-004'), 'slabs N/A but present');
});
test('R-QUA-001 quarantined elements are reported', () => {
  const st = clone(V2); st.quarantine.elements.push({type: 'helipad', mark: 'H1'});
  assert.ok(has(st, 'R-QUA-001'));
});

// ---------- Acknowledgement, approval, staleness, exports
test('acknowledgement: major can be acknowledged; critical cannot; changed evidence reopens it', () => {
  const st = clone(V2), au = audit(st);
  const maj = au.findings.find(f => f.ruleId === 'R-PRICE-005'), crit = au.findings.find(f => f.ruleId === 'R-PRICE-002');
  for (const f of [maj, crit]) st.audit.acks[f.id] = {status: 'acknowledged', evidenceHash: f.evidenceHash, history: [{at: TODAY, by: 'QA', action: 'acknowledged', note: 'test'}]};
  const a2 = audit(st);
  assert.equal(a2.findings.find(f => f.id === maj.id).status, 'acknowledged');
  assert.equal(a2.findings.find(f => f.id === crit.id).status, 'open', 'critical stays open');
  assert.equal(a2.findings.find(f => f.id === maj.id).history[0].by, 'QA');
  st.labor.L_RB.source = 'user';
  assert.equal(audit(st).findings.find(f => f.id === maj.id).status, 'reopened');
});
test('R-STALE-001 / R-STALE-002 changes after approval or export; metadata changes do not count', () => {
  const st = resolveCriticals(clone(V2)), au = audit(st);
  st.audit.approval = {at: TODAY, by: 'QA', hashes: au.hashes, totals: au.totals};
  st.audit.lastExport = {at: TODAY, kind: 'CSV', hashes: au.hashes};
  assert.ok(!has(st, 'R-STALE-001') && !has(st, 'R-STALE-002'));
  st.factorMeta['concrete.A.cement'].ref = 'p. 99';
  assert.ok(!has(st, 'R-STALE-001'), 'provenance notes do not change numbers');
  st.prices.CEM.price = 300;
  const f = audit(st).findings.find(f => f.ruleId === 'R-STALE-001');
  assert.deepEqual(f.evidence.changedParts, ['prices']);
  assert.ok(has(st, 'R-STALE-002'));
});
test('export policy: draft watermark, issues-only, block-critical, approved header', () => {
  const st = clone(V2), au = audit(st);
  assert.match(A.exportBanner(st, au).watermark, /^DRAFT – NOT APPROVED – 2 critical/);
  st.audit.policy.exportPolicy = 'block-critical';
  assert.match(A.exportBanner(st, au).block, /Export refused/);
  const ok = resolveCriticals(clone(V2));
  for (const sc of ['FTG', 'COL', 'BEAM', 'SLAB', 'RCW', 'STR', 'CHB', 'PART', 'CEIL']) for (const l of ok.levels) (ok.takeoff[l.id] = ok.takeoff[l.id] || {})[sc] = 'na';
  ok.takeoff = Object.fromEntries(ok.levels.map(l => [l.id, Object.fromEntries(A.TAKEOFF_SCOPES.map(([k, , types]) => [k, ok.elements.some(e => e.level === l.id && types.includes(e.type)) ? 'complete' : 'na']))]));
  const a2 = audit(ok);
  assert.equal(a2.openCounts.critical + a2.openCounts.major, 0);
  ok.audit.policy.exportPolicy = 'watermark-issues-only';
  assert.equal(A.exportBanner(ok, a2).watermark, null);
  ok.audit.policy.exportPolicy = 'draft-watermark';
  assert.match(A.exportBanner(ok, a2).watermark, /NOT APPROVED/);
  ok.audit.approval = {at: TODAY, by: 'QA', hashes: a2.hashes, auditVersion: '1.0.0', engineVersion: '1.0.0'};
  const b = A.exportBanner(ok, a2);
  assert.equal(b.watermark, null); assert.match(b.header, /^APPROVED 2026-10-23 by QA/);
});

// ---------- Browser flows
test('UI: approval is blocked by critical findings, then works, then goes stale on a price change', async () => {
  const st = clone(V2);
  const app = await openApp(browser, {state: st});
  await app.page.evaluate(() => { localStorage.setItem('estimator.user', 'QA Tester'); App.tab('audit'); });
  assert.equal(await app.page.locator('button[data-act="approve"]').isDisabled(), true);
  await app.page.evaluate(() => { for (const p of Object.values(S.prices)) { p.source = 'user'; p.updatedAt = localDate(); } for (const l of Object.values(S.labor)) { l.source = 'user'; l.updatedAt = localDate(); } for (const m of Object.values(S.factorMeta)) m.verified = true; persist(); render(); });
  assert.equal(await app.page.locator('button[data-act="approve"]').isDisabled(), false);
  await app.page.click('button[data-act="approve"]');
  assert.match(await app.page.textContent('#revChip'), /Approved/);
  const appr = await app.page.evaluate(() => S.audit.approval);
  assert.equal(appr.by, 'QA Tester'); assert.equal(appr.totals.grand, BASE.boq.totals.grand);
  assert.ok(appr.openFindings.some(f => f.ruleId === 'R-TO-002'), 'open majors are recorded with the approval');
  await app.page.evaluate(() => { S.prices.CEM.price = 999; persist(); render(); });
  assert.match(await app.page.textContent('#revChip'), /Approved – changed since/);
  const csv = await app.page.evaluate(() => csvExportText(exportBanner(S, runAudit(S, {today: localDate()}))));
  assert.match(csv.split('\r\n')[0], /DRAFT – CHANGED SINCE APPROVAL/);
  await app.close();
});

test('UI: draft CSV/XLS exports are watermarked; frozen BOQ body is unchanged', async () => {
  const app = await openApp(browser, {state: V2});
  const r = await app.page.evaluate(() => { const b = exportBanner(S, runAudit(S, {today: localDate()})); return {csv: csvExportText(b), xls: xlsExportText(b), body: boqCsv()}; });
  assert.match(r.csv, /^"DRAFT – NOT APPROVED – 2 critical, 3 major open finding\(s\)"\r\n/);
  assert.ok(r.csv.endsWith(BASE.exports.csv));
  assert.equal(r.body, BASE.exports.csv);
  assert.match(r.xls, /<table><tr><td colspan="6" style="color:#c62828[^>]*>DRAFT – NOT APPROVED/);
  await app.close();
});

test('UI: block-critical policy refuses the export and records nothing', async () => {
  const st = clone(V2); st.audit.policy.exportPolicy = 'block-critical';
  const app = await openApp(browser, {state: st});
  await app.page.evaluate(() => App.exportCsv());
  assert.match(app.dialogs.at(-1).message, /Export refused by policy/);
  assert.equal(await app.page.evaluate(() => S.audit.lastExport), null);
  await app.close();
});

test('UI: print applies the watermark to every page', async () => {
  const app = await openApp(browser, {state: V2});
  await app.page.evaluate(() => { window.print = () => { window.__printed = true; }; App.print(); });
  await app.page.waitForFunction(() => window.__printed === true);
  assert.match(await app.page.getAttribute('body', 'data-watermark'), /^DRAFT – NOT APPROVED/);
  assert.match(await app.page.textContent('#wmBanner'), /DRAFT/);
  assert.equal(await app.page.evaluate(() => S.audit.lastExport.kind), 'print');
  await app.close();
});

test('UI: acknowledging a finding records name and reason and survives reload', async () => {
  const app = await openApp(browser, {state: V2, answer: d => d.type() === 'prompt' ? 'Takeoff of 2nd floor scheduled for Monday' : undefined});
  await app.page.evaluate(() => { localStorage.setItem('estimator.user', 'QA Tester'); App.tab('audit'); });
  const id = await app.page.evaluate(() => getAud().findings.find(f => f.ruleId === 'R-TO-002').id);
  await app.page.click(`[data-finding="${id}"] button[data-act="ack"]`);
  await app.page.reload();
  const f = await app.page.evaluate(id => getAud().findings.find(f => f.id === id), id);
  assert.equal(f.status, 'acknowledged');
  assert.deepEqual([f.history[0].by, f.history[0].note], ['QA Tester', 'Takeoff of 2nd floor scheduled for Monday']);
  assert.equal(await app.page.locator(`[data-finding] button[data-act="ack"]`).count() < await app.page.locator('[data-finding]').count(), true);
  await app.close();
});

test('UI: critical findings show no Acknowledge button', async () => {
  const app = await openApp(browser, {state: V2});
  await app.page.evaluate(() => App.tab('audit'));
  const ids = await app.page.evaluate(() => getAud().findings.filter(f => f.severity === 'critical').map(f => f.id));
  for (const id of ids) assert.equal(await app.page.locator(`[data-finding="${id}"] button[data-act="ack"]`).count(), 0);
  assert.equal(await app.page.locator('[data-finding]').count(), await app.page.evaluate(() => getAud().findings.length));
  await app.close();
});

test('UI: the element editor validates as you type', async () => {
  const app = await openApp(browser, {state: V2});
  await app.page.evaluate(() => App.addEl('column'));
  assert.match(await app.page.textContent('#pvChecks'), /No input problems/);
  await app.page.fill('#f_cover', '300');
  await app.page.dispatchEvent('#f_cover', 'input');
  assert.match(await app.page.textContent('#pvChecks'), /Critical.*Cover 300 mm/s);
  await app.close();
});

test('UI: takeoff register updates findings', async () => {
  const app = await openApp(browser, {state: V2});
  await app.page.evaluate(() => App.tab('audit'));
  const lv = V2.levels[0].id;
  const before = await app.page.evaluate(() => getAud().findings.find(f => f.ruleId === 'R-TO-002').evidence.scopes.length);
  await app.page.selectOption(`select[data-bind="takeoff:${lv}:COL"]`, 'complete');
  const after = await app.page.evaluate(lv => getAud().findings.find(f => f.ruleId === 'R-TO-002' && f.refs.elementIds.length === 0 && f.evidence.level === 'Ground floor').evidence.scopes.length, lv);
  assert.equal(after, before - 1);
  assert.equal(await app.page.evaluate(lv => S.takeoff[lv].COL, lv), 'complete');
  await app.close();
});

test('UI: CSV and Excel exports neutralise formula injection (fixes A-M02)', async () => {
  const st = clone(V2); st.prices.CEM.name = '=HYPERLINK("http://example.invalid","x")'; st.levels[0].name = '+cmd';
  const app = await openApp(browser, {state: st});
  const r = await app.page.evaluate(() => ({csv: boqCsv(), xls: boqHtmlTable(true)}));
  assert.ok(r.csv.includes(`"'=HYPERLINK(`) && !r.csv.includes('"=HYPERLINK('));
  assert.ok(r.xls.includes('&#39;=HYPERLINK(') && r.xls.includes('&#39;+cmd'), 'apostrophe prefix (HTML-escaped)');
  await app.close();
});

test('UI: the audit survives a v2 save/reload and an old project gets an audit state', async () => {
  const app = await openApp(browser, {state: fixture});
  const r = await app.page.evaluate(() => ({pol: S.audit.policy, id: S.meta.projectId, crit: getAud().counts.critical}));
  assert.deepEqual(r.pol, {priceValidityDays: 90, unverifiedCoefficients: 'critical', exportPolicy: 'draft-watermark'});
  assert.match(r.id, /^[A-Za-z0-9_-]+$/); assert.equal(r.crit, 2);
  await app.close();
});
