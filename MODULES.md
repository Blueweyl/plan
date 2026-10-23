# Calculators added in Phase 3 (modules 1.0.0)

Generated from `estimator.html` by `node scripts/make-modules-doc.mjs`. Do not edit by hand.

**Rules that apply to every calculator:**
- **Legacy formulas are unchanged.** The 12 original element types, their catalog entries and factors are untouched, and the golden-master tests prove the legacy BOQ is byte-identical.
- **Coefficients are never guessed.** A coefficient that has to come from Fajardo or a product data sheet starts **not set** (null). Any quantity that needs it is left out of the BOQ, and auditor rule R-COEF-003 reports it as critical until a value is entered on the Factors tab.
- **Specified products are priced inside the element** (tiles, roofing sheets, doors, fixtures, pipes, wires…), from your quotation. There are no sample prices. A missing unit cost is reported by R-PRICE-001.
- **New labor and equipment rates start at 0** (source "not set") and are reported by R-PRICE-004.
- **Every calculation records a formula trace**, shown in the element editor.

## Excavation & backfill (`excavation`, division: Earthworks)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Shape |  | pit | one of: Footing pit (rectangular) / Trench (linear) |
| Length (pit length or trench run) | m | 0 | must be > 0 |
| Bottom width (structure width) | m | 0 | must be > 0 |
| Depth | m | 0 | must be > 0 |
| Working space each side | m | 0 | may be 0 |
| Side slope, horizontal per 1 vertical (0 = vertical sides) | H:V | 0 | may be 0 |
| Volume of structure below grade (deducted from backfill) | m³ | 0 | may be 0 |
| Dispose of surplus off site |  | true | yes / no |
| Include excavator (equipment) |  | false | yes / no |

- **Measurement:** Net excavation to the lines of the pit/trench plus working space and side slope. Pit volume uses the prismoidal formula (exact for a pit with plane sloped sides). Trench ends are vertical.
- **Unit conversions:** All inputs in metres; slope as horizontal metres per vertical metre.
- **Net quantity:** Excavation V; backfill = max(0, V − structure volume); surplus = V − backfill (bank measure).
- **Deductions:** Structure volume below grade (entered; not inferred from other elements).
- **Waste:** None (earthwork is measured net).
- **Purchase quantity:** Disposal in loose measure = surplus × (1 + swell %).
- **Materials:** None (fill material, if imported, is a separate item).
- **Labor:** Excavation m³, backfill m³, disposal m³ (loose).
- **Equipment:** Optional excavator, per m³ excavated.
- **Coefficient sources:** Swell % is soil-specific: not set by default.

## Roofing (`roofing`, division: Roofing Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Roof form |  | gable | one of: Gable (2 slopes) / Shed / lean-to (1 slope) |
| Building length along the eave | m | 0 | must be > 0 |
| Building width (eave to eave) | m | 0 | must be > 0 |
| Overhang at eaves and gables | m | 0 | may be 0 |
| Roof pitch | deg | 0 | must be > 0 |
| Sheet description |  |  | text |
| Effective cover width | m | 0 | must be > 0 |
| Unit cost of sheet | ₱/m | 0 | must be > 0 |
| Ridge roll effective length | m | 0 | must be > 0, only when relevant |
| Unit cost of ridge roll | ₱/pc | 0 | must be > 0, only when relevant |
| Waste allowance | % | 0 | may be 0 |
| Purlin spacing along the slope | m | 0 | may be 0 |
| Purlin stock length | m | 6 | must be > 0, only when relevant |
| Unit cost per purlin | ₱/pc | 0 | must be > 0, only when relevant |
| Gutter along eaves |  | false | yes / no |
| Unit cost of gutter | ₱/m | 0 | must be > 0, only when relevant |

- **Measurement:** Roof area on the slope = slopes × (L + 2·overhang) × run × 1/cos(pitch). A uniform pitch is assumed; hips, valleys and dormers are not modelled (enter them as separate items).
- **Unit conversions:** Pitch in degrees → slope factor 1/cos(θ).
- **Net quantity:** Roof area (m²).
- **Deductions:** None (openings in roofs are rare; enter a separate negative-free item if needed).
- **Waste:** Element waste % on sheets, ridge, screws, purlins, gutter.
- **Purchase quantity:** Sheets in metres (cut-to-length: rows × slope length); ridge rolls and purlins in pieces (ceil).
- **Materials:** Sheet, ridge roll, purlins and gutter priced per element (as specified); roofing screws from the price list.
- **Labor:** Roofing installation per m² of roof.
- **Equipment:** None.
- **Coefficient sources:** Cover width, ridge roll length and unit costs from the product; screws per m² not set by default.

