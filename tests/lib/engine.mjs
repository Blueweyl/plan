// Loads the <script id="engine"> block of an estimator HTML file into an
// isolated Node VM context, so calculations can be tested without a browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APP_HTML = path.join(ROOT, 'estimator.html');

const EXPORTS = ['DIAS', 'DIVS', 'DIV_NAME', 'MATERIALS', 'LABOR', 'CEIL_UNITS', 'TYPES', 'defaultFactors', 'kgpm', 'round',
  'ceilE', 'floorE', 'splitPiece', 'ffdBars', 'optimizeDia', 'parseOpenings', 'normInputs', 'computeElement',
  'buildEstimate', 'buildBOQ', 'qtyRound', 'runSelfTests'];

const AUDITOR_EXPORTS = ['AUDIT_VERSION', 'RULES', 'SEV_ORDER', 'TAKEOFF_SCOPES', 'TAKEOFF_STATUS', 'EXPORT_POLICIES', 'AUDIT_LIMITS',
  'defaultAuditState', 'hash64', 'canon', 'inputHashes', 'factorsUsed', 'elementChecks', 'reconcileChecks', 'runAudit', 'exportBanner'];

const MODULE_EXPORTS = ['MODULES_VERSION', 'MOD_DIVS', 'MODULE_FACTORS', 'MODULE_FACTOR_META', 'EQUIPMENT_CODES', 'collectPriced', 'runModuleSelfTests'];

export function engineSource(file = APP_HTML, block = 'engine') {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(new RegExp(`<script id="${block}">([\\s\\S]*?)<\\/script>`));
  if (!m) throw new Error(`No <script id="${block}"> block in ` + file);
  return m[1];
}

// Engine only (also works on original/estimator.v1.html, which has no auditor).
// Pass {auditor: true} to also load the modules and auditor blocks (the full app logic).
export function loadEngine(file = APP_HTML, {auditor = false} = {}) {
  let src = engineSource(file), names = EXPORTS;
  if (auditor) {
    let mods = '';
    try { mods = engineSource(file, 'modules'); } catch (e) { /* files before Phase 3 have no modules block */ }
    src += '\n' + mods + '\n' + engineSource(file, 'auditor');
    names = EXPORTS.concat(AUDITOR_EXPORTS, mods ? MODULE_EXPORTS : []);
  }
  const ctx = vm.createContext({});
  return vm.runInContext(src + `\n;({${names.join(',')}})`, ctx, {filename: path.basename(file) + '#engine'});
}
export const loadAuditor = (file = APP_HTML) => loadEngine(file, {auditor: true});

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const readJSON = p => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));
// VM objects come from another realm, so `instanceof Map` is false for them;
// detect Maps by tag, then round-trip through JSON to get plain data.
const isMap = v => Object.prototype.toString.call(v) === '[object Map]';
export const plain = x => JSON.parse(JSON.stringify(x, (k, v) => isMap(v) ? Object.fromEntries(v) : v));
export const ORIGINAL_HTML = path.join(ROOT, 'original', 'estimator.v1.html');
