// One-time setup (run from the Apps Script editor), web app entry point, and backups.

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Construction Estimator')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID'), ss;
  if (!id) { ss = SpreadsheetApp.create('Construction Estimator – data'); id = ss.getId(); props.setProperty('SPREADSHEET_ID', id); }
  else ss = SpreadsheetApp.openById(id);
  for (const name of Object.keys(CFG.SHEETS)) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(CFG.SHEETS[name]); sh.setFrozenRows(1); }
  }
  if (!props.getProperty('DRIVE_FOLDER_ID')) props.setProperty('DRIVE_FOLDER_ID', DriveApp.createFolder('Construction Estimator – files').getId());
  if (!props.getProperty('BACKUP_FOLDER_ID')) props.setProperty('BACKUP_FOLDER_ID', DriveApp.createFolder('Construction Estimator – backups').getId());
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const admins = listProp_('ADMINS');
  if (me && !admins.includes(me)) props.setProperty('ADMINS', admins.concat(me).join(','));
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyBackup')) ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  return {spreadsheetId: id, admins: listProp_('ADMINS'), driveFolderId: props.getProperty('DRIVE_FOLDER_ID'), backupFolderId: props.getProperty('BACKUP_FOLDER_ID')};
}

// Copy the whole spreadsheet to the backup folder; keep the newest BACKUP_KEEP copies.
function backupNow_() {
  const folder = DriveApp.getFolderById(prop_('BACKUP_FOLDER_ID', ''));
  const copy = DriveApp.getFileById(prop_('SPREADSHEET_ID', '')).makeCopy('Estimator backup ' + iso_(), folder);
  const keep = Math.max(1, Number(prop_('BACKUP_KEEP', '14')) || 14), files = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) files.push(f); }
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  for (const f of files.slice(keep)) f.setTrashed(true);
  return {backupFileId: copy.getId(), kept: Math.min(keep, files.length), trashed: Math.max(0, files.length - keep)};
}
function dailyBackup() {
  const r = backupNow_();
  log_('(daily trigger)', 'backup', '', '', '', 'ok', JSON.stringify(r));
  return r;
}
