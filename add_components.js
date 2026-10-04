// add_components.js — create component folder skeletons from an intake CSV.
//
// Reads <Hand_Theracraft>/component_status/new_components.csv. Every row whose
// `status` cell is blank is validated against lib/seed_rules.js, checked for an
// existing folder or title anywhere in the tree, and — if new — created as
//   <Domain>/<level1>/<level2>/<slug>/{final,bg_removed,original,audio}/
// with a meta.json (built from the row's values plus the generator's dosage
// defaults) and a <slug>_summary.txt holding the optional `summary` column
// (empty otherwise). The outcome is written back into the row's `status` cell
// ("created <date>", "exists: <path>", "error: <msg>"), so handled rows are
// skipped next run; blank the cell to retry a row.
//
// The dashboard (npm run dashboard) offers the same thing as a form.
//
//   npm run add          create + write back status
//   npm run add:dry      report what would happen, write nothing
//
//   --folder <root>   assets root (default: the real Component_assets tree)
//   --csv <path>      intake file (default: <root>/../component_status/new_components.csv)
//
// Safety: see lib/add.js — only creates, never overwrites. The only file this
// script rewrites is the intake CSV itself (outside the tree), after saving a
// .bak copy.

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_ROOT, parseArgs } from "./lib/args.js";
import { INTAKE_COLUMNS, slugify, indexTree, createComponent } from "./lib/add.js";
import { parseCsv, toCsv, writeFileAtomic } from "./lib/csv.js";
import { writeReportFile, section } from "./lib/report.js";

const args = parseArgs(process.argv.slice(2));
const ROOT_DIR = args.value("--folder") ?? DEFAULT_ROOT;
const CSV_PATH =
  args.value("--csv") ?? path.join(path.dirname(ROOT_DIR), "component_status", "new_components.csv");
const DRY_RUN = args.has("--dry-run");

const report = { created: [], exists: [], errors: [], skipped: 0, ignoredColumns: [] };

if (!fs.existsSync(ROOT_DIR) || !fs.statSync(ROOT_DIR).isDirectory()) {
  console.error(`Assets root not found: ${ROOT_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.log(`Intake file not found: ${CSV_PATH}`);
  if (DRY_RUN) {
    console.log("Dry run — not creating it. Run without --dry-run to write a header-only template.");
  } else {
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
    fs.writeFileSync(CSV_PATH, toCsv(INTAKE_COLUMNS, []), { flag: "wx" });
    console.log("Wrote a header-only template. Fill in one row per new component and re-run.");
  }
  console.log(`Columns: ${INTAKE_COLUMNS.join(", ")}`);
  console.log("Example: wrist flexion with theraband,exercise,wrist,resistance,isotonic,theraband,,,,,,,");
  process.exit(0);
}

const raw = fs.readFileSync(CSV_PATH, "utf8");
const parsed = parseCsv(raw);
const header = parsed.header.slice();
const headerLower = header.map((h) => h.toLowerCase());
const colIdx = (name) => headerLower.indexOf(name);

if (colIdx("name") === -1 || colIdx("domain") === -1) {
  console.error(`Intake file must have at least "name" and "domain" columns. Found: ${header.join(", ")}`);
  process.exit(1);
}
if (colIdx("status") === -1) {
  header.push("status");
  headerLower.push("status");
  for (const r of parsed.rows) r.push("");
}
for (const h of header) if (!INTAKE_COLUMNS.includes(h.toLowerCase())) report.ignoredColumns.push(h);

const rowObject = (cells) => {
  const o = {};
  for (const c of INTAKE_COLUMNS) {
    const i = colIdx(c);
    o[c] = i === -1 ? "" : String(cells[i] ?? "");
  }
  return o;
};

const index = indexTree(ROOT_DIR);
const seenSlugs = new Map();
const statusIdx = colIdx("status");
const today = new Date().toISOString().slice(0, 10);

parsed.rows.forEach((cells, i) => {
  const rowNo = i + 2;
  if (String(cells[statusIdx] ?? "").trim()) {
    report.skipped++;
    return;
  }
  const row = rowObject(cells);
  const slug = slugify(row.name);
  if (slug && seenSlugs.has(slug)) {
    const reason = `duplicate of row ${seenSlugs.get(slug)} in this file`;
    cells[statusIdx] = `error: ${reason}`;
    report.errors.push({ rowNo, name: row.name, reason });
    return;
  }

  const result = createComponent({ rootDir: ROOT_DIR, index, row, dryRun: DRY_RUN });
  switch (result.outcome) {
    case "created":
      console.log(`Created: ${result.rel}`);
      cells[statusIdx] = `created ${today}`;
      report.created.push({ rowNo, name: row.name, rel: result.rel });
      seenSlugs.set(slug, rowNo);
      break;
    case "would_create":
      console.log(`Would create: ${result.rel}`);
      report.created.push({ rowNo, name: row.name, rel: result.rel });
      seenSlugs.set(slug, rowNo);
      break;
    case "exists":
      cells[statusIdx] = result.message;
      report.exists.push({ rowNo, name: row.name, where: result.where });
      break;
    default:
      cells[statusIdx] = `error: ${result.message}`;
      report.errors.push({ rowNo, name: row.name, reason: result.message });
  }
});

if (!DRY_RUN) {
  const out = toCsv(header, parsed.rows, { eol: parsed.eol, bom: parsed.bom });
  if (out !== raw) {
    fs.copyFileSync(CSV_PATH, `${CSV_PATH}.bak`);
    writeFileAtomic(CSV_PATH, out);
    console.log(`Updated ${CSV_PATH} (previous copy at ${path.basename(CSV_PATH)}.bak)`);
  }
}

console.log("");
console.log(`Summary:${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
console.log(`  ${DRY_RUN ? "Would create" : "Created"}: ${report.created.length}`);
console.log(`  Already exists: ${report.exists.length}`);
console.log(`  Errors:         ${report.errors.length}`);
console.log(`  Skipped (status already set): ${report.skipped}`);

writeReportFile([
  `# Add Components Report`,
  ``,
  `**Run:** ${new Date().toLocaleString()}`,
  `**Root:** ${ROOT_DIR}`,
  `**Intake:** ${CSV_PATH}`,
  `**Mode:** ${DRY_RUN ? "dry run (nothing written)" : "live"}`,
  ``,
  ...section(DRY_RUN ? "Would create" : "Created", report.created.map((c) => `- row ${c.rowNo} "${c.name}" → ${c.rel}`)),
  ...section("Already exists", report.exists.map((e) => `- row ${e.rowNo} "${e.name}" — ${e.where}`)),
  ...section("Errors", report.errors.map((e) => `- row ${e.rowNo} "${e.name}" — ${e.reason}`)),
  ...section("Ignored columns", report.ignoredColumns.map((c) => `- ${c}`)),
  `## Skipped — status already set (${report.skipped})`,
  ``,
]);
