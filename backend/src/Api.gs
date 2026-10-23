// Single entry point for the browser: google.script.run.api({op, args, requestId, idToken}).
// Every write runs under the script lock, is idempotent by requestId, is validated with the
// same migrate()/buildBOQ()/runAudit() code as the browser, and is written to the audit log.

function api(req) {
  let user = '', op = req && req.op;
  const args = (req && req.args && typeof req.args === 'object') ? req.args : {};
  try {
    if (!req || typeof req !== 'object') throw new ApiError('BAD_REQUEST', 'Malformed request.');
    user = currentUser_(req);
    const fn = typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;   // own operations only (never 'constructor', '__proto__', …)
    if (typeof fn !== 'function') throw new ApiError('BAD_REQUEST', 'Unknown operation.');
    let out;
    if (fn.write) {
      const rid = String(req.requestId || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(rid)) throw new ApiError('BAD_REQUEST', 'A requestId is required for changes.');
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(CFG.LOCK_MS)) throw new ApiError('BUSY', 'The server is busy. Try again in a moment.');
      try {
        recover_();
        const prev = rows_('Requests').find(r => r.requestId === rid);
        if (prev) {
          if (prev.user !== user || prev.op !== op) throw new ApiError('BAD_REQUEST', 'This requestId was already used for a different request.');
          out = JSON.parse(prev.response);
          if (out.projectId && out.version && fn.returnsProject) out.project = readVersion_(out.projectId, out.version).text;
          out.replayed = true;
        } else {
          out = fn(user, args, rid);
          const stored = Object.assign({}, out); delete stored.project;
          append_('Requests', {requestId: rid, user, op, at: iso_(), response: JSON.stringify(stored)});
        }
      } finally { lock.releaseLock(); }
      log_(user, op, out.projectId || args.projectId, out.version, rid, out.replayed ? 'replayed' : 'ok', fn.detail ? fn.detail(args, out) : '');
    } else {
      out = fn(user, args);
      if (fn.logged) log_(user, op, args.projectId, out.version, '', 'ok', '');
    }
    return {ok: true, result: out};
  } catch (e) {
    const known = e instanceof ApiError;
    const error = known ? Object.assign({code: e.code, message: e.message}, e.extra) : {code: 'INTERNAL', message: 'Unexpected server error. It has been logged.'};
    try { log_(user || '(not signed in)', op || '?', args.projectId, '', req && req.requestId, error.code, known ? e.message : String((e && e.stack) || e)); } catch (x) { /* logging must never mask the error */ }
    return {ok: false, error};
  }
}

