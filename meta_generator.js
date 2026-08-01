import fs from "node:fs";
import path from "node:path";

// ─── Assets root ─────────────────────────────────────────────────────────────
// Defaults to the real Component_assets tree; override with `--folder <path>`
// (useful for testing against a throwaway copy).

const args = process.argv.slice(2);
const folderIdx = args.indexOf("--folder");
const ROOT_DIR =
  folderIdx !== -1 && args[folderIdx + 1]
    ? args[folderIdx + 1]
    : "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets";

// `--retitle` refreshes title_hpc/documentation_hpc on meta.json files that already
// exist, re-deriving them from the (possibly renamed) component folder name. Every
// other field is preserved verbatim — this is the only mode that touches an existing
// file, and it touches nothing else. Without it, existing files are left alone.
const RETITLE = args.includes("--retitle");

// `--dry-run` reports exactly what would change without writing anything. Worth using
// before a --retitle run: hand-tuned titles that intentionally diverge from their
// folder name (e.g. "fpl repair week 4") get flattened back to the folder name.
const DRY_RUN = args.includes("--dry-run");

// ─── Edit these to change the defaults written to each meta.json ──────────────

const DEFAULTS_AROM = {
  reps_value: 20,
  reps_units: "Repetitions",
  hold_value: 5,
  hold_units: "seconds",
  frequency_value: 3,
  frequency_units: "times per day",
};

const DEFAULTS_RESISTANCE = {
  reps_value: 10,
  reps_units: "Repetitions",
  sets_value: 3,
  sets_units: "sets",
  frequency_value: 1,
  frequency_units: "times per day",
};

const DEFAULTS_STRETCH = {
  hold_value: 30,
  hold_units: "seconds",
  sets_value: 3,
  sets_units: "sets",
  frequency_value: 3,
  frequency_units: "times per day",
};

const DEFAULTS_SPLINT_STATIC = {
  wearing_schedule: "full time",
  duration_value: 6,
  duration_units: "weeks",
};

const DEFAULTS_SPLINT_MOBILITY = {
  wearing_time_value: 6,
  wearing_time_units: "hours",
  duration_value: 6,
  duration_units: "weeks",
};

// Mirrors the client form's setAttributeTypeBasedOnQualityType: a splint_type maps
// to the attribute_type whose schedule fields it uses.
const SPLINT_ATTRIBUTE_TYPE_BY_TYPE = {
  static: "static",
  static_progressive: "static",
  serial_static: "static",
  dynamic_progressive: "mobility",
  dynamic: "mobility",
};

// Subfolders inside a component leaf that hold assets — never treated as domain
// hierarchy and never recursed into.
const ASSET_SUBFOLDERS = new Set(["final", "original", "bg_removed", "audio"]);

// ─────────────────────────────────────────────────────────────────────────────

const report = {
  created: [],
  skipped: [],
  retitled: [],
  unchanged: [],
  warnings: [],
  errors: [],
};

function folderNameToLabel(name) {
  return name.toLowerCase().replace(/_/g, " ");
}

function detectEquipment(folderName) {
  const name = folderName.toLowerCase();
  if (name.includes("rubber_band")) return "rubber_band";
  if (name.includes("theraband")) return "band";
  if (name.includes("theraputty")) return "putty";
  if (name.includes("band") && !name.includes("rubber_band")) return "band";
  if (name.includes("putty")) return "putty";
  if (name.includes("towel")) return "towel";
  if (name.includes("dumbbell")) return "dumbbell";
  if (name.includes("gym")) return "gym_equipment";
  if (name.includes("therapy_equipment")) return "therapy_equipment";
  return null;
}

function buildBase(domain, name) {
  const label = folderNameToLabel(name);
  return {
    title_hpc: label,
    documentation_hpc: label,
    domain_hpc: domain,
    priority_hpc: 10,
  };
}

// ─── Per-domain meta builders ────────────────────────────────────────────────
// Each receives `levels` (folder-derived quality values, keyed by the config's
// `levels` names — missing levels are null) and the component folder `name`.
// Returns the meta.json object, or null to skip with a warning.

function buildExerciseMeta(levels, name) {
  const base = {
    ...buildBase("exercise", name),
    body_part: levels.body_part ?? null,
    equipment: detectEquipment(name),
  };
  const type = (levels.exercise_type || "").toLowerCase();

  switch (type) {
    case "arom":
      return {
        ...base,
        attribute_type: "arom",
        exercise_type: "arom",
        ...DEFAULTS_AROM,
        default_index: 0,
      };
    case "resistance":
      return {
        ...base,
        attribute_type: "resistance",
        exercise_type: "resistance",
        ...DEFAULTS_RESISTANCE,
        default_index: 0,
      };
    case "stretch":
      return {
        ...base,
        attribute_type: "stretch",
        exercise_type: "stretch",
        ...DEFAULTS_STRETCH,
        default_index: 0,
      };
    case "misc":
      return {
        ...base,
        attribute_type: "misc",
        exercise_type: "misc",
        default_index: 0,
      };
    default:
      return null;
  }
}

