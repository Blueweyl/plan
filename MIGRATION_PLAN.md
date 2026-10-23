# Migration Plan: project JSON v1 → v2

**Status: implemented in Phase 1** (`migrate()` in `estimator.html`).

## Goals
1. **Every existing v1 file keeps loading,** with identical quantities and costs.
2. **No silent loss:** anything the new version cannot use is kept, quarantined and reported, never deleted.
3. **Migrations are pure, versioned and tested:** `migrate(raw) → {state, report}`, run in order, never on the original object.

## Current v1 behaviour (baseline, tested)

| Case | v1 behaviour | Test |
|---|---|---|
| Saved v1 file | Loads unchanged | COMPAT-01, -02 |
| Missing `version`, `settings` or `factors` | Defaults filled in | COMPAT-03 |
| Partial price list | Merged; saved prices win | COMPAT-04 |
| Edited factors | Kept; arrays replaced | COMPAT-05 |
| Numbers stored as strings | Converted, same results | COMPAT-06 |
| Element missing a newer field | Field gets its default | COMPAT-07 |
| Unknown element type | **Dropped** | KNOWN-ISSUE A-H03 |
| Element with a missing level | **Kept but not costed** | KNOWN-ISSUE A-C03 |
| Empty `levels` | **New default level; all elements orphaned** | KNOWN-ISSUE A-C03b |
| Corrupt localStorage | **Reset, then overwritten** | KNOWN-ISSUE A-C04 |

## v2 schema additions
```
version: 2
engineVersion: "1.0.0"          // which formulas produced the numbers
meta: { createdAt, updatedAt, appVersion, migratedFrom: 1, migrationReport: [...] }
elements[].source: { kind: "manual" | "ai-suggestion", ... }   // for Phase 7
factors: values unchanged + factorMeta: { "<path>": { source, verified, note } }
prices[code]: + { updatedAt, source }           // Phase 2 "expired price" rule
quarantine: { elements: [...raw], invalidValues: [{path, value, usedInstead}], unknownKeys: {group: {...}} }
meta: + { revision: 0, status: "draft", fileSavedAt, changesSinceFile }
```
**No v1 field is renamed or removed.** v2 only adds fields, so a v2 file opened in a v1 app still calculates. The v1 app drops unknown types, so warn users before they share v2 files with v1 users.

## Migration steps (`migrateV1toV2`)
1. **Parse safely.** If the JSON is invalid, copy the raw text to `estimator.backup.<timestamp>`, show a blocking message, and offer to download it. Never overwrite it.
2. **Validate types.** Every value rendered in the UI is checked: numbers must be finite and ids must match `[A-Za-z0-9_-]+`. Invalid values move to `quarantine.invalidValues` with their path, and defaults are used. This removes the A-H01 XSS vector at load time; Phase 1 also escapes at render time.
3. **Unknown element types** are moved, unchanged, to `quarantine.elements` and reported, not dropped. *(Implemented as a separate list instead of a status flag, so the engine never sees an element it cannot calculate, and the v1 app reads v2 files unchanged — MIG-07.)*
4. **Orphan elements:** create the level `Unassigned (recovered)` and attach them to it. Report each element.
5. **Factors:** keep values unchanged. Add `factorMeta` with every coefficient marked `verified: false, source: null`, except values the user has already changed, which get `source: "user"`. Mark the 5" CHB mortar row `note: "interpolated – no source"`.
6. **Prices:** add `updatedAt: null, source: "sample"` to defaults that were never changed, and `source: "user"` to changed ones.
7. **Set the version:** `version: 2`, `engineVersion: "1.0.0"`, with `meta.migrationReport` listing every change.
8. **Back up before writing.** Before the first v2 write, store the original v1 JSON under `estimator.v1.pre-v2-backup`.

## Migration tests (implemented in Phase 1 — `tests/migration.test.mjs`, all passing)
- **MIG-01** The fixture migrated to v2 gives the same `buildBOQ` totals and the same golden master.
- **MIG-02** Migration is idempotent: migrating v2 again changes nothing.
- **MIG-03** Unknown type → quarantined, reported, and preserved through save and reload.
- **MIG-04** Orphans → `Unassigned (recovered)`; the total includes them; report lists them.
- **MIG-05** Corrupt storage → backup key created, user warned, original text unchanged.
- **MIG-06** Malicious values (the XSS corpus from A-H01) → quarantined; no script runs.
- **MIG-07** A v2 file opened by `original/estimator.v1.html` still calculates (forward compatibility).
- **MIG-08** The pre-v2 backup key exists and holds byte-identical v1 JSON.
- The KNOWN-ISSUE tests A-H03, A-C03, A-C03b and A-C04 are inverted, per TEST_PLAN.md.

## Rollback
The original app is kept as `original/estimator.v1.html`, and the pre-v2 backup key or the user's saved `.estimate.json` restore the v1 data. Because v2 only adds fields (above), v1 can still read v2 files, except for quarantined or unknown types.

## Design file (`.dc.html`)
If its project format differs, a separate `importDesignFile()` adapter will map it to v2 with its own report. It will be specified once the file is available.

## Later additions (still schema v2, additive only)
- **Phase 2:** `audit`, `takeoff`, `meta.projectId`.
- **Phase 3:** module factor groups (unset = `null`).
- **Phase 4:** `laborSetup`, plus labor item fields `crew`, `output`, `crews`, `lump`, `equip`, `eqOutput`, `attach`.
- **Phase 5:** `revisions`, `meta.basedOn`.
- **Phase 6:** `meta.server` (local link to the server copy; stripped by the server before storing).

Each addition is sanitised by `migrate()` and covered by that phase's migration tests. Older files load with defaults, without warnings.