## Floor / wall tiles (`tiles`, division: Tile Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Surface |  | floor | one of: Floor (length × width) / Wall (run length × height) |
| Length (floor) or run length (wall) | m | 0 | must be > 0 |
| Width (floor) or height (wall) | m | 0 | must be > 0 |
| Deductions (W x H x count) |  |  | text |
| Tile description |  |  | text |
| Tile width | mm | 0 | must be > 0 |
| Tile length | mm | 0 | must be > 0 |
| Tile thickness | mm | 0 | must be > 0, only when relevant |
| Joint width | mm | 0 | may be 0 |
| Waste allowance | % | 0 | may be 0 |
| Tiles per box (0 = loose) | pcs | 0 | may be 0 |
| Unit cost per tile | ₱/pc | 0 | must be > 0 |
| Tile skirting cut from the same tile |  | false | yes / no |
| Skirting height | mm | 0 | must be > 0, only when relevant |
| Total door widths to deduct from skirting | m | 0 | may be 0, only when relevant |

- **Measurement:** Net tiled area = gross area (L × W, or run × height for walls) − deductions.
- **Unit conversions:** Tile sizes and joints in mm → m (÷1000).
- **Net quantity:** Tiles (net) = net area / ((tw + j)(th + j)/10⁶).
- **Deductions:** Openings entered as W x H x count.
- **Waste:** Element waste % on tiles, adhesive and grout.
- **Purchase quantity:** Tiles rounded up to whole pieces; boxes = ceil(tiles / per box); adhesive in bags; grout in kg.
- **Materials:** Tiles priced per element; adhesive and grout from the price list.
- **Labor:** Tile setting per m² (net); skirting per metre.
- **Equipment:** None.
- **Coefficient sources:** Adhesive kg/m², bag size and grout density not set by default. Grout uses the joint-volume formula.

## Waterproofing (`waterproof`, division: Waterproofing Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Length | m | 0 | must be > 0 |
| Width | m | 0 | must be > 0 |
| Upturn height at walls | m | 0 | may be 0 |
| Upturn length (0 = full perimeter) | m | 0 | may be 0, only when relevant |
| System |  | liquid | one of: Liquid-applied membrane (kg) / Sheet / torch-on membrane (rolls) |
| Product |  |  | text |
| Number of coats | pcs | 0 | must be > 0, only when relevant |
| Package size (kg per pail, or m² per roll) | kg / m² | 0 | must be > 0 |
| Lap allowance (sheet) | % | 0 | may be 0, only when relevant |
| Waste allowance | % | 0 | may be 0 |
| Unit cost per package | ₱ | 0 | must be > 0 |
| Primer |  | false | yes / no |
| Primer package size | L | 0 | must be > 0, only when relevant |
| Unit cost per primer package | ₱ | 0 | must be > 0, only when relevant |

- **Measurement:** Area = L × W + upturn height × upturn length (full perimeter if not given).
- **Unit conversions:** Package sizes: kg per pail (liquid) or m² per roll (sheet).
- **Net quantity:** Area (m²).
- **Deductions:** None.
- **Waste:** Element waste %; sheet also lap %.
- **Purchase quantity:** Pails / rolls / primer packages rounded up.
- **Materials:** Membrane and primer priced per element (as specified).
- **Labor:** Waterproofing per m².
- **Equipment:** None.
- **Coefficient sources:** Consumption per coat and primer L/m² not set by default (product data sheet).

## Painting (`painting`, division: Painting Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Measure |  | wall | one of: Walls (perimeter × height) / Ceiling (length × width) / Area entered directly |
| Perimeter (walls) or length (ceiling) | m | 0 | must be > 0, only when relevant |
| Height (walls) or width (ceiling) | m | 0 | must be > 0, only when relevant |
| Area | m² | 0 | must be > 0, only when relevant |
| Deductions (W x H x count) |  |  | text |
| Product |  |  | text |
| Primer coats | pcs | 0 | may be 0 |
| Finish coats | pcs | 0 | must be > 0 |
| Waste allowance | % | 0 | may be 0 |
| Container size | L | 4 | must be > 0 |
| Unit cost per primer container | ₱ | 0 | must be > 0, only when relevant |
| Unit cost per finish container | ₱ | 0 | must be > 0 |
| Skim coat / putty |  | false | yes / no |
| Putty bag size | kg | 0 | must be > 0, only when relevant |
| Unit cost per putty bag | ₱ | 0 | must be > 0, only when relevant |