function buildSplintMeta(levels, name) {
  const splintType = levels.splint_type ?? null;
  const attributeType = splintType
    ? SPLINT_ATTRIBUTE_TYPE_BY_TYPE[splintType.toLowerCase()] ?? null
    : null;

  const base = {
    ...buildBase("splint", name),
    attribute_type: attributeType,
    splint_type: splintType,
    primary_joint_location: levels.primary_joint_location ?? null,
    // Written as quoted strings on purpose: the backend's parseAndValidateBool
    // only accepts the strings "true"/"false" and throws on a JSON boolean, so
    // these must stay quoted even after hand-editing (e.g. change to "true").
    isfo: "false",
    isho: "false",
    iswo: "false",
    iseo: "false",
  };

  let attrs = {};
  if (attributeType === "static") attrs = { ...DEFAULTS_SPLINT_STATIC };
  else if (attributeType === "mobility") attrs = { ...DEFAULTS_SPLINT_MOBILITY };

  return { ...base, ...attrs, default_index: 0 };
}

function buildEducationMeta(levels, name) {
  return {
    ...buildBase("education", name),
    attribute_type: null,
    education_type: levels.education_type ?? null,
    education_path_type: levels.education_path_type ?? null,
    default_index: 0,
  };
}

function buildSoftTissueMeta(levels, name) {
  return {
    ...buildBase("soft_tissue", name),
    attribute_type: null,
    soft_tissue_type: levels.soft_tissue_type ?? null,
    default_index: 0,
  };
}

// ─── Domain configs, keyed by their top-level folder name under ROOT_DIR ──────
// `levels` names the intermediate folders between the domain root and the
// component leaf (positional). The component leaf is any folder containing a
// `final/` subfolder.

const DOMAIN_CONFIGS = {
  Exercise: {
    levels: ["body_part", "exercise_type"],
    buildMeta: buildExerciseMeta,
  },
  splint: {
    levels: ["splint_type", "primary_joint_location"],
    buildMeta: buildSplintMeta,
  },
  education: {
    levels: ["education_type", "education_path_type"],
    buildMeta: buildEducationMeta,
  },
  soft_tissue: {
    levels: ["soft_tissue_type"],
    buildMeta: buildSoftTissueMeta,
  },
};

// ─── Walking ─────────────────────────────────────────────────────────────────

function hasFinalFolder(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name.toLowerCase() === "final",
    );
  } catch {
    return false;
  }
}

// A component leaf is a directory that contains a `final/` folder. Recursion stops
// at a leaf (its asset subfolders are never treated as hierarchy).
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
    if (entry.name.startsWith(".")) continue;
    if (ASSET_SUBFOLDERS.has(entry.name.toLowerCase())) continue;
    collectLeaves(path.join(dir, entry.name), leaves);
  }
}

function mapLevels(levelNames, segments) {
  const out = {};
  levelNames.forEach((levelName, i) => {
    out[levelName] = segments[i] ?? null;
  });
  return out;
}

async function processLeaf(leaf, config, domainKey) {
  const rel = path.relative(path.join(ROOT_DIR, domainKey), leaf);
  const parts = rel.split(path.sep).filter(Boolean);
  const name = parts[parts.length - 1] ?? path.basename(leaf);
  const intermediates = parts.slice(0, -1);
  const levels = mapLevels(config.levels, intermediates);

  const meta = config.buildMeta(levels, name);
  if (meta === null) {
    console.warn(`Warning: could not build meta for ${leaf}`);
    report.warnings.push({
      folder: leaf,
      domain: domainKey,
      reason: "Unknown/unsupported type (folder structure did not map to a template)",
    });
    return;
  }

  const metaPath = path.join(leaf, "meta.json");
  if (fs.existsSync(metaPath)) {
    if (RETITLE) {
      await retitleExisting(metaPath, name, domainKey);
    } else {
      console.log(`Skipping (meta.json exists): ${metaPath}`);
      report.skipped.push({ file: metaPath, domain: domainKey });
    }
    return;
  }

  if (DRY_RUN) {
    console.log(`Would create: ${metaPath}`);
    report.created.push({ file: metaPath, domain: domainKey });
    return;
  }

  try {
    await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2));
    console.log(`Created: ${metaPath}`);
    report.created.push({ file: metaPath, domain: domainKey });
  } catch (err) {
    console.error(`Error writing ${metaPath}:`, err.message);
    report.errors.push({ file: metaPath, domain: domainKey, reason: err.message });
  }
}

