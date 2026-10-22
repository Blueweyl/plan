# Plan: Structural and Architectural Estimator (Single HTML File, PH Standards)

## Context
The user wants an app for estimating structural and architectural works. They read dimensions off the attached structural and architectural plans and type them into forms, one element at a time. The app then produces quantities, a costed Bill of Quantities (BOQ) with labor, and an export.

The first scope is:
- rebar works
- masonry works
- partitions
- ceiling works

The repo `blueweyl/plan` is empty, so this is a greenfield build on branch `claude/dreamy-mendel-aoceoo`.

What the user decided:
- **Delivery:** a **single HTML file**. Open it in Chrome or Edge by double-clicking, with no install and no server. It works offline on a desktop.
- **Standards:** Philippines (NSCP/DPWH), metric units, peso pricing.
- **Output:** quantities, plus material cost, plus labor, plus markup and VAT.
- **Input:** one form per element.
- **Rebar rules:** NSCP defaults that can be edited per project.
- **Ceilings:** gypsum on metal furring, fiber cement on furring, acoustic T-runner grid, and PVC or wood.
- **Partitions:** drywall, fiber cement board, CHB (concrete hollow block), and toilet cubicles.
- **Pricing:** the user's own editable price list. Labor is either per unit or a % of materials.

## Approach
Everything lives in one file, `estimator.html`, with inline CSS and plain JavaScript. There is no framework and no build step, so the file stays portable: email it, put it on a USB stick, open it anywhere.

Inside the file the code is split into clearly separated sections:
1. `<style>`: the UI, plus print styles for the BOQ that turn it into a clean PDF.
2. `<script id="engine">`: pure calculation functions with no DOM access, grouped as `Rebar`, `Concrete`, `Masonry`, `Partition`, `Ceiling` and `Costing`, plus `FACTORS` defaults.
3. `<script id="app">`: the app logic, described below.

The app section handles:
- state and screens (Projects, Levels, Elements, Prices, Factors, BOQ)
- forms per element type
- rendering
- saving and exporting

**Saving:**
- Autosave to `localStorage` in the browser.
- **Save/Open project file (`.json`)** through download and file picker, so estimates can be backed up and moved between PCs. Browser storage can be wiped, so the JSON file is the reliable copy.

**Exports:**
- **Excel:** an `.xls` built from an HTML table, which Excel opens directly with no library needed, plus a CSV option.
- **PDF:** a print-styled BOQ through the browser's Print → Save as PDF.

## Data model (in-memory JSON, saved as above)
- **Project:** name, location, owner, and settings (cover, lap and hook overrides, waste %, OCM, profit, contingency and VAT).
- **Level/Floor:** name and height.
- **Element:** id, type, mark (C1, B2, W1…), level, quantity, and the inputs for that type.
- **Prices:** materials (code, name, unit, price) and labor (work item, unit, and a rate or % of materials).
- **Factors:** a snapshot of the defaults that can be edited per project, so later edits to the defaults don't change old estimates.

Each element computes to a list of material lines (code, quantity, unit). Costing joins those lines to the price list.

## Modules and formulas

### 1. Rebar
Elements: footings (isolated and wall), columns, beams, slabs (one-way and two-way), walls, and stairs.

Form inputs:
- dimensions and quantity
- cover
- main bars: diameter, number of bars, top/bottom/extra bars
- ties or stirrups: diameter and spacing, with optional zones near the supports

Calculations:
- **Bar weight:** kg/m = d²/162, for bar sizes 10, 12, 16, 20, 25, 28, 32 and 36 mm.
- **Lap length:** default 40d, editable. Splices are added automatically when a run is longer than the chosen commercial length.
- **Hooks:** 135° seismic hook for ties, extension 6d (min 75 mm). 90° standard hook, extension 12d.
- **Tie cut length:** perimeter inside the cover, plus 2 hooks.
- **Commercial lengths:** 6, 7.5, 9, 10.5 and 12 m. A cutting-list optimizer (first-fit decreasing) picks the bar count with the least waste.
- **Tie wire (#16 GI):** about 0.3 m per intersection, converted to kg. The factor is editable.

Output: a bar schedule per element and a summary in kg and pieces per diameter.

### 2. Concrete and formwork (small add-on)
Uses the same element dimensions:
- concrete volume in m³, converted to cement, sand and gravel by class (A/B/C) using editable factors
- formwork area in m²

### 3. Masonry (CHB)
- **Inputs:** wall length × height, minus openings (door and window schedule), and CHB size (4", 5" or 6").
- **Blocks:** 12.5 pcs/m², plus waste %.
- **Mortar and plaster:** cement and sand per m², taken from factor tables (class, thickness, one or both faces).
- **Wall reinforcement:** vertical bars @ 0.4/0.6/0.8 m and horizontal bars every 2/3 courses. These reuse the rebar functions.

### 4. Partitions
- **Drywall and fiber cement:**
  - studs @ 406 or 610 mm, plus tracks
  - boards on one or both faces (1.22 × 2.44 m)
  - screws, joint tape, compound, and optional insulation
- **CHB partition:** reuses the masonry module.
- **Toilet cubicles:** counted per set, with a lump-sum price.

### 5. Ceiling
Inputs: room L × W (or area plus perimeter) and the ceiling system.
- **Gypsum or fiber cement on furring:**
  - carrying channel @ 1.2 m and furring @ 0.4 or 0.6 m, in 5 m lengths
  - wall angle along the perimeter
  - hangers
  - boards, screws and rivets
- **Acoustic grid:**
  - main runner (3.66 m) @ 1.22 m
  - cross tees at 1.22 and 0.61 m
  - wall angle and 600 × 600 tiles
- **PVC or wood:** panels, furring or frame, and trim.

### 6. Costing and BOQ
For each line, material amount = quantity × unit price.

Labor is either per unit (per m², per kg or per set) or a % of materials.

The totals add up as follows:
1. direct cost = materials + labor
2. add OCM %, profit % and contingency %
3. add VAT 12% on top

The BOQ is grouped by work item, then by level, and exports to Excel or PDF.

## Factor defaults
All factors are seeded with common PH estimating values (Fajardo-style) and are editable on a Factors screen.

The mortar, plaster and concrete mix factors will be flagged so the user checks them against their own references.

## Build order (milestones, each committed and pushed)
1. **Skeleton** of `estimator.html`: layout and tabs, project and level management, the price list screen, and save/open JSON.
2. **Rebar engine,** then the forms for footings, columns, beams, slabs, walls and stairs, then the bar schedule and summary.
3. **Concrete and formwork.**
4. **Masonry.**
5. **Partitions.**
6. **Ceiling** for all 4 systems.
7. **Costing, BOQ view, and Excel/PDF export.**

## Verification
- **Built-in self-test:** a hidden **Self-test** button runs worked examples calculated by hand against the engine and shows pass or fail.
  - Example: column C1 0.4 × 0.4 × 3.0 m with 8-16 mm bars and 10 mm ties @ 150 should give the expected count, cut lengths and kg.
  - The same approach covers a CHB wall with one opening, a gypsum ceiling room, and a drywall partition.
- **Headless test:** the same tests run with Playwright and the pre-installed Chromium during development. The script loads the file, runs the self-test, and screenshots each screen.
- **Manual check:** open the file, create a project, enter one element of each type, confirm the BOQ totals match the hand calculations, export `.xls` and PDF, and open them.

The plan is also saved as `PLAN.md` in the repo alongside `estimator.html`.
