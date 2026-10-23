# Structural & Architectural Estimator

A single-file estimator, `estimator.html`, for Philippine projects (NSCP/DPWH practice, metric units, pesos).
Open it in Chrome or Edge by double-clicking. It needs no install, no server and no internet.

## What it estimates
- **Rebar works:**
  - elements: isolated and wall footings, columns, beams, slabs, RC walls, stairs
  - cut lengths with hooks and laps
  - commercial-length optimization (6 to 12 m)
  - tie wire
- **Concrete and formwork:** taken from the same element dimensions.
- **Masonry:** CHB walls, with openings, laying mortar, plaster and wall reinforcement.
- **Partitions:** drywall or fiber cement on metal studs, CHB partitions and toilet cubicles.
- **Ceilings:** gypsum or fiber cement on metal furring, acoustic T-runner grid, PVC, and plywood on a wood frame.
- **BOQ:** materials plus labor (₱ per unit or % of materials), then OCM, profit, contingency and VAT.
  - Exports to Excel, CSV, or PDF (through Print).

## Phase 3 calculators
Excavation & backfill, roofing, floor/wall tiles, waterproofing, painting, doors & windows, structural steel, and plumbing and electrical schedules. See `MODULES.md`. Their coefficients start **not set** and must be entered (from Fajardo or the product data sheet) before the quantities that need them reach the BOQ. Specified products are priced inside each element.

## Workflow
0. **Dashboard:** total cost, rebar, concrete and CHB at a glance; cost by division and level; what needs attention; quick actions. Light/dark toggle in the top bar.
1. **Project & data tab:** set the project info and levels/floors.
2. **Elements tab:** add each element from the plans: mark, level, quantity and dimensions. Results preview live.
3. **Rebar schedule tab:** the bar list and the number of bars to buy, per diameter.
4. **Audit tab:** deterministic checks (36 rules, see `AUDIT_RULES.md`) with severities, evidence and suggested fixes; acknowledge non-critical findings with a reason; drawing takeoff register; approve the estimate (blocked while critical findings exist); export policy. Draft exports are watermarked.
5. **BOQ & Cost tab:** the costed bill of quantities, with export.
6. **Labor & equipment tab:** trades and daily wages (not preset), crews, equipment rental rates, minimum charges and mobilization; choose one method per labor item: unit rate, % of materials, productivity (crew × days) or pakyaw (lump sum). Optional equipment per item.
7. **Prices / Factors tabs:** your supplier prices and labor rates, and the estimating factors.
   - The sample prices and the factors marked VERIFY must be checked against your own references.

Work autosaves in the browser; the top bar shows whether the last autosave worked and how many changes are not yet in a project file. Local backups are kept before New, Open and Restore. Use **Save project file** (`.estimate.json`) to keep a permanent copy or move it to another PC.

## Tests
- In the app, the **Self-test** link in the footer runs hand-calculated worked examples.
- Headless run: `node tests/selftest.mjs [screenshotDir]`. This needs Playwright and Chromium.

See `PLAN.md` for the plan, `AUDIT.md` for the Phase 0 audit, `TEST_PLAN.md` for testing (`npm test`) and `MIGRATION_PLAN.md` for the v2 data migration.
