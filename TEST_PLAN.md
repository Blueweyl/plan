# Test Plan

## How to run
Requirements: Node 22+ and Playwright with Chromium. In the cloud environment both are preinstalled; locally, run `npm i -g playwright && npx playwright install chromium`.

```
npm test                         # every suite (159 tests after Phase 5)
npm run test:engine              # golden master only, no browser needed
node scripts/make-baseline.mjs --check   # compare engine + exports to BASELINE_RESULTS.json
node tests/selftest.mjs [dir]    # UI smoke test + screenshots
```

**Gate rule:** a phase may be merged only when `npm test` passes. Any change to a golden-master value fails the build. A golden master may be regenerated (`npm run baseline`) only for an **intended** formula change, with a reviewed diff and an AUDIT entry.

## Suites

| File | Kind | What it proves | Count |
|---|---|---|---|
| `tests/golden.test.mjs` | Regression (Node, baseline recorded from `original/estimator.v1.html`) | Each of the 18 sample elements (bars, cut lengths, counts, materials, labor, intersections, kg), the per-level rebar purchase optimization, every BOQ row, division totals, markups, VAT and grand total all match `BASELINE_RESULTS.json`. Also checks reconciliation and that the self-test passes. | 25 |
| `tests/exports.test.mjs` | Regression (browser) | CSV text and XLS HTML are byte-identical to the baseline (sha256). The CSV grand total equals the engine total. Every tab renders the sample project with no page errors. | 3 |
| `tests/migration.test.mjs` | Compatibility (browser) | COMPAT-01…07: v1 files keep loading with identical results. MIG-01…08: the v2 migration guarantees (quarantine, orphan recovery, corrupt-storage backup, XSS/prototype keys, forward compatibility with v1, pre-v2 backup). | 18 |
| `tests/phase1.test.mjs` | Dashboard & safety (browser) | KPIs and division cards equal engine totals; every ₱ on the dashboard is a computed value; every nav item and control is wired; save failures visible; Open confirms with backup; 18-vector XSS corpus; local date; light/dark; no horizontal scroll at 375/768/1280 px; keyboard nav; empty state; revision/save chips; coefficient verification. | 21 |
| `tests/phase2.test.mjs` | Auditor (Node + browser) | Exact findings for the sample project; required fields on every finding; stable and unique IDs; determinism and purity; a positive and a negative case for each rule; `factorsUsed` completeness by perturbing every factor; reconciliation against a one-centavo tamper; acknowledgement, approval, staleness; all three export policies; draft watermark on CSV/Excel/print; formula-injection neutralisation; editor live validation; takeoff register. | 42 |
| `tests/phase3.test.mjs` | Calculators (Node + browser) | Legacy golden master identical with the modules loaded, and every legacy BOQ row identical when module items are present; 10 hand-calculated examples; schema/doc/trace for each module; empty inputs never priced; optional zeros and relevance; missing coefficient → item omitted + R-COEF-003; ordered divisions and reconciliation; element-priced items × quantity and %-labor; unpriced item critical; `factorsUsed` completeness by perturbation; plausibility checks; deductions, conversions, waste and rounding; equipment opt-in; Phase 2 file migration; every module added through the editor. | 16 |
| `tests/phase4.test.mjs` | Labor & equipment (Node + browser) | Legacy golden master identical with the labor layer; 4 hand-calculated examples; productivity, burden and parallel crews; pakyaw allocation sums to the lump; switching methods leaves no residue; equipment minimums and one-time mobilization; rental conversions; R-LAB-001/002/003; sample-rate rules limited to legacy methods; approval hash unchanged by the upgrade; labor-setup migration and sanitising; the whole Labor tab flow in the browser. | 14 |
| `tests/phase5.test.mjs` | Revisions (Node + browser) | Exact quantity/price decomposition; price-only and quantity-only changes; element and input diffs; labor and equipment classification; immutable reproducible snapshots; submitted→approved→superseded and returned; approval blocked by criticals; restore as a new revision without touching history; tamper detection; historical CSV with original totals and status; recalculation check; append-only comments; Audit-tab approval creates a revision; comparison screen; revision migration. | 15 |
| `tests/audit-probes.test.mjs` | Issue reproductions | One test per **open** audit finding. Each passes while the issue exists. | 4 |
| `estimator.html` → Self-test | Hand calculations | 8 worked examples: column, footing, laps/commercial lengths, CHB wall, gypsum ceiling, drywall, openings parser, bar weight. | 8 |

**Tolerance:** numbers must match to `|a − b| ≤ 1e-9 · max(1, |b|)`; strings must match exactly. Engine results in Node and in Chromium are compared with each other as well.

**Mutation check (done in Phase 0):** changing the bar-weight constant from 162 to 162.01 changed the grand total from ₱1,560,700.85 to ₱1,560,676.59. The golden master detected it.

## Lifecycle of a KNOWN-ISSUE test
When a phase fixes a finding:
1. Invert the probe so it asserts the correct behaviour, rename it `FIXED A-xxx …`, and move it to the suite for that phase.
2. Add a golden-master check showing that valid inputs are unaffected.
3. Update the finding's status in AUDIT.md.

## Coverage by phase (planned)

| Phase | Automated tests to add |
|---|---|
| 1 Dashboard | **Done** (`tests/phase1.test.mjs`): KPI values equal `buildBOQ` totals; every nav item opens a real view; no fixed numbers in the DOM (scan for literals); save status reacts to a simulated storage failure; light/dark contrast (axe); 768 px and 1280 px screenshots; keyboard tab order. |
| 2 Auditor | **Done** (`tests/phase2.test.mjs`). |
| 3 Calculators | **Done** (`tests/phase3.test.mjs`). |
| 4 Labor/equipment | **Done** (`tests/phase4.test.mjs`). |
| 5 Revisions | **Done** (`tests/phase5.test.mjs`). |
| 6 Sheets backend | Apps Script unit tests (gas-local / clasp); optimistic-concurrency conflict; idempotent replay; role matrix; soft delete; pagination. |
| 7 PDF takeoff | Scale calibration on fixtures with known dimensions; a suggestion cannot reach an approved BOQ without review (state machine); cost-cap confirmation. |
| 8 QA | Full regression, performance (1,000 elements), security (XSS corpus, CSV injection), accessibility. |

## Manual checklist (each release)
- [ ] Open the sample fixture. The grand total equals `BASELINE_RESULTS.json` → `boq.totals.grand`.
- [ ] Add, edit, copy and delete one element of each type. The live preview matches the saved result.
- [ ] Export Excel and CSV and open both in Excel/LibreOffice. The totals match the screen.
- [ ] Print to PDF on A4. Rows are not cut across pages; the title block is present.
- [ ] Save the project file, clear browser data, open the file. All data is back.
- [ ] Footer Self-test shows 8/8.
