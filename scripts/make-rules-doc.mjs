// Writes AUDIT_RULES.md from the auditor's own RULES table and limits, so the
// rule documentation cannot drift from the code. Usage: node scripts/make-rules-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, loadAuditor} from '../tests/lib/engine.mjs';

const A = loadAuditor();
const DETAIL = {
  'R-DIM-001': 'Each numeric input of the element form must be a finite number.',
  'R-DIM-002': 'Numeric inputs must not be negative.',
  'R-DIM-003': 'Dimensions, spacings and counts must be > 0. Allowed zeros: optional extras (bottom extension, confined zone, cross-ties, anchorage, extra bars, dowel length, waste, longitudinal bars). Fields that do not apply are skipped (e.g. confined-zone spacing when the zone length is 0).',
  'R-DIM-004': 'Element quantity must be a whole number > 0 (the engine rounds it).',
  'R-DIM-005': 'Wall/partition openings area ≥ L × H makes the net area 0.',
  'R-DIM-006': 'Openings must be written as W x H x count; unreadable parts are not deducted.',
  'R-UNIT-001': 'Data-entry plausibility, not a design limit: metres ${mMin}–${mMax} (section sizes b, h, t, T, B ≤ ${sectionMax} m); cover ${coverMin}–${coverMax} mm; spacings ${spacingMin}–${spacingMax} mm; plaster ${plasterMin}–${plasterMax} mm.',
  'R-QTY-001': 'Raised only when no critical input finding already explains it.',
  'R-RB-001': 'Member dimension − 2 × cover ≤ 0 for the bar directions of the element type.',
  'R-RB-002': 'Spacing ≥ available width (dimension − 2 × cover), so the count formula gives a single bar.',
  'R-RB-003': 'A scheduled diameter has no candidate commercial length longer than its lap (lap factor × d); the engine omits it from the BOQ.',
  'R-RB-004': 'Columns/beams: 2 × confined zone ≥ length, so the engine uses uniform spacing.',
  'R-PRICE-001': 'A material that appears in the BOQ has price ≤ 0 or not a number (the engine costs it at 0).',
  'R-PRICE-002': 'A material in the BOQ still carries the built-in sample price (source "sample").',
  'R-PRICE-003': 'A user price/rate in the BOQ is older than the price-validity policy (days).',
  'R-PRICE-004': 'A per-unit labor rate in the BOQ is ≤ 0.',
  'R-PRICE-005': 'A labor rate in the BOQ is still the sample value.',
  'R-PRICE-006': 'A user price/rate has no recorded date.',
  'R-COEF-001': 'A coefficient read by at least one costed element (see factorsUsed) is not ticked Verified. Severity follows the policy (critical by default).',
  'R-COEF-002': 'A coefficient whose source is "interpolated" is used (currently the 5" CHB mortar row).',
  'R-DUP-001': 'Two or more elements with the same type, level and normalised inputs.',
  'R-DUP-002': 'The same mark (case-insensitive) on more than one element.',
  'R-OVL-001': 'Beams and slabs on one level. Upper bound = Σ beam b × L × min(max slab t, beam h) × qty.',
  'R-OVL-002': 'Columns and beams on one level. Upper bound = Σ column b × h × max beam h × qty.',
  'R-REC-001': 'Every BOQ line amount = qty × rate (or % × materials); each subtotal = sum of its lines; division totals and line totals = direct cost; markups = direct × rate; subtotal and VAT and grand total consistent. Tolerance: half a centavo.',
  'R-REC-002': 'Sum of printed (2-dp) line amounts differs from the printed subtotal by ≥ ₱0.01.',
  'R-REC-003': 'A total or line amount is NaN or infinite.',
  'R-MKP-001': 'OCM, profit, contingency or VAT outside 0–100 % or not a number.',
  'R-MKP-002': 'VAT other than 12 % or 0 %, or a markup above ${markupMax} %.',
  'R-TO-001': 'A level with no elements.',
  'R-TO-002': 'In the takeoff register, a level has scopes that are not Complete or Not applicable.',
  'R-TO-003': 'A scope marked Complete has no elements on that level.',
  'R-TO-004': 'A scope marked Not applicable has elements on that level.',
  'R-QUA-001': 'Elements in quarantine (unknown type from a loaded file) are not costed.',
  'R-STALE-001': 'The input hash (levels, elements, factors, prices, labor, settings) differs from the hash recorded at approval. Provenance notes and audit acknowledgements are not part of the hash.',
  'R-STALE-002': 'The input hash differs from the one recorded at the last export.',
};
const L = A.AUDIT_LIMITS, fill = s => s.replace(/\$\{(\w+)\}/g, (_, k) => L[k]);
const rows = Object.entries(A.RULES).map(([id, [sev, title]]) => `| ${id} | ${sev} | ${title} | ${fill(DETAIL[id] || '')} |`).join('\n');
const md = `# Audit Rules (auditor ${A.AUDIT_VERSION})

Generated from \`estimator.html\` by \`node scripts/make-rules-doc.mjs\`. Do not edit by hand.

All rules are deterministic functions of the saved project and the engine's own results. No AI and no clock are used. The caller passes \`today\`, which only the price-expiry rule reads.

**Severity:**
- **critical:** blocks approval and cannot be acknowledged.
- **major / minor:** can be acknowledged with a name and a reason. An acknowledgement re-opens automatically if the finding's evidence changes.
- **info:** shown for awareness.

**Finding IDs:** \`F-\` + a 64-bit FNV-1a hash of the rule ID and the finding's cause key (element id, level id, price code…). The ID stays the same while the cause is unchanged.

| Rule | Severity | Title | What is checked |
|---|---|---|---|
${rows}

## Export policies
${A.EXPORT_POLICIES.map(([k, n]) => `- **${k}**: ${n}.`).join('\n')}

Watermarks are added in front of the export body (CSV rows / Excel banner row / printed diagonal watermark and banner). The body itself is unchanged, and the golden-master tests check that it is byte-identical. Text cells starting with \`= + - @\` are prefixed with \`'\` so spreadsheets do not execute them.
`;
fs.writeFileSync(path.join(ROOT, 'AUDIT_RULES.md'), md);
console.log('Wrote AUDIT_RULES.md with', Object.keys(A.RULES).length, 'rules');
