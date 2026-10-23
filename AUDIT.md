# Phase 0 Audit: Construction Estimator

| | |
|---|---|
| **Audited file** | `estimator.html` (1 file, 1,097 lines, sha256 `24263786…f085c`) |
| **Untouched copy** | `original/estimator.v1.html` (byte-identical, same hash) |
| **Commit** | `3bdb624` on `claude/dreamy-mendel-aoceoo` |
| **Date** | 2026-10-23 |
| **Status** | Phase 0 complete. **Stopped before Phase 1**, as required, because the critical issues below need decisions. |

## 0. Scope limitation: read first

The brief names `Construction Estimator.dc.html`, the Claude Design file. **That file is not in this repository or this session**, and I cannot read it from claude.ai/design. This audit covers `estimator.html`, which holds the only calculation engine I can access.

Differences from the brief that I could verify:

| Brief says | Found in `estimator.html` |
|---|---|
| 11 element types | **12** types. CHB wall and CHB partition are separate types that share one formula (`chbCalc`). The design file probably counts them as one. |
| "current 18-element sample project" | The app ships with **no** sample project. I created `tests/fixtures/sample-18.estimate.json`: 18 elements, 2 levels, every type and every ceiling system. Its dimensions are synthetic test inputs, not taken from a drawing. |
| Approved Claude Design layout | Not available here. Your screenshot shows every total at ₱0.00, which suggests the design file does not connect to a working engine. |

When the `.dc.html` file is added (for example as `original/Construction Estimator.dc.html`), the same audit, baseline and tests will be extended to it. Until then, **`estimator.html` is treated as the source of truth for formulas.**

---

## 1. Inventory

### 1.1 Architecture
- **One HTML file with no dependencies.** Inline CSS, plus two scripts:
  - `<script id="engine">` (lines 113–722): pure calculation code. It touches no DOM or storage. Its only side effect is `toLocaleString` in `fmt`.
  - `<script id="app">` (lines 727–1096): state, rendering, editing, storage and export.
- **Rendering model:** full re-render of the active tab through `innerHTML` template strings, with inline `onclick` and `onchange` handlers.

### 1.2 Element types (engine `TYPES`, lines 336–541)

| Key | Name | Inputs | Divisions written | Materials | Labor |
|---|---|---|---|---|---|
| `footing` | Isolated footing | 11 | REBAR, CONC, FORM | RBxx, CEM, SAND, GRAV, FORM | L_CONC, L_FORM (+L_RB) |
| `wallfooting` | Wall footing | 11 | REBAR, CONC, FORM | same | same |
| `column` | Column | 15 | REBAR, CONC, FORM | same | same |
| `beam` | Beam | 21 | REBAR, CONC, FORM | same | same |
| `slab` | Slab | 13 | REBAR, CONC, FORM | same | same |
| `rcwall` | RC wall | 12 | REBAR, CONC, FORM | same | same |
| `stairs` | Stairs (waist slab) | 13 | REBAR, CONC, FORM | same | same |
| `chbwall` | CHB wall | 14 | MAS | CHBn, CEM, SAND, RBxx, TW | L_CHB, L_PLAS |
| `chbpart` | CHB partition | 14 | PART | same as chbwall | same |
| `drywall` | Drywall / FC partition | 8 | PART | STUD, TRK, ANC, board, CSCR, JT, JC, INS | L_PART |
| `cubicle` | Toilet cubicle | 2 | PART | CUB | L_CUB |
| `ceiling` | Ceiling (5 systems: gyp, fc, acoustic, pvc, wood) | 6 | CEIL | varies by system | L_CEIL |

### 1.3 Calculation functions (engine)

