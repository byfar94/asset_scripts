// component_status.js — what work remains on every component asset folder.
//
// Walks the asset tree READ-ONLY and writes, into <Hand_Theracraft>/component_status/:
//   one CSV per domain (and per exercise type), _overview.csv, _todo.csv, and
//   index.html (the same data as a filterable page — see dashboard.js for the
//   live version with Finder buttons).
// Every pipeline cell is one of complete | pending | n/a | error so a column
// filter on "pending" is the to-do list; `seed_status` predicts what the backend
// seeder would do, in the seeder's own words (rules copied into
// lib/seed_rules.js — nothing here reads the hthp repo).
//
//   npm run status        write CSVs + index.html + report, print the summary
//   npm run status:dry    scan only, print the summary, write nothing
//   npm run todo          same as status:dry (alias for the quick look)
//   npm run dashboard     live page in Chrome with Finder buttons (dashboard.js)
//
//   --folder <root>   assets root (default: the real Component_assets tree)
//   --out <dir>       output folder (default: <root>/../component_status)
//
// Safety: the only writes are its own files in --out (overwritten in place,
// never deleted) and report-<ts>.md in the cwd. Nothing under the asset root is
// ever written.

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_ROOT, parseArgs } from "./lib/args.js";
import { toCsv } from "./lib/csv.js";
import { writeReportFile, section } from "./lib/report.js";
import {
  scanTree,
  fileHeader,
  fileRow,
  cellState,
  PIPELINE_COLUMNS,
  TODO_LABELS,
  OVERVIEW_HEADER,
  TODO_HEADER,
} from "./lib/status.js";
import { renderPage } from "./lib/html.js";

const args = parseArgs(process.argv.slice(2));
const ROOT_DIR = args.value("--folder") ?? DEFAULT_ROOT;
const OUT_DIR = args.value("--out") ?? path.join(path.dirname(ROOT_DIR), "component_status");
const DRY_RUN = args.has("--dry-run");
const TODO_ONLY = args.has("--todo");

if (!fs.existsSync(ROOT_DIR) || !fs.statSync(ROOT_DIR).isDirectory()) {
  console.error(`Assets root not found: ${ROOT_DIR}`);
  process.exit(1);
}

const data = scanTree(ROOT_DIR);
const report = { files: [], stale: [] };

// ─── Write ───────────────────────────────────────────────────────────────────

if (!DRY_RUN) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const produced = new Set();
  const write = (file, text, label) => {
    const p = path.join(OUT_DIR, file);
    fs.writeFileSync(p, text);
    produced.add(file);
    report.files.push(p);
    if (!TODO_ONLY) console.log(`Wrote ${p}${label ? ` (${label})` : ""}`);
  };
  for (const g of data.groups) {
    write(g.file, toCsv(fileHeader(g.domain), g.rows.map((r) => fileRow(r, g.domain))), `${g.rows.length} rows`);
  }
  write("_overview.csv", toCsv(OVERVIEW_HEADER, data.overviewRows), `${data.overviewRows.length} rows`);
  write("_todo.csv", toCsv(TODO_HEADER, data.todoRows), `${data.todoRows.length} rows`);
  write("index.html", renderPage(data), "open in Chrome");
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (/^(_overview|_todo|exercise_[a-z0-9_]+|splint|education|soft_tissue)\.csv$/.test(f) && !produced.has(f))
      report.stale.push(path.join(OUT_DIR, f));
  }
}

// ─── Console summary ─────────────────────────────────────────────────────────

const { rows, totals, byTask, notes } = data;
console.log("");
console.log(`Component status${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
console.log(`Root: ${ROOT_DIR}`);
console.log("");
for (const col of PIPELINE_COLUMNS) {
  const list = byTask.get(col);
  if (!list) continue;
  console.log(`${TODO_LABELS[col]} (${list.length}):`);
  for (const p of list) console.log(`  ${p}`);
}
const errRows = rows.filter((r) => r.todo.some((t) => / error/.test(t)) || cellState(r.seed) === "error");
if (errRows.length) {
  console.log(`Has errors (${errRows.length}):`);
  for (const r of errRows) {
    const what = r.todo.filter((t) => / error/.test(t));
    console.log(`  ${r.rec.rel} — ${what.length ? what.join("; ") : r.seed}`);
  }
}
const withIssues = rows.filter((r) => r.issues.length);
if (withIssues.length) {
  console.log(`Has issues to look at (${withIssues.length}):`);
  for (const r of withIssues) console.log(`  ${r.rec.rel} — ${r.issues.join("; ")}`);
}
if (notes.tree.length) {
  console.log(`Tree notes (${notes.tree.length}):`);
  for (const t of notes.tree) console.log(`  ${t}`);
}
console.log("");
console.log(`Ready to seed: ${totals.complete} of ${totals.total}   (pending ${totals.pending}, error ${totals.error}, no meta.json ${totals["n/a"]})`);
if (report.stale.length) console.log(`Stale CSVs left in place (not produced this run): ${report.stale.join(", ")}`);
if (!DRY_RUN) console.log(`Page: ${path.join(OUT_DIR, "index.html")}   (live version with Finder buttons: npm run dashboard)`);

// ─── Report ──────────────────────────────────────────────────────────────────

const overviewTable = [
  `| ${OVERVIEW_HEADER.join(" | ")} |`,
  `| ${OVERVIEW_HEADER.map(() => "---").join(" | ")} |`,
  ...data.overviewRows.map((r) => `| ${r.join(" | ")} |`),
];
const issueTally = new Map();
for (const r of rows) for (const i of r.issues) {
  const key = i.replace(/:.*$/, "").replace(/\d+/g, "N");
  issueTally.set(key, (issueTally.get(key) ?? 0) + 1);
}
const lines = [
  `# Component Status Report`,
  ``,
  `**Run:** ${new Date().toLocaleString()}`,
  `**Root:** ${ROOT_DIR}`,
  `**Output:** ${DRY_RUN ? "(dry run — nothing written)" : OUT_DIR}`,
  ``,
  `## Overview`,
  ``,
  ...overviewTable,
  ``,
  ...section("Files written", report.files.map((f) => `- ${f}`)),
  ...section("Stale CSVs left in place", report.stale.map((f) => `- ${f}`)),
  ...section("Work remaining", data.todoRows.map((r) => `- **${r[1]}** — ${r[6]}`)),
  ...section("Issue tally", [...issueTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`)),
  ...section("Components with issues", withIssues.map((r) => `- **${r.rec.rel}** — ${r.issues.join("; ")}`)),
  ...section("Tree notes", notes.tree.map((t) => `- ${t}`)),
  ...section("Warnings", notes.warnings.map((w) => `- ${w}`)),
  ...section("Errors", notes.errors.map((e) => `- ${e}`)),
];
writeReportFile(lines);
