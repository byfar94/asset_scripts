import fs from "node:fs";
import path from "node:path";

// ─── What to remap ───────────────────────────────────────────────────────────
// Fill these three in for the job at hand, run `npm run remap:dry`, then
// `npm run remap` — and blank them again afterwards. The script refuses to run
// while they are empty, so a finished migration can never re-fire because
// someone ran the command out of habit.
//
// Deliberately a const rather than --from/--to flags. This rewrites data in
// place across the whole asset tree, and a mistyped flag on something like that
// is a bad failure mode — editing a line here is reviewable, a shell history
// entry is not.
//
// `field` is any top-level key in meta.json, so this works for whatever the next
// taxonomy shift touches. Jobs it has run so far, for reference:
//
//   { field: "exercise_type", from: "stretch", to: "prom"        }
//   { field: "equipment",     from: "putty",   to: "theraputty"  }
//   { field: "equipment",     from: "band",    to: "rubber_band" }

const REMAP = { field: "", from: "", to: "" };

// attribute_type is a leftover from the bundle era (arom / resistance /
// stretch / static / mobility). Since 2026-10-03 dosage is stored per field in
// one table per domain and the seeder ignores this key entirely, so remapping
// it would change nothing in the app. It stays guarded so a remap run never
// "fixes" something that has no effect; delete the key from files instead when
// they are next regenerated.
const FORBIDDEN_FIELDS = new Set(["attribute_type"]);

// ─── Assets root ─────────────────────────────────────────────────────────────
// Same default and same --folder override as meta_generator.js. Rehearsing a
// run against a `cp -R` copy is the intended way to use this script, since the
// asset tree is not under version control.

const args = process.argv.slice(2);
const folderIdx = args.indexOf("--folder");
const ROOT_DIR =
  folderIdx !== -1 && args[folderIdx + 1]
    ? args[folderIdx + 1]
    : "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets";

const DRY_RUN = args.includes("--dry-run");

// ─── Shared with meta_generator.js ───────────────────────────────────────────
// Copied rather than imported: meta_generator.js is a top-level script that
// runs its walk on load and exports nothing, so importing it would execute it.
// These three must keep agreeing with the generator and with the backend seeder
// (server/src/scripts/runSeed.ts) on what counts as a component.

const ASSET_SUBFOLDERS = new Set(["final", "original", "bg_removed", "audio"]);

// A component leaf is a directory containing a `final/` folder. Recursion stops
// at a leaf, so asset subfolders are never treated as hierarchy.
function collectLeaves(dir, leaves) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.some((e) => e.isDirectory() && e.name.toLowerCase() === "final")) {
    leaves.push(dir);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || /\.skip(\.[^.]*)?$/i.test(entry.name)) continue;
    if (ASSET_SUBFOLDERS.has(entry.name.toLowerCase())) continue;
    collectLeaves(path.join(dir, entry.name), leaves);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const report = {
  remapped: [],
  alreadyTarget: [],
  // Grouped rather than listed: most of the tree holds arom/resistance/null and
  // enumerating ~100 untouched files buries the rows that matter.
  untouched: new Map(),
  noMeta: [],
  errors: [],
};

function countUntouched(value) {
  const key = value === undefined ? "(field absent)" : JSON.stringify(value);
  report.untouched.set(key, (report.untouched.get(key) ?? 0) + 1);
}

// Rewrites only REMAP.field. The spread preserves key order and every other
// field — hand-tuned dosage, the quoted splint booleans, keys added later —
// because the key already exists in the object being spread. Same technique as
// retitleExisting() in meta_generator.js, for the same reason.
async function processLeaf(leaf) {
  const metaPath = path.join(leaf, "meta.json");

  if (!fs.existsSync(metaPath)) {
    report.noMeta.push({ folder: leaf });
    return;
  }

  let existing;
  try {
    existing = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
  } catch (err) {
    console.error(`Error reading ${metaPath}:`, err.message);
    report.errors.push({
      file: metaPath,
      reason: `Could not read/parse meta.json — ${err.message}`,
    });
    return;
  }

  const current = existing[REMAP.field];

  if (current === REMAP.to) {
    report.alreadyTarget.push({ file: metaPath });
    return;
  }

  // Matched by exact value on the named key — never by searching the file for
  // the string, which would also hit attribute_type.
  if (current !== REMAP.from) {
    countUntouched(current);
    return;
  }

  const change = `${REMAP.field}: "${REMAP.from}" → "${REMAP.to}"`;
  const entry = { file: metaPath, change };

  if (DRY_RUN) {
    console.log(`Would remap: ${metaPath}\n    ${change}`);
    report.remapped.push(entry);
    return;
  }

  const updated = { ...existing, [REMAP.field]: REMAP.to };

  try {
    await fs.promises.writeFile(metaPath, JSON.stringify(updated, null, 2));
    console.log(`Remapped: ${metaPath}\n    ${change}`);
    report.remapped.push(entry);
  } catch (err) {
    console.error(`Error writing ${metaPath}:`, err.message);
    report.errors.push({ file: metaPath, reason: err.message });
  }
}