| Function | Line | Purpose |
|---|---|---|
| `kgpm(d)` | 120 | d²/162 kg/m |
| `ceilE`, `floorE` | 117–118 | ceil/floor with a 1e-9 epsilon, so that 3/0.15 does not become 21 |
| `round(x,n)` | 119 | `Math.round(x·10ⁿ)/10ⁿ` |
| `tieHook`, `hook90`, `lapLen` | 235–237 | max(6d, 75 mm); 12d; 40d |
| `countAcross` | 238 | ⌊w/s⌋+1, or 0 when w ≤ 0 or s ≤ 0 |
| `countZoned` | 239 | ties/stirrups with an optional confined zone at each end |
| `splitPiece` | 246 | splits a bar longer than the stock length with laps; returns `null` if stock ≤ lap |
| `ffdBars` | 254 | first-fit-decreasing cutting, grouped by length |
| `optimizeDia` | 269 | chooses the commercial length with the least purchased length |
| `concreteOut`, `formOut` | 302, 309 | concrete materials and labor; formwork |
| `parseOpenings` | 315 | parses `W x H x n` lists |
| `chbFields`, `chbCalc` | 543, 550 | shared CHB wall/partition schema and formula |
| `normInputs` | 572 | fills defaults, converts values to numbers |
| `computeElement` | 584 | runs one element |
| `buildEstimate` | 593 | per level and division: aggregates, optimizes rebar, adds tie wire and rebar labor |
| `qtyRound` | 624 | rounds pc/bag/set up; everything else to 2 dp |
| `buildBOQ` | 627 | costed rows, division totals, markups and VAT |
| `runSelfTests` | 668 | 8 hand-calculated examples |

### 1.4 App functions
- **State:** `defaultState` (734), `deepMerge` (746), `loadState` (753), `persist` (764).
- **Actions** (`App`, 771–812): `tab`, `set`, `newProject`, `saveFile`, `openFile`, `addLevel`, `delLevel`, `moveLevel`, `filter`, `addEl`, `editEl`, `copyEl`, `delEl`, `resetPrices`, `resetFactors`, `exportXls`, `exportCsv`, `print`.
- **Views:** `vProject`, `vElements`, `vRebar`, `vBOQ`, `vPrices`, `vFactors`, `vSelfTest`.
- **Editor:** `openEditor`, `readEditor`, `preview`, `saveEditor`, `closeEditor`.
- **Exports:** `boqHtmlTable(forExcel)`, `boqCsv`, `download`.

### 1.5 Storage
| Key | Content | Written by |
|---|---|---|
| `localStorage['estimator.v1']` | the whole project state as JSON | `persist()` after every edit |
| `localStorage['estimator.v1.tab']` | the last open tab | `App.tab` |
| Project file `*.estimate.json` | the same JSON, pretty-printed | `App.saveFile` (download) |

### 1.6 Data structure (`version: 1`)
```
{ version, project{name,location,owner,date,notes}, settings{stock,ocm,profit,contingency,vat},
  levels[{id,name,h}], elements[{id,type,mark,level,qty,inp{…}}],
  prices{CODE:{name,unit,price}} (46), labor{CODE:{div,name,unit,mode,rate}} (8),
  factors{rebar,concrete,chb,plaster,boards,ceiling,partition,waste} (83 numeric values) }
```

### 1.7 Exports
- **Excel:** an HTML table saved as `.xls` (MIME `application/vnd.ms-excel`). It is **not** a real XLSX.
- **CSV:** UTF-8 with a byte-order mark, CRLF line endings, all cells quoted.
- **PDF:** the browser's print dialog with a print stylesheet.

---

## 2. Findings

Severity scale:
- **Critical:** can silently produce a wrong estimate or lose data, or breaks a non-negotiable requirement.
- **High:** a security issue, or a destructive action without a safeguard.
- **Medium:** wrong in edge cases, or misleading.
- **Low:** code quality.

Every finding marked ✅ is reproduced by an automated test named after its ID, in `tests/audit-probes.test.mjs` or `tests/migration.test.mjs`.

### Critical

