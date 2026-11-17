// A small Google Apps Script emulator that runs backend/Code.gs unchanged, for tests and
// for `npm run dev` (local sync without a Google account). It mimics the Sheets behaviour
// the backend relies on: header rows, getLastRow, fixed sheet size (getRange past the
// last row throws), and Sheets turning number- or date-looking text into numbers and
// dates unless the cell is formatted as plain text ('@').

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const CODE_PATH = new URL('../backend/Code.gs', import.meta.url);

function coerce(value, isText) {
  if (typeof value !== 'string' || isText) return value;
  if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return value;
}

const stats = { cellsRead: 0 };

class Sheet {
  constructor(name) {
    this.name = name;
    this.rows = []; // sparse: rows[r-1][c-1]
    this.maxRows = 1000;
    this.frozenRows = 0;
    this.textCells = new Set(); // "r:c"
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) {
      const row = this.rows[r - 1];
      if (row && row.some((v) => v !== '' && v != null)) return r;
    }
    return 0;
  }
  insertRowsAfter(after, n) {
    if (after > this.maxRows) throw new Error('insertRowsAfter: position out of range');
    // Rows are only appended at the end in the backend, so this just grows the sheet.
    if (after !== this.maxRows) throw new Error('mock only supports inserting at the end');
    this.maxRows += n;
    return this;
  }
  setFrozenRows(n) {
    this.frozenRows = n;
    return this;
  }
  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row ? row.length : 0), 0);
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteRows(r, n) {
    if (this.maxRows - n <= this.frozenRows) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    this.rows.splice(r - 1, n);
    const shifted = new Set();
    for (const key of this.textCells) {
      const [row, col] = key.split(':').map(Number);
      if (row < r) shifted.add(key);
      else if (row >= r + n) shifted.add(`${row - n}:${col}`);
    }
    this.textCells = shifted;
    this.maxRows -= n;
    return this;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error('The starting row/column of the range is too small.');
    if (row + numRows - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, row, col, numRows, numCols);
  }
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValue() {
    return this.getValues()[0][0];
  }
  getValues() {
    stats.cellsRead += this.numRows * this.numCols;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = this.sheet.rows[this.row + r - 1] || [];
      const vals = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = row[this.col + c - 1];
        vals.push(v == null ? '' : v);
      }
      out.push(vals);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((v) => v.length !== this.numCols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.row + r - 1;
      this.sheet.rows[rowIdx] = this.sheet.rows[rowIdx] || [];
      for (let c = 0; c < this.numCols; c++) {
        const isText = this.sheet.textCells.has(`${this.row + r}:${this.col + c}`);
        const v = values[r][c];
        if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        this.sheet.rows[rowIdx][this.col + c - 1] = coerce(v, isText);
      }
    }
    return this;
  }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        const key = `${this.row + r}:${this.col + c}`;
        if (fmt === '@') this.sheet.textCells.add(key);
        else this.sheet.textCells.delete(key);
      }
    }
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const row = this.sheet.rows[this.row + r - 1];
      if (!row) continue;
      for (let c = 0; c < this.numCols; c++) row[this.col + c - 1] = '';
    }
    return this;
  }
}

export function createMockGas({ now = () => Date.now(), today } = {}) {
  stats.cellsRead = 0;
  const sheets = new Map();
  const props = new Map();
  const mails = [];
  const triggers = [];
  let lockHeld = false;

  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      if (sheets.has(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
      const sh = new Sheet(name);
      sheets.set(name, sh);
      return sh;
    },
  };

  const pad = (n) => String(n).padStart(2, '0');

  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (lockHeld) throw new Error('Lock timeout');
          lockHeld = true;
        },
        releaseLock: () => { lockHeld = false; },
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => [...createHash(alg).update(String(text), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (date, tz, fmt) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error('mock formatDate supports yyyy-MM-dd only');
        // Lets tests pin "today" for the reminder job without faking every Date.
        if (today && Math.abs(date.getTime() - now()) < 1000) return today();
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; },
        getContent() { return this.content; },
      }),
    },
    MailApp: { sendEmail: (opts) => { mails.push(opts); } },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (handler) => {
        const spec = { handler };
        const builder = {
          timeBased: () => builder,
          everyDays: (n) => { spec.everyDays = n; return builder; },
          atHour: (h) => { spec.atHour = h; return builder; },
          inTimezone: (tz) => { spec.tz = tz; return builder; },
          create: () => {
            const t = { ...spec, getHandlerFunction: () => handler };
            triggers.push(t);
            return t;
          },
        };
        return builder;
      },
    },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now()])); }
      static now() { return now(); }
    },
    JSON, Math, Number, String, Object, Array, isNaN,
  };

  const context = vm.createContext(globals);
  vm.runInContext(readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });

  return {
    doPost(body) {
      const out = context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
      return JSON.parse(out.getContent());
    },
    doGet() {
      return JSON.parse(context.doGet({}).getContent());
    },
    run(fnName, ...args) {
      return context[fnName](...args);
    },
    sheets,
    props,
    mails,
    triggers,
    stats,
  };
}
