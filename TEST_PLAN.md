# Test Plan

## How to run
Requirements: Node 22+ and Playwright with Chromium. In the cloud environment both are preinstalled; locally, run `npm i -g playwright && npx playwright install chromium`.

```
npm test                         # every suite (78 tests after Phase 1)
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
| `tests/audit-probes.test.mjs` | Issue reproductions | One test per **open** audit finding. Each passes while the issue exists. | 11 |
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
| 1 Dashboard | KPI values equal `buildBOQ` totals; every nav item opens a real view; no fixed numbers in the DOM (scan for literals); save status reacts to a simulated storage failure; light/dark contrast (axe); 768 px and 1280 px screenshots; keyboard tab order. |
| 2 Auditor | One test per rule ID with positive and negative cases; stable finding IDs across reloads; critical findings block approval; draft watermark in CSV, XLS and print. |
| 3 Calculators | Hand-calculated worked examples per module (net, deductions, waste, purchase); unit conversions; golden master extended to the new types. Existing 18-element baseline unchanged. |
| 4 Labor/equipment | Same BOQ under each costing method with no double counting; switching methods round-trips; pakyaw and crew arithmetic. |
| 5 Revisions | Snapshots are immutable (hash); diff reports quantity changes vs price changes; restore creates a new revision; an approved revision reproduces exactly with its own factors and engine version. |
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
