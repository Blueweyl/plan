// Sheets storage. Each saved version of a project is written as JSON chunks to the
// Versions sheet first; the version becomes current only when the single Projects row is
// updated (the commit). A failure before the commit leaves the previous version current;
// recover_() removes the orphaned chunks on the next write.

function ss_() {
  const id = prop_('SPREADSHEET_ID', '');
  if (!id) throw new ApiError('NOT_CONFIGURED', 'The server is not set up yet. An administrator must run setup().');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new ApiError('NOT_CONFIGURED', `Sheet "${name}" is missing. An administrator must run setup().`);
  return sh;
}
function rows_(name) {
  const sh = sheet_(name), n = sh.getLastRow(), cols = CFG.SHEETS[name];
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, cols.length).getValues().map((v, i) => {
    const o = {_row: i + 2};
    cols.forEach((h, j) => { o[h] = v[j]; });
    return o;
  });
}
const toRow_ = (name, obj) => CFG.SHEETS[name].map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
function append_(name, obj) { sheet_(name).appendRow(toRow_(name, obj)); }
function appendMany_(name, list) {
  if (!list.length) return;
  const sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, list.length, CFG.SHEETS[name].length).setValues(list.map(o => toRow_(name, o)));
}
function update_(name, row, obj) { sheet_(name).getRange(row, 1, 1, CFG.SHEETS[name].length).setValues([toRow_(name, obj)]); }
const projectRow_ = id => rows_('Projects').find(r => r.projectId === id) || null;

function writeVersion_(projectId, version, text, user, requestId) {
  const n = Math.max(1, Math.ceil(text.length / CFG.CHUNK)), at = iso_(), sha = sha256_(text), list = [];
  for (let i = 0; i < n; i++) list.push({projectId, version, chunkIndex: i, chunkCount: n, data: 'J:' + text.slice(i * CFG.CHUNK, (i + 1) * CFG.CHUNK), savedAt: at, savedBy: user, sha256: sha, requestId});
  appendMany_('Versions', list);     // the 'J:' prefix keeps Sheets from reading a chunk as a number, date or formula
  return {sha, at};
}
function readVersion_(projectId, version) {
  const parts = rows_('Versions').filter(r => r.projectId === projectId && Number(r.version) === Number(version)).sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (!parts.length) throw new ApiError('NOT_FOUND', `Version ${version} of this project was not found.`);
  const n = Number(parts[0].chunkCount);
  if (parts.length !== n || parts.some((p, i) => Number(p.chunkIndex) !== i)) throw new ApiError('CORRUPT', `Version ${version} is incomplete in storage.`);
  if (parts.some(p => String(p.data).slice(0, 2) !== 'J:')) throw new ApiError('CORRUPT', `Version ${version} has a malformed chunk.`);
  const text = parts.map(p => String(p.data).slice(2)).join('');
  if (sha256_(text) !== parts[0].sha256) throw new ApiError('CORRUPT', `Version ${version} failed its checksum.`);
  return {text, sha: parts[0].sha256, savedAt: parts[0].savedAt, savedBy: parts[0].savedBy};
}
// Remove chunks of versions that were never committed (write interrupted before the commit)
function recover_() {
  const current = new Map(rows_('Projects').map(p => [p.projectId, Number(p.currentVersion)]));
  const orphans = rows_('Versions').filter(r => !current.has(r.projectId) || Number(r.version) > current.get(r.projectId)).map(r => r._row);
  const sh = sheet_('Versions');
  for (const row of orphans.sort((a, b) => b - a)) sh.deleteRow(row);
  return orphans.length;
}
function log_(user, op, projectId, version, requestId, result, details) {
  append_('AuditLog', {at: iso_(), user, op, projectId: projectId || '', version: version || '', requestId: requestId || '', result, details: String(details || '').slice(0, 2000)});
}
function page_(items, args) {
  const size = Math.min(CFG.PAGE_MAX, Math.max(1, Math.floor(Number(args.pageSize) || CFG.PAGE_DEFAULT)));
  const start = args.pageToken ? Number(args.pageToken) : 0;
  if (!Number.isInteger(start) || start < 0 || start > items.length) throw new ApiError('BAD_REQUEST', 'Invalid page token.');
  const end = start + size;
  return {items: items.slice(start, end), nextPageToken: end < items.length ? String(end) : null, total: items.length};
}
function projectFolder_(projectId, sub) {
  const root = DriveApp.getFolderById(prop_('DRIVE_FOLDER_ID', ''));
  const get = (parent, name) => { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); };
  const p = get(root, projectId);
  return sub ? get(p, sub) : p;
}
// Reporting copies (regenerated per version; not used to rebuild projects)
function writeDerived_(projectId, version, state) {
  const lv = new Map(state.levels.map(l => [l.id, l.name]));
  appendMany_('Elements', state.elements.map(e => ({projectId, version, elementId: e.id, mark: e.mark, type: e.type, level: lv.get(e.level) || '', qty: e.qty})));
  appendMany_('Summary', buildBOQ(state).divTotals.map(d => ({projectId, version, division: d.name, amount: Math.round(d.amt * 100) / 100})));
}
