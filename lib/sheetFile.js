// lib/sheetFile.js
//
// Turning a spreadsheet file into a table of strings: CSV (comma or
// semicolon), or the first sheet of an Excel workbook. Shared by the web's
// import (components/ImportView.jsx, in the browser) and the native app's,
// which sends the file to netlify/functions/import-sheet.js (Stage 6, F-10).
// CommonJS, no `@/` imports, so the function can require it.
//
// SheetJS is passed in (`XLSX`) rather than required here, so the browser
// loads it only when someone picks an Excel file.

const SHEET_LIMITS = {
  // A file, before base64 (about 2.7 MB after), under Netlify's 6 MB body.
  maxFileBytes: 2 * 1024 * 1024,
  maxDataRows: 2000,
  maxColumns: 30,
  maxCellChars: 500,
};

const SHEET_EXTENSIONS = ['csv', 'txt', 'xlsx', 'xls'];

/** The lowercased extension of a file name, or ''. */
function extensionOf(fileName) {
  const m = String(fileName || '').match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * parseCSV(text, delimiter) -> string[][]
 *
 * Quoted cells (with "" for a quote), CRLF or LF, blank lines dropped,
 * every cell trimmed.
 */
function parseCSV(text, delimiter = ',') {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(current.trim());
      current = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      current = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }
  row.push(current.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

/** `;` when the header line has more semicolons than commas (European exports). */
function csvDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
  return (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
}

/** A CSV file's text (a leading byte-order mark removed) as a table. */
function csvTable(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  return parseCSV(clean, csvDelimiter(clean));
}

/**
 * The first sheet of a workbook as a table. `raw`: a date cell comes back
 * as Excel's day number, which lib/showDate.js reads exactly; the
 * formatted text ("6/3/19") could be read two ways. `maxRows` (0 for
 * all) stops SheetJS reading past the rows the server would keep.
 */
function workbookTable(XLSX, data, { type = 'array', maxRows = SHEET_LIMITS.maxDataRows + 1 } = {}) {
  const workbook = XLSX.read(data, {
    type, sheetRows: maxRows,
    cellFormula: false, cellHTML: false, cellStyles: false, cellText: false, bookVBA: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  return rows.map((row) => row.map((c) => (c == null ? '' : String(c))));
}

/**
 * capTable(table) -> { headers, rows, truncated }
 *
 * The header row and at most maxDataRows data rows, maxColumns columns and
 * maxCellChars characters a cell; `truncated` says something was cut.
 * Rows with nothing in them are dropped.
 */
function capTable(table, limits = SHEET_LIMITS) {
  let truncated = false;
  const clip = (row) => {
    const cells = Array.isArray(row) ? row : [];
    if (cells.length > limits.maxColumns) truncated = true;
    return cells.slice(0, limits.maxColumns).map((c) => {
      const s = c == null ? '' : String(c);
      if (s.length > limits.maxCellChars) { truncated = true; return s.slice(0, limits.maxCellChars); }
      return s;
    });
  };
  const all = (table || []).map(clip).filter((row) => row.some((c) => c.trim() !== ''));
  const headers = all[0] || [];
  let rows = all.slice(1);
  if (rows.length > limits.maxDataRows) { truncated = true; rows = rows.slice(0, limits.maxDataRows); }
  return { headers, rows, truncated };
}

module.exports = {
  SHEET_LIMITS, SHEET_EXTENSIONS, extensionOf, parseCSV, csvDelimiter, csvTable, workbookTable, capTable,
};