async function walk() {
  if (!REMAP.field || !REMAP.from || !REMAP.to) {
    console.error(
      "Nothing to remap: fill in the REMAP const at the top of this file.",
    );
    console.error('  e.g. { field: "equipment", from: "putty", to: "theraputty" }');
    process.exit(1);
  }

  if (FORBIDDEN_FIELDS.has(REMAP.field)) {
    console.error(
      `Refusing to run: "${REMAP.field}" must not be remapped by this script.`,
    );
    console.error("See the comment on FORBIDDEN_FIELDS at the top of this file.");
    process.exit(1);
  }

  if (!fs.existsSync(ROOT_DIR) || !fs.statSync(ROOT_DIR).isDirectory()) {
    console.error(`Assets root not found: ${ROOT_DIR}`);
    process.exit(1);
  }

  const leaves = [];
  collectLeaves(ROOT_DIR, leaves);

  if (leaves.length === 0) {
    console.warn(`No component folders (with final/) under: ${ROOT_DIR}`);
    return;
  }

  for (const leaf of leaves) {
    await processLeaf(leaf);
  }
}

function writeReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), `report-${timestamp}.md`);

  const fmtEntry = (e) => `- ${e.file ?? e.folder}`;
  const fmtRemap = (e) => `- ${e.file}\n  - ${e.change}`;
  const fmtIssue = (e) => `- **${e.file ?? e.folder}** — ${e.reason}`;
  const fmtUntouched = ([value, count]) => `- \`${value}\` — ${count}`;

  const lines = [
    `# Meta Remap Report`,
    ``,
    `**Run:** ${new Date().toLocaleString()}`,
    `**Root:** ${ROOT_DIR}`,
    `**Mode:** ${DRY_RUN ? "dry run (nothing written)" : "live"}`,
    `**Remap:** \`${REMAP.field}\`: "${REMAP.from}" → "${REMAP.to}"`,
    ``,
    `## ${DRY_RUN ? "Would remap" : "Remapped"} (${report.remapped.length})`,
    ``,
    ...(report.remapped.length > 0 ? report.remapped.map(fmtRemap) : ["_None_"]),
    ``,
    `## Already "${REMAP.to}" (${report.alreadyTarget.length})`,
    ``,
    ...(report.alreadyTarget.length > 0
      ? report.alreadyTarget.map(fmtEntry)
      : ["_None_"]),
    ``,
    `## Untouched — other values of \`${REMAP.field}\``,
    ``,
    ...(report.untouched.size > 0
      ? [...report.untouched.entries()].sort().map(fmtUntouched)
      : ["_None_"]),
    ``,
    `## No meta.json (${report.noMeta.length})`,
    ``,
    `_This script never creates one — run meta_generator.js for those._`,
    ``,
    ...(report.noMeta.length > 0 ? report.noMeta.map(fmtEntry) : ["_None_"]),
    ``,
    `## Errors (${report.errors.length})`,
    ``,
    ...(report.errors.length > 0 ? report.errors.map(fmtIssue) : ["_None_"]),
    ``,
  ];

  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`Report saved: ${reportPath}`);
}

walk()
  .then(() => {
    const untouchedTotal = [...report.untouched.values()].reduce(
      (a, b) => a + b,
      0,
    );
    console.log("");
    console.log(`Summary:${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
    console.log(`  Remapped:        ${report.remapped.length}`);
    console.log(`  Already "${REMAP.to}":   ${report.alreadyTarget.length}`);
    console.log(`  Untouched:       ${untouchedTotal}`);
    console.log(`  No meta.json:    ${report.noMeta.length}`);
    console.log(`  Errors:          ${report.errors.length}`);
    writeReport();
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
