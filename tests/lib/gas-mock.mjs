// In-memory mock of the Google Apps Script services used by backend/src/*.gs,
// with fault injection, so the server can be tested in Node. Not a full emulator:
// it implements exactly the calls the backend makes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {ROOT} from './engine.mjs';

const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const unsigned = arr => Buffer.from(arr.map(b => b & 0xff));

export function createGas({admin = 'admin@example.com'} = {}) {
  const st = {user: admin, effective: admin, props: {}, ss: new Map(), files: new Map(), folders: new Map(), triggers: [], fail: null, fetch: null, locked: false, n: 0, clock: 0};
  const id = p => p + (++st.n);
  const maybeFail = op => { if (st.fail && st.fail.op === op) { if (st.fail.skip > 0) { st.fail.skip--; return; } st.fail = null; throw new Error('Injected failure: ' + op); } };

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, {sh, r, c, nr, nc}); }
    getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i] || []; out.push(Array.from({length: this.nc}, (_, j) => (row[this.c - 1 + j] ?? ''))); } return out; }
    setValues(v) {
      maybeFail('setValues:' + this.sh.name);
      if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('Range size mismatch');
      v.forEach((row, i) => { const t = this.sh.data[this.r - 1 + i] = this.sh.data[this.r - 1 + i] || []; row.forEach((x, j) => { t[this.c - 1 + j] = cell(x); }); });
      return this;
    }
    getValue() { return this.getValues()[0][0]; }
  }
  const cell = x => { if (typeof x === 'string' && x.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); return x; };
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    getLastRow() { return this.data.length; }
    getRange(r, c, nr = 1, nc = 1) { if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Invalid range'); return new Range(this, r, c, nr, nc); }
    appendRow(v) { maybeFail('appendRow:' + this.name); this.data.push(v.map(cell)); return this; }
    deleteRow(i) { this.data.splice(i - 1, 1); }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(sid, name) { this.id = sid; this.name = name; this.sheets = new Map(); }
    getId() { return this.id; }
    getSheetByName(n) { return this.sheets.get(n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.set(n, s); return s; }
  }
  class Blob {
    constructor(bytes, type, name) { this.bytes = bytes; this.type = type; this.name = name; }
    getBytes() { return this.bytes; } getContentType() { return this.type; } getName() { return this.name; }
  }
  class File {
    constructor(fid, name, blob, folder) { Object.assign(this, {fid, name, blob, folder, trashed: false, created: new Date(Date.now() + (st.clock++))}); }
    getId() { return this.fid; } getName() { return this.name; } getSize() { return this.blob ? this.blob.bytes.length : 0; }
    getDateCreated() { return this.created; } isTrashed() { return this.trashed; } setTrashed(t) { this.trashed = !!t; return this; }
    makeCopy(name, folder) {
      const src = st.ss.get(this.fid), cid = id('ss');
      if (src) { const copy = new Spreadsheet(cid, name); for (const [n, s] of src.sheets) { const c = copy.insertSheet(n); c.data = JSON.parse(JSON.stringify(s.data)); } st.ss.set(cid, copy); }
      const f = new File(cid, name, this.blob, folder); st.files.set(cid, f); folder.files.push(f); return f;
    }
  }
  const iter = list => { let i = 0; return {hasNext: () => i < list.length, next: () => list[i++]}; };
  class Folder {
    constructor(fid, name) { Object.assign(this, {fid, name, files: [], subs: []}); }
    getId() { return this.fid; } getName() { return this.name; }
    createFolder(n) { const f = new Folder(id('fo'), n); st.folders.set(f.fid, f); this.subs.push(f); return f; }
    getFoldersByName(n) { return iter(this.subs.filter(f => f.name === n)); }
    createFile(blob) { const f = new File(id('fi'), blob.getName(), blob, this); st.files.set(f.fid, f); this.files.push(f); return f; }
    getFiles() { return iter(this.files.slice()); }
  }
  const globals = {
    console,
    SpreadsheetApp: {
      create(name) { const s = new Spreadsheet(id('ss'), name); st.ss.set(s.id, s); st.files.set(s.id, new File(s.id, name, null, null)); return s; },
      openById(sid) { const s = st.ss.get(sid); if (!s) throw new Error('Spreadsheet not found: ' + sid); return s; },
    },
    DriveApp: {
      createFolder(n) { const f = new Folder(id('fo'), n); st.folders.set(f.fid, f); return f; },
      getFolderById(fid) { const f = st.folders.get(fid); if (!f) throw new Error('Folder not found'); return f; },
      getFileById(fid) { const f = st.files.get(fid); if (!f) throw new Error('File not found'); return f; },
    },
    LockService: {getScriptLock: () => ({
      tryLock() { if (st.locked) return false; st.locked = true; return true; },
      waitLock() { if (st.locked) throw new Error('Lock timeout'); st.locked = true; },
      releaseLock() { st.locked = false; }, hasLock: () => st.locked,
    })},
    Session: {getActiveUser: () => ({getEmail: () => st.user}), getEffectiveUser: () => ({getEmail: () => st.effective})},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: k => (k in st.props ? st.props[k] : null), setProperty(k, v) { st.props[k] = String(v); return this; },
      getProperties: () => ({...st.props}), deleteProperty(k) { delete st.props[k]; },
    })},
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest(alg, data) { return signed(crypto.createHash(alg).update(typeof data === 'string' ? Buffer.from(data, 'utf8') : unsigned(data)).digest()); },
      getUuid: () => crypto.randomUUID(),
      base64Decode(s) { if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('Could not decode string.'); return signed(Buffer.from(s, 'base64')); },
      newBlob(data, type, name) { return new Blob(typeof data === 'string' ? signed(Buffer.from(data, 'utf8')) : data, type, name); },
    },
    UrlFetchApp: {fetch(url) { const r = st.fetch ? st.fetch(url) : {code: 500, body: ''}; return {getResponseCode: () => r.code, getContentText: () => r.body}; }},
    HtmlService: {
      XFrameOptionsMode: {DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL'},
      createHtmlOutputFromFile(name) {
        const content = fs.readFileSync(path.join(ROOT, 'backend/src', name + '.html'), 'utf8'), meta = {};
        const o = {setTitle: t => (meta.title = t, o), addMetaTag: (k, v) => ((meta[k] = v), o), setXFrameOptionsMode: m => ((meta.xframe = m), o), getContent: () => content, meta};
        return o;
      },
    },
    ScriptApp: {
      getProjectTriggers: () => st.triggers,
      newTrigger(fn) { const b = {timeBased: () => b, everyDays: () => b, atHour: () => b, create() { const t = {getHandlerFunction: () => fn}; st.triggers.push(t); return t; }}; return b; },
    },
    Logger: {log() {}},
  };
  return {globals, st,
    as(user) { st.user = user; return this; },
    sheet(name) { const s = st.ss.get(st.props.SPREADSHEET_ID); return s && s.getSheetByName(name); },
    failNext(op, skip = 0) { st.fail = {op, skip}; }};
}

// Loads the backend (generated Shared.gs + hand-written .gs files) into a fresh VM with the mock.
export function loadBackend(gas) {
  const dir = path.join(ROOT, 'backend/src');
  const order = ['Shared.gs', 'Config.gs', 'Auth.gs', 'Store.gs', 'Api.gs', 'Setup.gs'];
  const src = order.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const ctx = vm.createContext({...gas.globals});
  return vm.runInContext(src + '\n;({api, setup, doGet, dailyBackup, recover_, migrate, buildBOQ, runAudit, inputHashes, snapshotOf, hash64, OPS, CFG})', ctx, {filename: 'backend.gs'});
}