// ---- Validation of an incoming project (server-side; nothing is stored silently "fixed")
function parseProject_(text) {
  if (typeof text !== 'string') throw new ApiError('INVALID', 'The project must be sent as JSON text.');
  if (text.length > CFG.MAX_PROJECT_CHARS) throw new ApiError('TOO_LARGE', 'The project is larger than the server limit.');
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new ApiError('INVALID', 'The project is not valid JSON.'); }
  const {state, report} = migrate(raw);
  const problems = report.filter(r => r.level !== 'info');
  if (problems.length) throw new ApiError('INVALID', 'The project contains invalid or unknown data. Nothing was saved.', {report: problems.slice(0, 50)});
  return state;
}
// Revisions: history is immutable, logs are append-only, identities and times are stamped by the server,
// results are recomputed from the snapshot, and status changes follow the role rules.
function checkRevisions_(prev, next, user, role) {
  const now = iso_(), P = prev ? prev.revisions : [], N = next.revisions;
  const same = (a, b) => canon(a) === canon(b);
  const reviewer = role === 'reviewer' || role === 'admin', estimator = role === 'estimator' || role === 'admin';
  const becameApproved = [];
  for (const p of P) {
    const n = N.find(r => r.no === p.no);
    if (!n) throw new ApiError('IMMUTABLE', `Revision ${p.no} cannot be removed.`);
    for (const k of ['id', 'snapshot', 'snapshotHash', 'createdAt', 'createdBy', 'description', 'basedOn']) if (!same(n[k], p[k])) throw new ApiError('IMMUTABLE', `Revision ${p.no} cannot be changed (${k}).`);
    for (const k of ['results', 'versions', 'audit']) if (!same(n[k], p[k])) throw new ApiError('IMMUTABLE', `Revision ${p.no} cannot be changed (${k}).`);
    for (const k of ['comments', 'statusLog']) {
      if (n[k].length < p[k].length || p[k].some((x, i) => !same(x, n[k][i]))) throw new ApiError('IMMUTABLE', `Revision ${p.no}: ${k} can only be added to.`);
      for (const x of n[k].slice(p[k].length)) { x.by = user; x.at = now; }
    }
    if (n.comments.length > p.comments.length && !role) throw new ApiError('FORBIDDEN', 'Only project members can comment.');
    if (n.status !== p.status) {
      const t = p.status + '>' + n.status;
      if (t === 'submitted>approved') becameApproved.push(n);
      else if (t === 'submitted>draft' || t === 'approved>draft') { if (!reviewer) throw new ApiError('FORBIDDEN', 'Only a reviewer can return or revoke a revision.'); }
      else if (t !== 'approved>superseded') throw new ApiError('INVALID', `Revision ${p.no} cannot go from ${p.status} to ${n.status}.`);
      if (n.statusLog.length === p.statusLog.length) throw new ApiError('INVALID', `Revision ${p.no}: a status change must be recorded in its history.`);
    }
    if (!same(n.approval, p.approval) && !(n.status === 'approved' && p.status === 'submitted')) throw new ApiError('IMMUTABLE', `Revision ${p.no}: the approval record cannot be changed.`);
  }
  for (const n of N.filter(r => !P.some(p => p.no === r.no))) {
    if (!estimator) throw new ApiError('FORBIDDEN', 'Only an estimator can create revisions.');
    if (!revisionIntact(n)) throw new ApiError('INVALID', `Revision ${n.no}: the snapshot does not match its hash.`);
    if (n.no <= Math.max(0, ...P.map(r => r.no))) throw new ApiError('INVALID', `Revision ${n.no}: revision numbers must increase.`);
    const b = buildBOQ(migrate(JSON.parse(n.snapshot)).state);
    if (Math.abs(b.totals.grand - n.results.totals.grand) > 0.005 || b.rows.length !== n.results.rows.length) throw new ApiError('INVALID', `Revision ${n.no}: the stored results do not match its snapshot.`);
    n.createdBy = user; n.createdAt = now;
    for (const x of n.statusLog) { x.by = user; x.at = now; }
    n.comments.forEach(c => { c.by = user; c.at = now; });
    if (n.status === 'approved') becameApproved.push(n);
    else if (n.status !== 'submitted') throw new ApiError('INVALID', `Revision ${n.no}: a new revision must be submitted first.`);
  }
  for (const n of becameApproved) {
    if (!reviewer) throw new ApiError('FORBIDDEN', 'Only a reviewer can approve a revision.');
    if (role !== 'admin' && n.createdBy === user) throw new ApiError('FORBIDDEN', 'You cannot approve a revision you submitted.');
    const au = runAudit(migrate(JSON.parse(n.snapshot)).state, {today: now.slice(0, 10)});
    if (au.blocking.length) throw new ApiError('BLOCKED', `Revision ${n.no} has ${au.blocking.length} critical finding(s) and cannot be approved.`);
    n.approval = {at: now, by: user};
  }
  const superseded = P.filter(p => p.status === 'approved' && (N.find(r => r.no === p.no) || {}).status === 'superseded');
  if (superseded.length && !becameApproved.length) throw new ApiError('INVALID', 'A revision can only be superseded by approving another one.');
  const approved = N.filter(r => r.status === 'approved');
  if (approved.length > 1) throw new ApiError('INVALID', 'Only one revision can be approved at a time; the previous one must be superseded.');
  const a = next.audit && next.audit.approval;
  if (a) {
    const r = N.find(x => x.no === a.revisionNo && x.status === 'approved');
    if (!r) throw new ApiError('INVALID', 'The approval does not refer to an approved revision.');
    a.by = r.approval.by; a.at = r.approval.at; a.hashes = r.results.hashes;
  } else if (approved.length && prev && prev.audit && prev.audit.approval && approved[0].no === prev.audit.approval.revisionNo) {
    throw new ApiError('INVALID', 'Use "Revoke approval" to remove an approval.');
  }
}

