// Minimal RFC 4180 CSV reader/writer. The data here is a dozen short columns, so
// a hand-rolled parser beats adding the repo's second dependency.

import fs from "node:fs";
import path from "node:path";

/**
 * Parse CSV text into { header, rows, eol, bom }. Handles quoted fields, "" as
 * an escaped quote, embedded newlines inside quotes, CRLF or LF, and a leading
 * BOM. Blank lines are skipped. Rows are padded to the header length; extra
 * cells are kept.
 */
export function parseCsv(text) {
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) {
    bom = true;
    text = text.slice(1);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      records.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonBlank = records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  const header = (nonBlank.shift() ?? []).map((h) => h.trim());
  const rows = nonBlank.map((r) => {
    const out = r.slice();
    while (out.length < header.length) out.push("");
    return out;
  });
  return { header, rows, eol, bom };
}

function quoteCell(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header, rows, { eol = "\n", bom = false } = {}) {
  const lines = [header, ...rows].map((r) => r.map(quoteCell).join(","));
  return (bom ? "﻿" : "") + lines.join(eol) + eol;
}

/** Write via a sibling temp file + rename so a crash never truncates the target. */
export function writeFileAtomic(filePath, text) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, filePath);
}
