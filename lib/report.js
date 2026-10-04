// Markdown report helpers. Every script writes `report-<timestamp>.md` into the
// current working directory; the formatting below is the one meta_generator.js
// has always used, so existing reports keep their shape.

import fs from "node:fs";
import path from "node:path";

export function reportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function writeReportFile(lines) {
  const reportPath = path.join(process.cwd(), `report-${reportTimestamp()}.md`);
  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`Report saved: ${reportPath}`);
  return reportPath;
}

export const fmtEntry = (e) => `- [${e.domain}] ${e.file ?? e.folder}`;
export const fmtIssue = (e) => `- [${e.domain}] **${e.folder ?? e.file}** — ${e.reason}`;

// `## heading (n)`, blank, optional note lines + blank, items or _None_, blank.
export function section(heading, items, note = []) {
  return [
    `## ${heading} (${items.length})`,
    ``,
    ...(note.length > 0 ? [...note, ``] : []),
    ...(items.length > 0 ? items : ["_None_"]),
    ``,
  ];
}