// Reporting copies are regenerable; their failure must not undo or fail a committed save.
function derivedSafe_(projectId, version, state, user, rid) {
  try { writeDerived_(projectId, version, state); } catch (e) { log_(user, 'derived', projectId, version, rid, 'warning', 'Reporting rows not written: ' + String(e && e.message || e)); }
}

// ---- Operations
const OPS = {
  whoami(user) {
    const mine = rows_('Members').filter(m => m.email === user).map(m => ({projectId: m.projectId, role: m.role}));
    return {email: user, admin: isAdmin_(user), canCreate: canCreate_(user), memberships: mine};
  },
  config() { return {clientId: prop_('CLIENT_ID', ''), limits: {maxProjectChars: CFG.MAX_PROJECT_CHARS, maxDrawingBytes: CFG.MAX_DRAWING_BYTES}}; },
  listProjects(user, args) {
    const admin = isAdmin_(user), roles = new Map(rows_('Members').filter(m => m.email === user).map(m => [m.projectId, m.role]));
    const items = rows_('Projects').filter(p => (admin || roles.has(p.projectId)) && (!p.deleted || (admin && args.includeDeleted)))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(p => ({projectId: p.projectId, name: p.name, currentVersion: Number(p.currentVersion), updatedAt: p.updatedAt, updatedBy: p.updatedBy, grandTotal: Number(p.grandTotal), deleted: !!p.deleted, role: admin ? 'admin' : roles.get(p.projectId)}));
    return page_(items, args);
  },
  getProject(user, args) {
    const p = projectRow_(String(args.projectId || ''));
    if (!p) throw new ApiError('NOT_FOUND', 'Project not found.');
    const role = requireRole_(user, p.projectId, ['estimator', 'reviewer']);
    if (p.deleted && role !== 'admin') throw new ApiError('NOT_FOUND', 'Project not found.');
    const version = args.version ? Number(args.version) : Number(p.currentVersion);
    if (!(version >= 1 && version <= Number(p.currentVersion))) throw new ApiError('NOT_FOUND', 'Version not found.');
    const v = readVersion_(p.projectId, version);
    return {projectId: p.projectId, version, currentVersion: Number(p.currentVersion), project: v.text, sha256: v.sha, savedAt: v.savedAt, savedBy: v.savedBy, role, deleted: !!p.deleted};
  },
  listVersions(user, args) {
    const p = projectRow_(String(args.projectId || ''));
    if (!p) throw new ApiError('NOT_FOUND', 'Project not found.');
    requireRole_(user, p.projectId, ['estimator', 'reviewer']);
    const list = rows_('Versions').filter(r => r.projectId === p.projectId && Number(r.chunkIndex) === 0 && Number(r.version) <= Number(p.currentVersion))
      .map(r => ({version: Number(r.version), savedAt: r.savedAt, savedBy: r.savedBy, sha256: r.sha256})).sort((a, b) => b.version - a.version);
    return page_(list, args);
  },
  listMembers(user, args) {
    requireRole_(user, String(args.projectId || ''), ['estimator', 'reviewer']);
    return {items: rows_('Members').filter(m => m.projectId === args.projectId).map(m => ({email: m.email, role: m.role, addedAt: m.addedAt, addedBy: m.addedBy}))};
  },
  listAudit(user, args) {
    const pid = args.projectId ? String(args.projectId) : '';
    if (!pid) requireAdmin_(user); else requireRole_(user, pid, ['estimator', 'reviewer']);
    const items = rows_('AuditLog').filter(r => !pid || r.projectId === pid).reverse().map(r => ({at: r.at, user: r.user, op: r.op, projectId: r.projectId, version: r.version, requestId: r.requestId, result: r.result, details: r.details}));
    return page_(items, args);
  },
  listDrawings(user, args) {
    requireRole_(user, String(args.projectId || ''), ['estimator', 'reviewer']);
    return {items: rows_('Drawings').filter(d => d.projectId === args.projectId && !d.deleted).map(d => ({drawingId: d.drawingId, name: d.name, bytes: Number(d.bytes), sha256: d.sha256, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, driveFileId: d.driveFileId}))};
  },

  createProject(user, args, rid) {
    if (!canCreate_(user)) throw new ApiError('FORBIDDEN', 'You are not allowed to create projects.');
    const state = parseProject_(args.project);
    if (state.revisions.length) throw new ApiError('INVALID', 'A new project cannot carry revisions; create them after it is on the server.');
    const projectId = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), now = iso_();
    state.meta.server = undefined;
    const text = JSON.stringify(state), {sha} = writeVersion_(projectId, 1, text, user, rid);
    const grand = buildBOQ(state).totals.grand;
    append_('Projects', {projectId, name: state.project.name, currentVersion: 1, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user, deleted: false, sha256: sha, grandTotal: grand});
    if (!isAdmin_(user)) append_('Members', {projectId, email: user, role: 'estimator', addedAt: now, addedBy: user});
    derivedSafe_(projectId, 1, state, user, rid);
    return {projectId, version: 1, sha256: sha, grandTotal: grand, savedAt: now, project: text};
  },
  saveProject(user, args, rid) {
    const p = projectRow_(String(args.projectId || ''));
    if (!p || p.deleted) throw new ApiError('NOT_FOUND', 'Project not found.');
    const role = requireRole_(user, p.projectId, ['estimator', 'reviewer']);
    const current = Number(p.currentVersion);
    if (Number(args.baseVersion) !== current) {
      const v = readVersion_(p.projectId, current);
      throw new ApiError('CONFLICT', `Someone else saved version ${current} after you opened version ${args.baseVersion}.`, {currentVersion: current, savedBy: v.savedBy, savedAt: v.savedAt});
    }
    const next = parseProject_(args.project), prev = parseProject_(readVersion_(p.projectId, current).text);
    if (inputHashes(next).all !== inputHashes(prev).all && role === 'reviewer') throw new ApiError('FORBIDDEN', 'A reviewer cannot change quantities, prices or settings.');
    checkRevisions_(prev, next, user, role);
    next.meta.server = undefined;
    const version = current + 1, text = JSON.stringify(next), {sha, at} = writeVersion_(p.projectId, version, text, user, rid);
    const grand = buildBOQ(next).totals.grand;
    update_('Projects', p._row, Object.assign({}, p, {name: next.project.name, currentVersion: version, updatedAt: at, updatedBy: user, sha256: sha, grandTotal: grand}));   // commit
    derivedSafe_(p.projectId, version, next, user, rid);
    return {projectId: p.projectId, version, sha256: sha, grandTotal: grand, savedAt: at, project: text};
  },
  deleteProject(user, args) {
    requireAdmin_(user);
    const p = projectRow_(String(args.projectId || '')); if (!p) throw new ApiError('NOT_FOUND', 'Project not found.');
    if (p.deleted) return {projectId: p.projectId, deleted: true};
    update_('Projects', p._row, Object.assign({}, p, {deleted: true, deletedAt: iso_(), deletedBy: user}));
    return {projectId: p.projectId, deleted: true};
  },
  restoreProject(user, args) {
    requireAdmin_(user);
    const p = projectRow_(String(args.projectId || '')); if (!p) throw new ApiError('NOT_FOUND', 'Project not found.');
    update_('Projects', p._row, Object.assign({}, p, {deleted: false, deletedAt: '', deletedBy: ''}));
    return {projectId: p.projectId, deleted: false};
  },
  setMember(user, args) {
    requireAdmin_(user);
    const pid = String(args.projectId || ''), email = String(args.email || '').trim().toLowerCase(), role = args.role;
    if (!projectRow_(pid)) throw new ApiError('NOT_FOUND', 'Project not found.');
    if (!EMAIL.test(email)) throw new ApiError('INVALID', 'Enter a valid e-mail address.');
    if (role !== null && !CFG.ROLES.includes(role)) throw new ApiError('INVALID', 'Role must be estimator, reviewer, or none.');
    const ex = rows_('Members').find(m => m.projectId === pid && m.email === email);
    if (ex) sheet_('Members').deleteRow(ex._row);
    if (role) append_('Members', {projectId: pid, email, role, addedAt: iso_(), addedBy: user});
    return {projectId: pid, email, role};
  },
  uploadDrawing(user, args, rid) {
    const pid = String(args.projectId || '');
    const p = projectRow_(pid); if (!p || p.deleted) throw new ApiError('NOT_FOUND', 'Project not found.');
    requireRole_(user, pid, ['estimator']);
    if (args.mimeType !== 'application/pdf') throw new ApiError('INVALID', 'Only PDF drawings are accepted.');
    if (typeof args.base64 !== 'string' || args.base64.length > CFG.MAX_DRAWING_BYTES * 1.4) throw new ApiError('TOO_LARGE', 'The drawing is larger than the server limit.');
    let bytes;
    try { bytes = Utilities.base64Decode(args.base64); } catch (e) { throw new ApiError('INVALID', 'The file could not be decoded.'); }
    if (bytes.length > CFG.MAX_DRAWING_BYTES) throw new ApiError('TOO_LARGE', 'The drawing is larger than the server limit.');
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) throw new ApiError('INVALID', 'The file is not a PDF.');
    const name = String(args.name || 'drawing.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'drawing.pdf';
    const file = projectFolder_(pid, 'drawings').createFile(Utilities.newBlob(bytes, 'application/pdf', name));
    const rec = {drawingId: 'd' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), projectId: pid, name, mimeType: 'application/pdf', bytes: bytes.length, driveFileId: file.getId(), sha256: sha256Bytes_(bytes), uploadedAt: iso_(), uploadedBy: user, deleted: false};
    append_('Drawings', rec);
    return Object.assign({projectId: pid}, rec);
  },
  saveExport(user, args) {
    const pid = String(args.projectId || '');
    const p = projectRow_(pid); if (!p || p.deleted) throw new ApiError('NOT_FOUND', 'Project not found.');
    requireRole_(user, pid, ['estimator', 'reviewer']);
    if (typeof args.content !== 'string' || args.content.length > CFG.MAX_EXPORT_CHARS) throw new ApiError('INVALID', 'Export content is missing or too large.');
    const name = String(args.name || 'export.csv').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);
    const file = projectFolder_(pid, 'exports').createFile(Utilities.newBlob(args.content, 'text/csv', name));
    return {projectId: pid, driveFileId: file.getId(), name};
  },
  runBackup(user) { requireAdmin_(user); return backupNow_(); },
};
for (const k of ['createProject', 'saveProject', 'deleteProject', 'restoreProject', 'setMember', 'uploadDrawing', 'saveExport', 'runBackup']) OPS[k].write = true;
OPS.createProject.returnsProject = OPS.saveProject.returnsProject = true;
OPS.getProject.logged = true;
OPS.saveProject.detail = (a, o) => `base ${a.baseVersion} → ${o.version}`;
OPS.setMember.detail = a => `${a.email}: ${a.role || 'removed'}`;
OPS.uploadDrawing.detail = (a, o) => `${o.name} (${o.bytes} bytes)`;
