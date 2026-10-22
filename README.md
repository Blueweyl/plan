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

## Workflow
1. **Project tab:** set the project info and levels/floors.
2. **Elements tab:** add each element from the plans: mark, level, quantity and dimensions. Results preview live.
3. **Rebar schedule tab:** the bar list and the number of bars to buy, per diameter.
4. **BOQ & Cost tab:** the costed bill of quantities, with export.
5. **Prices / Factors tabs:** your supplier prices and labor rates, and the estimating factors.
   - The sample prices and the factors marked VERIFY must be checked against your own references.

Work autosaves in the browser. Use **Save project file** (`.estimate.json`) to keep a permanent copy or move it to another PC.

## Tests
- In the app, the **Self-test** link in the footer runs hand-calculated worked examples.
- Headless run: `node tests/selftest.mjs [screenshotDir]`. This needs Playwright and Chromium.

See `PLAN.md` for the full plan and formulas.
