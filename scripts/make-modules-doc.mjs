// Writes MODULES.md from the calculator definitions in estimator.html
// (fields, rules, coefficients), so the documentation cannot drift from the code.
// Usage: node scripts/make-modules-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, loadAuditor} from '../tests/lib/engine.mjs';

const A = loadAuditor();
const F = A.defaultFactors();
const types = Object.entries(A.TYPES).filter(([, t]) => t.module);
const lines = [`# Calculators added in Phase 3 (modules ${A.MODULES_VERSION})`, '',
  'Generated from `estimator.html` by `node scripts/make-modules-doc.mjs`. Do not edit by hand.', '',
  '**Rules that apply to every calculator:**',
  '- **Legacy formulas are unchanged.** The 12 original element types, their catalog entries and factors are untouched, and the golden-master tests prove the legacy BOQ is byte-identical.',
  '- **Coefficients are never guessed.** A coefficient that has to come from Fajardo or a product data sheet starts **not set** (null). Any quantity that needs it is left out of the BOQ, and auditor rule R-COEF-003 reports it as critical until a value is entered on the Factors tab.',
  '- **Specified products are priced inside the element** (tiles, roofing sheets, doors, fixtures, pipes, wires…), from your quotation. There are no sample prices. A missing unit cost is reported by R-PRICE-001.',
  '- **New labor and equipment rates start at 0** (source "not set") and are reported by R-PRICE-004.',
  '- **Every calculation records a formula trace**, shown in the element editor.', ''];
for (const [k, t] of types) {
  lines.push(`## ${t.name} (\`${k}\`, division: ${A.DIV_NAME[t.div]})`, '');
  lines.push('| Input | Unit | Default | Rule |', '|---|---|---|---|');
  for (const f of t.fields.filter(f => f.k)) {
    const zero = t.allowZero && t.allowZero.has(f.k), rel = t.relevant && t.relevant[f.k] ? 'only when relevant' : '';
    const rule = f.t === 'num' ? [zero ? 'may be 0' : 'must be > 0', rel].filter(Boolean).join(', ') : f.t === 'sel' ? 'one of: ' + f.opts.map(o => o[1]).join(' / ') : f.t === 'chk' ? 'yes / no' : 'text';
    lines.push(`| ${f.label} | ${f.unit || ''} | ${f.def === '' ? '' : String(f.def)} | ${rule} |`);
  }
  const d = t.doc;
  lines.push('', `- **Measurement:** ${d.measure}`, `- **Unit conversions:** ${d.conversions}`, `- **Net quantity:** ${d.net}`, `- **Deductions:** ${d.deductions}`,
    `- **Waste:** ${d.waste}`, `- **Purchase quantity:** ${d.purchase}`, `- **Materials:** ${d.materials}`, `- **Labor:** ${d.labor}`, `- **Equipment:** ${d.equipment}`,
    `- **Coefficient sources:** ${d.sources}`);
  const used = new Set();
  for (const [g, o] of Object.entries(A.MODULE_FACTORS())) for (const kk of Object.keys(o)) used.add(g + '.' + kk);
  lines.push('');
}
lines.push('## Coefficients introduced by the calculators', '', '| Path | Default | Source | Starts verified |', '|---|---|---|---|');
for (const [p, [src, note, ver, label]] of Object.entries(A.MODULE_FACTOR_META)) {
  const v = p.split('.').reduce((a, k) => a[k], F);
  lines.push(`| \`${p}\` (${label}) | ${v === null ? '**not set**' : v} | ${src}${note ? ' – ' + note : ''} | ${ver ? 'yes' : 'no'} |`);
}
lines.push('', '## Hand-calculated examples (in-app Self-test and `tests/phase3.test.mjs`)', '');
for (const r of A.runModuleSelfTests()) lines.push(`- ${r.ok ? 'PASS' : 'FAIL'} – ${r.name}`);
lines.push('', 'The coefficient values used in these examples are test inputs, not defaults.', '');
fs.writeFileSync(path.join(ROOT, 'MODULES.md'), lines.join('\n'));
console.log('Wrote MODULES.md:', types.length, 'calculators');