| ID | Finding | Where | Evidence | Fix (phase) |
|---|---|---|---|---|
| **A-C01** | **Coefficient and price provenance (non-negotiable #5).** None of the 83 factors cites a source. I wrote the concrete mixes, CHB mortar, plaster, hook, lap, tie-wire and ceiling/partition factors from general PH practice ("Fajardo-style") without a cited table. **The 5" CHB mortar row (A 1.150 / B 0.770 / C 0.580 / sand 0.0640) was interpolated by me, which counts as an invented coefficient.** All 46 material prices and 8 labor rates are placeholders. | engine 135–232 | ✅ A-C01. The UI already shows VERIFY and "sample prices" notes, but nothing blocks their use. | Do not change the values: they are the baseline. Phase 2 adds a per-coefficient `source` and `verified` status; unverified coefficients and placeholder prices raise blocking findings. You need to supply cited values from your own Fajardo/DPWH references. |
| **A-C02** | **Rebar silently disappears from the BOQ** when no candidate commercial length is longer than the lap length, e.g. a fixed 6 m stock with a large lap factor. `optimizeDia` returns `null` and `buildEstimate` skips that diameter without any message. | 288, 613 | ✅ A-C02 | Phase 2: blocking finding, plus a fallback line "unoptimized net kg". |
| **A-C03** | **Elements whose level no longer exists are left out of the estimate.** `buildEstimate` loops over levels, not elements. Orphans come from imported or edited files, or from a file whose `levels` is empty (then `loadState` creates a new default level and **every** element becomes an orphan, total ₱0). | 596, 758 | ✅ A-C03, A-C03b | Migration v2: re-attach orphans to a recovered "Unassigned" level. Phase 2: blocking finding. |
| **A-C04** | **Silent storage data loss.** (a) If localStorage holds corrupt JSON, the app starts an empty project with no message, and the **first edit overwrites** the corrupt data, which can no longer be recovered. (b) `persist()` swallows every write error (quota exceeded, blocked storage), so the user believes the work is saved. | 763–764 | ✅ A-C04, A-C04b | Phase 1: quarantine corrupt data under a backup key and warn; show a visible "Not saved" state; keep a rolling backup. |

### High

| ID | Finding | Where | Evidence | Fix |
|---|---|---|---|---|
| **A-H01** | **XSS from an opened project file.** Values from the JSON are inserted into `innerHTML` or inline handlers without escaping: element `qty` (880), editor numeric `value` (905), level `h` (855), price/rate values (1046, 1053), factor keys and values (1059–1063), element and level ids inside `onclick` strings (857, 881). A shared `.estimate.json` can run script, for example to silently change prices. | listed | ✅ A-H01, A-H01b, A-H01c | Phase 1: validate types on load (migration), escape every interpolation, and replace inline handlers with event delegation on `data-*` ids. |
| **A-H02** | **"Open…" replaces the current project with no confirmation and no backup.** | 822 | ✅ A-H02 | Phase 1: confirm, and auto-backup the current state before replacing it. |
| **A-H03** | **Unknown element types are silently dropped on load**, so a file from a newer version loses data. | 757 | ✅ A-H03 | Migration v2: keep unknown elements unchanged (quarantined, not costed) and warn. |
| **A-H04** | **No input validation.** Negative, empty, text and NaN dimensions become 0 or negative, and quantities silently become 0 (`normInputs` uses `Number(v) \|\| 0`). | 576–577 | ✅ A-H04 | Phase 2: field rules (required, min > 0, max) with findings; the editor shows errors as you type. |
| **A-H05** | **Invalid rebar geometry is accepted.** A spacing of 0 silently drops the bars. A cover larger than half the section gives a negative inner perimeter, and the 2 hooks turn it into a **30 mm tie** that gets priced. | 238, 375 | ✅ A-H05 | Phase 2: rule "inner dimension ≤ 0", rule "spacing ≤ 0". |

### Medium

| ID | Finding | Evidence |
|---|---|---|
| A-M01 | Line amounts are `qty × rate` and are not rounded to centavos, so printed lines can differ from printed totals by centavos. They happen to reconcile exactly for the sample project, as recorded in the baseline. | ✅ A-M01 |
| A-M02 | CSV formula injection: names starting with `= + - @` are exported as-is. | ✅ A-M02 |
| A-M03 | The default project date uses UTC (`toISOString`), so between 00:00 and 08:00 Manila time it shows yesterday. | ✅ A-M03 |
| A-M04 | A fractional element quantity is rounded silently (2.5 → 3). The editor also rounds it, without saying so. | ✅ A-M04 |
| A-M05 | Openings larger than the wall clamp the net area to 0 silently. | ✅ A-M05 |
| A-M06 | `round()` gets half-way values wrong because of binary floating point (1.005 → 1.00). | ✅ A-M06 |
| A-M07 | The "Excel" export is an HTML table with an `.xls` name, so Excel shows a format warning. It is not a real XLSX. | inspection |
| A-M08 | The `version` field is never read, so there is no migration path. | inspection |
| A-M09 | Concrete and formwork are gross volumes and areas: beam/column/slab joints are counted twice. This is a reasonable convention but is not stated anywhere in the BOQ. | inspection |
| A-M10 | Duplicate element marks are accepted without warning. | ✅ A-M10 |
| A-M11 | Rebar is optimized per level and division, not for the whole project. This is a documented design choice, but the purchase list can be longer than a whole-project optimization would give. | inspection |

### Low (code quality)
- **A-L01 Duplicate logic.**
  - `vRebar` re-runs `computeElement` separately from `buildEstimate`.
  - `boqHtmlTable` and `boqCsv` each format rows on their own.
  - State changes through both `App.set` and inline `S.x = …` handlers.
- **A-L02 Tie wire attribution.** The intersections of an element are assigned to the division of its first bar (605). Correct today, because each element writes bars to only one division.
- **A-L03 No undo.** Deletes are protected only by `confirm()`, with no undo.
- **A-L04 Accessibility gaps.**
  - Tabs have no `role="tab"` or `aria-selected`.
  - The dialog has no `aria-labelledby`.
  - Pass/fail relies partly on color (the text is present too).
- **A-L05 Tie wire omission.** Slab top bars at supports add no tie-wire intersections. ✅ A-L05
- **A-L06 Full re-render.** The whole active tab is rebuilt on every change. Fine at 18 elements; still unmeasured at 1,000 or more.

### Checked and OK
- **Epsilon handling** of spacing divisions (3.0/0.15 → 21 ties, not 22) is tested.
- **Escaping:** user text fields (marks, names, notes, descriptions) are escaped with `esc()`.
- **The engine is deterministic:** the same inputs give the same outputs. Node and Chromium produce identical totals (recorded in the baseline).

---

## 3. Critical issues to resolve before proceeding

Per the brief ("report critical issues before proceeding"), Phase 1 should start only after these decisions:

1. **A-C01, coefficients.** Supply cited values (table, edition, page) for concrete, mortar and plaster, or confirm that the current values stay marked as **unverified** and that approval stays blocked until verified. I will not substitute values of my own.
2. **The design file.** Provide `Construction Estimator.dc.html`, or confirm that Phase 1 should rebuild the layout from the screenshot and your design prompt.
3. **A-C02, A-C03 and A-C04** are fixed by Phases 1 and 2 without changing any formula. The golden master stays identical for valid inputs.

## 4. Calculation conventions (current, documented for reproducibility)
- **Lengths and units:** m for dimensions; mm for bar diameter, cover and spacing. Bar weight is d²/162 kg/m.
- **Laps:** a bar longer than the commercial length is spliced with 40d laps. The lap length is added to the purchased length, not to the net length.
- **Ties and stirrups:** count = ⌈H/s⌉ + 1, or zoned. Cut length = inner perimeter + 2 × max(6d, 75 mm). Bend deductions are not applied.
- **Footing bars:** count = ⌊(W − 2c)/s⌋ + 1; length = L − 2c + 2 × 12d when hooked.
- **Concrete materials:** volume × (1 + 5% waste) × mix factor. Labor is on the net volume.
- **Waste allowances:** rebar waste comes only from cutting optimization; `allowancePct` defaults to 0. CHB, boards and metal default to 5%.
- **Rounding:** pc, bag and set are rounded up per level and division; other units to 2 dp.
- **Markups:** OCM, profit and contingency are each a % of direct cost. VAT is applied to direct + markups.

---

## 5. Status after Phase 1 (2026-10-23)

### Decisions recorded
| Question | Decision | Effect |
|---|---|---|
| Coefficients | Use **Max Fajardo** | Concrete, CHB mortar (4" and 6") and plaster factors now carry the source *Max B. Fajardo Jr., Simplified Construction Estimate*. They **stay unverified** until a person records the table/page and ticks Verified, because the values have not been checked against the book. The 5" mortar row keeps the source "None – interpolated". |
| Design file | Rebuild from the screenshot | New layout: sidebar and top bar, KPI cards, cost breakdown, BOQ division cards, Needs attention, Project intelligence, Quick actions, light/dark theme. |
| Reference formulas | `estimator.html` | The engine block is byte-identical to `original/estimator.v1.html`; the golden master is unchanged. |

### Finding status
| ID | Status | How | Test |
|---|---|---|---|
| A-C01 | **Open, mitigated** | Every coefficient has a provenance record (`factorMeta`: source, table/page, verified, note) shown on the Factors tab and counted under Needs attention. Blocking approval is Phase 2. | A-C01 (probe), P1-19 |
| A-C02 | **Open, mitigated** | The engine still omits the bar size, but the Rebar schedule shows "Not purchasable" and Needs attention shows it as critical. The engine-level fix (a finding plus a fallback line) is Phase 2. | A-C02 (probe), P1-18 |
| A-C03 | **Fixed** | Migration moves orphans to "Unassigned (recovered)" and reports them. | MIG-04, MIG-04b |
| A-C04 | **Fixed** | Corrupt data is kept byte-identical under a backup key. If the backup fails, autosave pauses. Save failures show "Not saved" in the top bar and a critical item on the dashboard. | MIG-05, MIG-05b, P1-09 |
| A-H01 | **Fixed** | Values are type-checked at load (unsafe ids replaced, bad numbers quarantined, unknown factor keys quarantined, prototype keys ignored). Every rendered value is escaped. Inline handlers are replaced by event delegation on `data-act`/`data-bind`. | MIG-06, MIG-06b, P1-11 (18-vector corpus) |
| A-H02 | **Fixed** | Open asks for confirmation and keeps a local backup; backups can be restored. | P1-12 |
| A-H03 | **Fixed** | Unknown element types are quarantined, preserved through save and reload, and reported. | MIG-03 |
| A-H04, A-H05 | **Open, mitigated** | Elements producing no quantities are flagged on the Elements list, in the editor and under Needs attention. Field validation rules are Phase 2. | probes, P1 dashboard |
| A-M03 | **Fixed** | Default date uses the local calendar date. | P1-13 |
| A-M08 | **Fixed** | Schema v2 with a versioned, idempotent `migrate()`. | MIG-01, MIG-02 |
| A-L03 | Partly | Local backups before New, Open and Restore. Per-action undo is not implemented. | P1-12 |
| A-L04 | Partly | `aria-current` on nav, a labelled dialog, focus kept on keyboard navigation, visible focus rings. | P1-15 |
| A-M01, A-M02, A-M04, A-M05, A-M06, A-M07, A-M09, A-M10, A-M11, A-L01, A-L02, A-L05, A-L06 | Open | Planned for Phase 2 (auditor rules, export policy). | probes |

### Correction to Phase 0
The Phase 0 baseline stored the per-level material and labor maps as empty `{}`: the serializer's `instanceof Map` check fails for objects created in the Node VM context. Every other recorded value was correct. The serializer now detects Maps by type tag. The baseline is regenerated **from the untouched `original/estimator.v1.html`** (engine and exports) and is identical to Phase 0 on every value it already had.

---

## 6. Status after Phase 2: Smart Estimate Auditor (2026-10-23)

A separate `<script id="auditor">` block holds 36 deterministic rules (full list: `AUDIT_RULES.md`, generated from the code). It reads the saved inputs and the engine's own results. It never changes a number; the golden master is unchanged and the engine block is byte-identical to the original.

| ID | Status after Phase 2 | Rule / mechanism | Test |
|---|---|---|---|
| A-C01 | **Controlled** | R-COEF-001 (unverified coefficient actually used by a costed element; critical by default, so approval is blocked) and R-COEF-002 (the interpolated 5" row, always critical). Approval is possible only after a person verifies each used value against Fajardo. | R-COEF-001/002, factorsUsed completeness (perturbation of all 83 factors × 21 elements) |
| A-C02 | **Fixed (detected)** | R-RB-003 (critical, with the affected elements). The engine still omits the bar; the auditor makes it impossible to miss or approve. | R-RB-003 |
| A-H04 | **Fixed (detected)** | R-DIM-001/002/003 on every numeric input; live in the editor. | R-DIM-* |
| A-H05 | **Fixed (detected)** | R-RB-001 (cover ≥ half the section, which no longer passes as a 30 mm tie), R-DIM-003 (zero spacing), R-RB-002. | R-RB-001/002 |
| A-M01 | **Mitigated** | R-REC-002 reports printed-rounding differences; R-REC-001 proves the unrounded totals reconcile to half a centavo. Rounding line amounts would change the numbers, so it stays a policy decision for you. | R-REC-001/002, A-M01 probe |
| A-M02 | **Fixed** | Text cells starting with `= + - @` (tab/CR) get an apostrophe prefix in CSV and Excel. Normal output is byte-identical. | formula-injection test, exports golden |
| A-M04 | **Fixed (detected)** | R-DIM-004. | R-DIM-004 |
| A-M05 | **Fixed (detected)** | R-DIM-005 and R-DIM-006. | R-DIM-005/006 |
| A-M09 | **Fixed (detected)** | R-OVL-001/002 give exact upper bounds for slab–beam and column–beam double counting. | R-OVL |
| A-M10 | **Fixed (detected)** | R-DUP-001/002. | R-DUP |
| A-M06, A-M07, A-L05, A-L01, A-L02, A-L06 | Open | Not in Phase 2 scope (half-up rounding, true XLSX, tie wire at slab supports, code duplication, render cost). | probes |

### What the auditor adds to the app
- **Audit tab:**
  - severity cards
  - an approval panel: a named approver; blocked while any critical finding exists; the approval records the input hash, totals and open findings
  - an approval log and revoke
  - policy settings
  - a drawing takeoff register
  - every finding with ID, rule, references, evidence, suggested action, status and acknowledgement history
  - the rule catalogue
- **Acknowledgement:** needs a name and a reason. Critical findings cannot be acknowledged. If the evidence changes, the finding re-opens.
- **Staleness:** R-STALE-001 is raised after approval and R-STALE-002 after export, using a hash of everything that can change a quantity or cost. Provenance notes and acknowledgements are excluded from that hash.
- **Export policy:**
  - draft watermark (default)
  - issues-only
  - block-critical

  Draft CSV, Excel and print output carries a "DRAFT – NOT APPROVED – n critical, m major" mark. Approved, unchanged output carries an "APPROVED … by …" header.
- **Editor validation:** element rules run as you type.

### Defects found and fixed during Phase 2 testing
1. **Reconciliation tolerance too loose.** It was relative (1e-6 × amount), so it let ₱1.56 of error through on a ₱1.5M total. It is now an absolute half-centavo tolerance. A test tampers one centavo.
2. **False unit warning.** Plaster thickness (mm) was range-checked as a bar spacing, which raised a wrong warning on the sample project. Each mm field now has its own range.
3. **Print banner wiped.** The watermark banner was cleared by a re-render during print.

### Remaining risks
- An audit takes about 0.3 s on a 1,000-element project (measured in Chromium), and it runs once per change.
- Overlap and unit rules are heuristics with stated bounds. They make no claim about the design.
- Approval is a single-user record until Phase 5 (revisions) and Phase 6 (accounts and roles).