- **Measurement:** Net painted area (one face); coats multiply material, not the measured area.
- **Unit conversions:** Coverage m²/L per coat; litres → containers.
- **Net quantity:** Area (m²).
- **Deductions:** Openings W x H x count.
- **Waste:** Element waste % on paint and putty.
- **Purchase quantity:** Containers and bags rounded up.
- **Materials:** Primer, finish and putty priced per element (as specified).
- **Labor:** Painting per m² of surface.
- **Equipment:** None.
- **Coefficient sources:** Coverage and putty consumption not set by default (paint data sheet or Fajardo table).

## Door / window (schedule) (`opening`, division: Doors & Windows)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Type |  | door | one of: Door / Window |
| Description / specification |  |  | text |
| Width | m | 0 | must be > 0 |
| Height | m | 0 | must be > 0 |
| Unit cost per set (supply, as specified) | ₱/set | 0 | must be > 0 |
| Lockset / hardware set |  | false | yes / no |
| Unit cost of lockset | ₱/set | 0 | must be > 0, only when relevant |
| Perimeter sealant |  | false | yes / no |
| Sealed faces |  | 2 | one of: One face / Both faces |
| Sealant length per cartridge | m | 0 | must be > 0, only when relevant |
| Unit cost per cartridge | ₱ | 0 | must be > 0, only when relevant |

- **Measurement:** One set per element (use the element quantity for identical marks).
- **Unit conversions:** None.
- **Net quantity:** Sets; area and perimeter shown for reference.
- **Deductions:** Opening areas are NOT deducted from walls automatically; enter them in the wall element (never inferred).
- **Waste:** None.
- **Purchase quantity:** Sets, locksets and sealant cartridges (ceil).
- **Materials:** Supply priced per set as specified in the schedule.
- **Labor:** Installation per set.
- **Equipment:** None.
- **Coefficient sources:** All prices and sizes from the door & window schedule.

## Structural steel (`steel`, division: Structural Steel Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Item |  | member | one of: Rolled section (unit weight × length) / Plate (L × W × t) |
| Section / designation (as specified) |  |  | text |
| Unit weight (from the steel table) | kg/m | 0 | must be > 0, only when relevant |
| Length per piece | m | 0 | must be > 0, only when relevant |
| Plate length | m | 0 | must be > 0, only when relevant |
| Plate width | m | 0 | must be > 0, only when relevant |
| Plate thickness | mm | 0 | must be > 0, only when relevant |
| Connection allowance | % | 0 | may be 0 |
| Waste allowance | % | 0 | may be 0 |
| Bolts per piece | pcs | 0 | may be 0 |
| Include crane / lifting |  | false | yes / no |
| Crane hours per piece | hr | 0 | must be > 0, only when relevant |

- **Measurement:** Members by unit weight (from the steel table) × length; plates by volume × density.
- **Unit conversions:** Plate thickness mm → m.
- **Net quantity:** kg per piece × element quantity.
- **Deductions:** None (holes and copes are within the connection allowance).
- **Waste:** Connection % and waste % compound.
- **Purchase quantity:** kg; bolts as pieces.
- **Materials:** Steel and bolts from the price list.
- **Labor:** Fabrication and erection per kg (net).
- **Equipment:** Optional crane hours per piece.
- **Coefficient sources:** Unit weights from the section table (entered, never inferred from a drawing); steel density 7850 kg/m³ (physical property).

## Plumbing item (schedule) (`plumbing`, division: Plumbing Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Category |  | fixture | one of: Fixture / Pipe (metres) / Fitting / Valve / Other |
| Description / size |  |  | text |
| Quantity from the plan (pcs, or metres for pipe) | pcs / m | 0 | must be > 0 |
| Pipe stock length | m | 3 | must be > 0, only when relevant |
| Waste allowance | % | 0 | may be 0 |
| Unit cost (per piece; per stock length for pipe) | ₱ | 0 | must be > 0 |

- **Measurement:** Quantities are taken from the plumbing plan or schedule (counted, not designed).
- **Unit conversions:** Metres → packages by pipe stock length.
- **Net quantity:** Quantity as counted.
- **Deductions:** None.
- **Waste:** Element waste %.
- **Purchase quantity:** Pieces or packages rounded up.
- **Materials:** Priced per element (as specified).
- **Labor:** Plumbing installation as a % of this division's materials (rate not set by default).
- **Equipment:** None.
- **Coefficient sources:** All sizes, quantities and prices from the plans and suppliers.

