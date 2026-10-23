// Construction Estimator – Google Apps Script backend: configuration.
// All settings live in Script Properties (File → Project properties → Script properties):
//   SPREADSHEET_ID   created by setup()
//   DRIVE_FOLDER_ID  created by setup() (drawings and exports, one sub-folder per project)
//   BACKUP_FOLDER_ID created by setup()
//   ADMINS           comma-separated e-mails; setup() adds the person who runs it
//   CREATORS         comma-separated e-mails allowed to create projects, or * for any signed-in user (default: admins only)
//   CLIENT_ID        optional OAuth client ID (public, not a secret) for Google sign-in outside your Workspace domain
//   BACKUP_KEEP      number of daily backups to keep (default 14)
// No secret is stored in the HTML; the browser only ever calls api() through google.script.run.

const CFG = {
  SHEETS: {
    Projects: ['projectId', 'name', 'currentVersion', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deleted', 'deletedAt', 'deletedBy', 'sha256', 'grandTotal'],
    Versions: ['projectId', 'version', 'chunkIndex', 'chunkCount', 'data', 'savedAt', 'savedBy', 'sha256', 'requestId'],
    Members: ['projectId', 'email', 'role', 'addedAt', 'addedBy'],
    AuditLog: ['at', 'user', 'op', 'projectId', 'version', 'requestId', 'result', 'details'],
    Requests: ['requestId', 'user', 'op', 'at', 'response'],
    Drawings: ['drawingId', 'projectId', 'name', 'mimeType', 'bytes', 'driveFileId', 'sha256', 'uploadedAt', 'uploadedBy', 'deleted'],
    Elements: ['projectId', 'version', 'elementId', 'mark', 'type', 'level', 'qty'],
    Summary: ['projectId', 'version', 'division', 'amount'],
  },
  CHUNK: 45000,                       // characters per cell (Sheets limit is 50,000)
  MAX_PROJECT_CHARS: 5 * 1024 * 1024,
  MAX_DRAWING_BYTES: 20 * 1024 * 1024,
  MAX_EXPORT_CHARS: 5 * 1024 * 1024,
  LOCK_MS: 30000,
  PAGE_DEFAULT: 20,
  PAGE_MAX: 100,
  ROLES: ['estimator', 'reviewer'],
};

class ApiError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.extra = extra || {}; }
}
function prop_(key, dflt) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === undefined || v === '' ? dflt : v;
}
const iso_ = () => new Date().toISOString();
function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function sha256Bytes_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