// Rewrites only title_hpc/documentation_hpc from the folder name. The file is read,
// those two keys are replaced in place, and everything else — hand-tuned reps, holds,
// booleans, unknown keys added later — is written back untouched. Key order is
// preserved because both keys already exist in every generated file.
async function retitleExisting(metaPath, name, domainKey) {
  let existing;
  try {
    existing = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
  } catch (err) {
    console.error(`Error reading ${metaPath}:`, err.message);
    report.errors.push({
      file: metaPath,
      domain: domainKey,
      reason: `Could not read/parse existing meta.json — ${err.message}`,
    });
    return;
  }

  const label = folderNameToLabel(name);
  const changes = [];
  if (existing.title_hpc !== label) {
    changes.push(`title_hpc: "${existing.title_hpc}" → "${label}"`);
  }
  if (existing.documentation_hpc !== label) {
    changes.push(`documentation_hpc: "${existing.documentation_hpc}" → "${label}"`);
  }

  if (changes.length === 0) {
    report.unchanged.push({ file: metaPath, domain: domainKey });
    return;
  }

  const entry = { file: metaPath, domain: domainKey, changes };

  if (DRY_RUN) {
    console.log(`Would retitle: ${metaPath}\n    ${changes.join("\n    ")}`);
    report.retitled.push(entry);
    return;
  }

  const updated = { ...existing, title_hpc: label, documentation_hpc: label };

  try {
    await fs.promises.writeFile(metaPath, JSON.stringify(updated, null, 2));
    console.log(`Retitled: ${metaPath}\n    ${changes.join("\n    ")}`);
    report.retitled.push(entry);
  } catch (err) {
    console.error(`Error writing ${metaPath}:`, err.message);
    report.errors.push({ file: metaPath, domain: domainKey, reason: err.message });
  }
}

async function walkAllDomains() {
  for (const [domainKey, config] of Object.entries(DOMAIN_CONFIGS)) {
    const domainDir = path.join(ROOT_DIR, domainKey);
    if (!fs.existsSync(domainDir) || !fs.statSync(domainDir).isDirectory()) {
      console.warn(`Skipping domain (folder not found): ${domainDir}`);
      report.warnings.push({
        folder: domainDir,
        domain: domainKey,
        reason: "Domain folder not found",
      });
      continue;
    }

    const leaves = [];
    collectLeaves(domainDir, leaves);

    if (leaves.length === 0) {
      console.warn(`No component folders (with final/) under: ${domainDir}`);
      report.warnings.push({
        folder: domainDir,
        domain: domainKey,
        reason: "No component leaf folders (containing final/) found",
      });
      continue;
    }

    for (const leaf of leaves) {
      await processLeaf(leaf, config, domainKey);
    }
  }
}

function writeReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), `report-${timestamp}.md`);

  const fmtEntry = (e) => `- [${e.domain}] ${e.file ?? e.folder}`;
  const fmtIssue = (e) => `- [${e.domain}] **${e.folder ?? e.file}** — ${e.reason}`;
  const fmtRetitle = (e) =>
    [`- [${e.domain}] ${e.file}`, ...e.changes.map((c) => `  - ${c}`)].join("\n");

  const mode = [
    RETITLE ? "retitle" : "create-if-missing",
    DRY_RUN ? "dry run (nothing written)" : "live",
  ].join(", ");

  const lines = [
    `# Meta Generator Report`,
    ``,
    `**Run:** ${new Date().toLocaleString()}`,
    `**Root:** ${ROOT_DIR}`,
    `**Mode:** ${mode}`,
    ``,
    `## ${DRY_RUN ? "Would create" : "Created"} (${report.created.length})`,
    ``,
    ...(report.created.length > 0 ? report.created.map(fmtEntry) : ["_None_"]),
    ``,
    `## Skipped — already exists (${report.skipped.length})`,
    ``,
    ...(report.skipped.length > 0 ? report.skipped.map(fmtEntry) : ["_None_"]),
    ``,
    `## ${DRY_RUN ? "Would retitle" : "Retitled"} (${report.retitled.length})`,
    ``,
    ...(report.retitled.length > 0 ? report.retitled.map(fmtRetitle) : ["_None_"]),
    ``,
    `## Already matched folder name (${report.unchanged.length})`,
    ``,
    ...(report.unchanged.length > 0 ? report.unchanged.map(fmtEntry) : ["_None_"]),
    ``,
    `## Warnings (${report.warnings.length})`,
    ``,
    ...(report.warnings.length > 0 ? report.warnings.map(fmtIssue) : ["_None_"]),
    ``,
    `## Errors (${report.errors.length})`,
    ``,
    ...(report.errors.length > 0 ? report.errors.map(fmtIssue) : ["_None_"]),
    ``,
  ];

  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`Report saved: ${reportPath}`);
}

walkAllDomains()
  .then(() => {
    console.log("");
    console.log(`Summary:${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
    console.log(`  Created:   ${report.created.length}`);
    console.log(`  Skipped:   ${report.skipped.length}`);
    console.log(`  Retitled:  ${report.retitled.length}`);
    console.log(`  Unchanged: ${report.unchanged.length}`);
    console.log(`  Warnings:  ${report.warnings.length}`);
    console.log(`  Errors:    ${report.errors.length}`);
    writeReport();
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