## Electrical item (schedule) (`electrical`, division: Electrical Works)

| Input | Unit | Default | Rule |
|---|---|---|---|
| Category |  | device | one of: Wire / cable (metres) / Conduit (metres) / Device (outlet, switch) / Lighting fixture / Panel / breaker / Other |
| Description / size |  |  | text |
| Quantity from the plan (pcs, or metres for wire/conduit) | pcs / m | 0 | must be > 0 |
| Roll length (wire) or stock length (conduit) | m | 0 | must be > 0, only when relevant |
| Waste allowance | % | 0 | may be 0 |
| Unit cost (per piece, roll or length) | ₱ | 0 | must be > 0 |

- **Measurement:** Quantities are taken from the electrical plan or schedule (counted, not designed).
- **Unit conversions:** Metres → packages by roll or stock length.
- **Net quantity:** Quantity as counted.
- **Deductions:** None.
- **Waste:** Element waste %.
- **Purchase quantity:** Pieces or packages rounded up.
- **Materials:** Priced per element (as specified).
- **Labor:** Electrical installation as a % of this division's materials (rate not set by default).
- **Equipment:** None.
- **Coefficient sources:** All sizes, quantities and prices from the plans and suppliers.

## Coefficients introduced by the calculators

| Path | Default | Source | Starts verified |
|---|---|---|---|
| `earth.swellPct` (Swell (bulking) of excavated soil (%)) | **not set** | Not set – soil-specific (geotechnical report or Fajardo earthwork table) – Increase of excavated soil volume when loosened, % of bank volume. | no |
| `roof.screwsPerSqm` (Roofing screws per m² of roof) | **not set** | Not set – roofing manufacturer installation guide | no |
| `tile.adhesiveKgPerSqm` (Tile adhesive (kg per m²)) | **not set** | Not set – adhesive data sheet or Fajardo tile table | no |
| `tile.adhesiveBagKg` (Tile adhesive bag size (kg)) | **not set** | Not set – adhesive bag size from supplier | no |
| `tile.groutDensity` (Grout density (kg/m³)) | **not set** | Not set – grout data sheet – Used in grout kg = joint volume × density. | no |
| `waterproof.liquidKgPerSqmPerCoat` (Liquid membrane per coat (kg/m²)) | **not set** | Not set – membrane data sheet | no |
| `waterproof.primerLPerSqm` (Waterproofing primer (L/m²)) | **not set** | Not set – primer data sheet | no |
| `paint.primerCoverage` (Primer coverage per coat (m²/L)) | **not set** | Not set – paint data sheet or Fajardo painting table | no |
| `paint.finishCoverage` (Finish paint coverage per coat (m²/L)) | **not set** | Not set – paint data sheet or Fajardo painting table | no |
| `paint.puttyKgPerSqm` (Skim coat / putty (kg/m²)) | **not set** | Not set – skim coat / putty data sheet | no |
| `steel.density` (Steel density (kg/m³)) | 7850 | Physical property: carbon steel 7850 kg/m³ | yes |

## Hand-calculated examples (in-app Self-test and `tests/phase3.test.mjs`)

- PASS – Excavation pit 1.5×1.5×1.5 m, 0.3 m working space, 0.5:1 slope, swell 25%
- PASS – Trench 10 m × 0.6 m × 0.8 m, vertical sides
- PASS – Gable roof 10 × 8 m, 0.6 m overhang, 20°, 0.76 m cover width
- PASS – Floor tiles 4 × 5 m, 600×600×10 mm, 3 mm joint, no waste
- PASS – Wall paint 18 m × 3 m less one 0.9×2.1 door, 2 coats at 25 m²/L, 4 L containers
- PASS – Waterproofing 3 × 4 m with 0.3 m upturn, 2 coats × 1 kg/m², 20 kg pails
- PASS – Steel: plate 0.3 × 0.3 m × 12 mm and W-section 46.1 kg/m × 6 m
- PASS – Door 0.9 × 2.1 m with sealant both faces, 6 m per cartridge
- PASS – Schedules: 230 m wire on 150 m rolls; 25 m pipe on 3 m lengths
- PASS – A missing coefficient omits the item and is reported, never guessed

The coefficient values used in these examples are test inputs, not defaults.
