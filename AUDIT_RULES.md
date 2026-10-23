# Audit Rules (auditor 1.0.0)

Generated from `estimator.html` by `node scripts/make-rules-doc.mjs`. Do not edit by hand.

All rules are deterministic functions of the saved project and the engine's own results. No AI and no clock are used. The caller passes `today`, which only the price-expiry rule reads.

**Severity:**
- **critical:** blocks approval and cannot be acknowledged.
- **major / minor:** can be acknowledged with a name and a reason. An acknowledgement re-opens automatically if the finding's evidence changes.
- **info:** shown for awareness.

**Finding IDs:** `F-` + a 64-bit FNV-1a hash of the rule ID and the finding's cause key (element id, level id, price code…). The ID stays the same while the cause is unchanged.

| Rule | Severity | Title | What is checked |
|---|---|---|---|
| R-DIM-001 | critical | Input is not a finite number | Each numeric input of the element form must be a finite number. |
| R-DIM-002 | critical | Negative dimension or count | Numeric inputs must not be negative. |
| R-DIM-003 | critical | Zero where a positive value is required | Dimensions, spacings and counts must be > 0. Allowed zeros: optional extras (bottom extension, confined zone, cross-ties, anchorage, extra bars, dowel length, waste, longitudinal bars). Fields that do not apply are skipped (e.g. confined-zone spacing when the zone length is 0). |
| R-DIM-004 | major | Element quantity is zero or not a whole number | Element quantity must be a whole number > 0 (the engine rounds it). |
| R-DIM-005 | critical | Openings are as large as or larger than the wall | Wall/partition openings area ≥ L × H makes the net area 0. |
| R-DIM-006 | major | Openings text could not be read | Openings must be written as W x H x count; unreadable parts are not deducted. |
| R-UNIT-001 | major | Value looks like it was entered in the wrong unit | Data-entry plausibility, not a design limit: metres 0.01–100 (section sizes b, h, t, T, B ≤ 3 m); cover 10–150 mm; spacings 25–1000 mm; plaster 5–50 mm. |
| R-QTY-001 | critical | Element produces no quantities | Raised only when no critical input finding already explains it. |
| R-RB-001 | critical | Cover leaves no room for reinforcement | Member dimension − 2 × cover ≤ 0 for the bar directions of the element type. |
| R-RB-002 | major | Bar spacing is larger than the member | Spacing ≥ available width (dimension − 2 × cover), so the count formula gives a single bar. |
| R-RB-003 | critical | Rebar missing from the BOQ | A scheduled diameter has no candidate commercial length longer than its lap (lap factor × d); the engine omits it from the BOQ. |
| R-RB-004 | minor | Confined zone is ignored | Columns/beams: 2 × confined zone ≥ length, so the engine uses uniform spacing. |
| R-PRICE-001 | critical | BOQ material has no price | A material that appears in the BOQ has price ≤ 0 or not a number (the engine costs it at 0). |
| R-PRICE-002 | critical | Sample prices are used | A material in the BOQ still carries the built-in sample price (source "sample"). |
| R-PRICE-003 | major | Price is older than the validity period | A user price/rate in the BOQ is older than the price-validity policy (days). |
| R-PRICE-004 | major | Labor rate is zero | A per-unit labor rate in the BOQ is ≤ 0. |
| R-PRICE-005 | major | Sample labor rates are used | A labor rate in the BOQ is still the sample value. |
| R-PRICE-006 | info | Price date is not recorded | A user price/rate has no recorded date. |
| R-COEF-001 | critical | Unverified estimating coefficients are used | A coefficient read by at least one costed element (see factorsUsed) is not ticked Verified. Severity follows the policy (critical by default). |
| R-COEF-002 | critical | Interpolated coefficient without a source is used | A coefficient whose source is "interpolated" is used (currently the 5" CHB mortar row). |
| R-COEF-003 | critical | Required coefficient is not set |  |
| R-MOD-002 | critical | Inputs cannot produce this item |  |
| R-DUP-001 | major | Possible duplicate elements | Two or more elements with the same type, level and normalised inputs. |
| R-DUP-002 | major | Element mark used more than once | The same mark (case-insensitive) on more than one element. |
| R-OVL-001 | minor | Suspected slab–beam concrete overlap | Beams and slabs on one level. Upper bound = Σ beam b × L × min(max slab t, beam h) × qty. |
| R-OVL-002 | minor | Suspected column–beam concrete overlap | Columns and beams on one level. Upper bound = Σ column b × h × max beam h × qty. |
| R-REC-001 | critical | Quantities and costs do not reconcile | Every BOQ line amount = qty × rate (or % × materials); each subtotal = sum of its lines; division totals and line totals = direct cost; markups = direct × rate; subtotal and VAT and grand total consistent. Tolerance: half a centavo. |
| R-REC-002 | minor | Printed amounts do not add up after rounding | Sum of printed (2-dp) line amounts differs from the printed subtotal by ≥ ₱0.01. |
| R-REC-003 | critical | A total is not a finite number | A total or line amount is NaN or infinite. |
| R-MKP-001 | critical | Invalid markup or VAT | OCM, profit, contingency or VAT outside 0–100 % or not a number. |
| R-MKP-002 | major | Unusual markup or VAT | VAT other than 12 % or 0 %, or a markup above 50 %. |
| R-TO-001 | minor | Level has no elements | A level with no elements. |
| R-TO-002 | major | Drawing takeoff is not complete | In the takeoff register, a level has scopes that are not Complete or Not applicable. |
| R-TO-003 | major | Scope marked complete but has no elements | A scope marked Complete has no elements on that level. |
| R-TO-004 | major | Scope marked not applicable but has elements | A scope marked Not applicable has elements on that level. |
| R-QUA-001 | major | Quarantined elements are not costed | Elements in quarantine (unknown type from a loaded file) are not costed. |
| R-STALE-001 | major | Approved estimate has changed since approval | The input hash (levels, elements, factors, prices, labor, settings) differs from the hash recorded at approval. Provenance notes and audit acknowledgements are not part of the hash. |
| R-STALE-002 | info | Estimate has changed since the last export | The input hash differs from the one recorded at the last export. |

## Export policies
- **draft-watermark**: Watermark every export that is not from an approved, unchanged estimate.
- **watermark-issues-only**: Watermark only when critical or major findings are open.
- **block-critical**: Watermark drafts, and refuse exports while critical findings exist.

Watermarks are added in front of the export body (CSV rows / Excel banner row / printed diagonal watermark and banner). The body itself is unchanged, and the golden-master tests check that it is byte-identical. Text cells starting with `= + - @` are prefixed with `'` so spreadsheets do not execute them.
