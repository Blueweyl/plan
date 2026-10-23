# Deployment guide: Google Apps Script server (Phase 6)

The standalone `estimator.html` keeps working offline with no server. This guide sets up the **shared, multi-estimator** version, where projects live in a Google Sheet and drawings and exports live in Google Drive. Everyone signs in with their Google account.

## What is deployed

| File (in `backend/`) | Purpose |
|---|---|
| `appsscript.json` | Manifest: V8 runtime, scopes, web app runs as the deployer. |
| `src/Index.html` | The app page (generated; identical to `estimator.html`). |
| `src/Shared.gs` | The calculation, migration and audit code (generated from `estimator.html`, so the server validates exactly what the browser computes). |
| `src/Config.gs`, `Auth.gs`, `Store.gs`, `Api.gs`, `Setup.gs` | Server: settings, sign-in and roles, Sheets storage, the API, setup and backups. |

Rebuild the generated files after any change to `estimator.html` with `npm run build:backend`. `npm test` fails if they are out of date.

## One-time setup (about 15 minutes)

1. **Create the script.** In Google Drive: **New → More → Google Apps Script**. Name it "Construction Estimator".
2. **Add the files.**
   - In the editor's **Project Settings**, tick **Show "appsscript.json" manifest file** and replace its content with `backend/appsscript.json`.
   - Create script files named `Shared`, `Config`, `Auth`, `Store`, `Api`, `Setup` and paste the matching `.gs` files.
   - Create an HTML file named `Index` and paste `backend/src/Index.html`.
   - With the `clasp` command-line tool instead: `clasp create --type webapp`, copy `backend/appsscript.json` and `backend/src/*` into the clasp folder, then `clasp push`.
3. **Run `setup`.** Select **setup** in the function list, click **Run** and accept the permissions. It:
   - creates the data spreadsheet "Construction Estimator – data" with the sheets Projects, Versions, Members, AuditLog, Requests, Drawings, Elements and Summary
   - creates the Drive folders for files and backups
   - makes **you the first Admin**
   - installs a **daily backup** at 02:00

   It is safe to run again.
4. **Choose who can use it.** Edit `appsscript.json` → `webapp.access`:
   - `DOMAIN` (default): only your Google Workspace domain; users are identified automatically.
   - `ANYONE`: any Google account. Also create an **OAuth client ID** (Google Cloud console → APIs & Services → Credentials → OAuth client ID → Web application; add `https://script.google.com` and `https://*.googleusercontent.com` as authorized JavaScript origins) and set it as the Script Property `CLIENT_ID`. A client ID is public and is not a secret. Users then see a **Sign in with Google** button; the server verifies their token with Google on every call.
5. **Deploy.** Click **Deploy → New deployment → Web app**, execute as **Me**, with the access from step 4, then **Deploy**. Share the web app URL with your team.
6. **Add people.** Open the app, go to **Project & data → Server**, then:
   - create a project on the server
   - under **Members**, add each person as **Estimator** or **Reviewer**

   To let non-admins create projects, set the Script Property `CREATORS` to their e-mails (comma-separated) or `*`.

## Script Properties
| Property | Default | Meaning |
|---|---|---|
| `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `BACKUP_FOLDER_ID` | set by `setup` | Storage locations. |
| `ADMINS` | the person who ran `setup` | Comma-separated admin e-mails. |
| `CREATORS` | (admins only) | Who may create projects; `*` = anyone signed in. |
| `CLIENT_ID` | (none) | OAuth client ID for non-Workspace accounts (step 4). |
| `BACKUP_KEEP` | 14 | Daily backups to keep. |

No API key, token or password is ever put in the HTML. The browser can only call `api()` through `google.script.run`, and every request is authorized on the server.

## Roles
| Action | Estimator | Reviewer | Admin |
|---|---|---|---|
| Open project, view versions, members, drawings, audit log of the project | ✓ | ✓ | ✓ |
| Change quantities, prices, factors, settings; create revisions; upload drawings | ✓ | – | ✓ |
| Comment on revisions | ✓ | ✓ | ✓ |
| Approve / return / revoke revisions (not one you submitted) | – | ✓ | ✓ (may approve own; logged) |
| Create projects | if listed in `CREATORS` | if listed in `CREATORS` | ✓ |
| Members, delete and restore projects, global audit log, backups | – | – | ✓ |

## How the server protects the data
- **Validation.** Every save is checked by the same `migrate()` the browser uses. Invalid or unknown data is **rejected with a report**, never silently fixed. Totals are recomputed on the server.
- **Optimistic concurrency.** A save names the version it was based on. If someone saved in between, the save is refused (`CONFLICT`) and the app shows what differs. You either take the server version (your copy is backed up locally) or explicitly save yours as the next version. Earlier versions are always kept.
- **Atomic commits.** A version is written as chunks, then committed by one update of the project row. A failure before the commit leaves the previous version current, and the half-written chunks are removed on the next write.
- **Idempotent saves.** Every change carries a request id. Re-sending it, for example with "Retry save" after a lost connection, returns the original result and never creates a second version.
- **Revisions.**
  - History cannot be changed or removed, and comments and status logs can only be added to.
  - Names and times are stamped by the server.
  - Revision results are recomputed from their snapshot.
  - Approval requires a Reviewer or Admin, is refused for your own submission, and is refused while critical findings exist.
- **Audit log.** Every change, replay and refusal is logged with user, time and request id: the **AuditLog** sheet, or **Server → Audit log** in the app.
- **Soft delete.** Admins can delete a project and restore it; nothing is erased.
- **Save confirmation.** The server returns the SHA-256 of what it stored and its own computed total. The browser checks both and shows **Server vN ✓**.

## Backups and recovery
- **Daily copies.** Every day the whole spreadsheet is copied to the backup folder, keeping `BACKUP_KEEP` copies. Admins can also click **Back up now**.
- **Restore one project's old state.** Every saved version is kept in the Versions sheet. For approved estimates, use the app's **Revisions** tab, or ask an admin to open a backup copy.
- **Restore everything.** Open the backup spreadsheet, check it, then set the Script Property `SPREADSHEET_ID` to its id. Keep the damaged one for investigation.

## Limits (Apps Script quotas apply)
| Limit | Value |
|---|---|
| Project size | 5 MB of JSON per save |
| Drawing size | 20 MB per PDF |
| Script run time | 6 minutes per call |
| Concurrent writes | serialised by a script lock; a busy server answers `BUSY` and the app offers a retry |

Reads scan whole sheets, which is fine for hundreds of projects. For thousands, archive old projects or move the storage to a database.

## Testing without Google
`npm test` runs the real server code against an in-memory mock of Sheets, Drive, Lock, Session and Utilities (`tests/lib/gas-mock.mjs`). It also runs the app in Chromium connected to that server (`tests/phase6-online.test.mjs`). The mock implements exactly the calls the server makes. **It is not Google**, so after deploying, run the manual checklist in `TEST_PLAN.md` once against your real deployment.
