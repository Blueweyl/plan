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

export function engineSource(file = APP_HTML) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script id="engine"> block in ' + file);
  return m[1];
}

export function loadEngine(file = APP_HTML) {
  const src = engineSource(file);
  const ctx = vm.createContext({});
  return vm.runInContext(src + `\n;({${EXPORTS.join(',')}})`, ctx, {filename: path.basename(file) + '#engine'});
}

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const readJSON = p => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));
// VM objects come from another realm; round-trip through JSON to get plain data.
export const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v instanceof Map ? Object.fromEntries(v) : v));
