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

// Splint dosage column names come from the app's attribute registry
// (shared/src/taxonomy/components/attributeFields.ts, domain "splint"):
// wearing_schedule, wearing_time_value/_units, wear_for_value/_units.
// wearing_schedule must be one of the four `wearingSchedules` values in
// shared/src/taxonomy/components/attributeUnits.ts. "full time" was not one of
// them, so a static splint generated from it could never be linked into a
// template — the create schema checks the field with z.enum.
//
// "wear_for" is how long to keep wearing the splint (days / weeks / months).
// It was called "duration" until 2026-10-03; the seeder now ignores keys the
// domain does not have, so an old "duration_*" pair would be dropped silently.
const DEFAULTS_RESISTANCE_ISOMETRIC = {
  hold_value: 45,
  hold_units: "seconds",
  sets_value: 5,
  sets_units: "sets",
  frequency_value: 1,
  frequency_units: "times per day",
};

const DEFAULTS_SPLINT_STATIC = {
  wearing_schedule: "full time except showering",
  wear_for_value: 6,
  wear_for_units: "weeks",
};

// wearing_time_units must be exactly WEARING_TIME_UNITS ("hours per day").
const DEFAULTS_SPLINT_MOBILITY = {
  wearing_time_value: 6,
  wearing_time_units: "hours per day",
  wear_for_value: 6,
  wear_for_units: "weeks",
};

// Which default dosage shape a splint_type starts with. Mirrors the app's
// suggestions in attributeFields.ts: static and the generic dynamic splint are
// worn on a schedule; the progressive and serial types are worn for hours per
// day. Every value here is a real `splintTypes` entry.
//
// The resulting `attribute_type` key is written for continuity with older
// files only: the seeder no longer reads it (dosage is per-field now), so it is
// not load bearing. The shape it names still decides which defaults are emitted.
const SPLINT_ATTRIBUTE_TYPE_BY_TYPE = {
  static: "static",
  dynamic: "static",
  static_progressive: "mobility",
  serial_static: "mobility",
  dynamic_progressive: "mobility",
};

// Subfolders inside a component leaf that hold assets — never treated as domain
// hierarchy and never recursed into.
const ASSET_SUBFOLDERS = new Set(["final", "original", "bg_removed", "audio"]);

// Kept identical to IMAGE_EXTS/VIDEO_EXTS/CAPTION_EXTS in the backend seeder
// (server/src/scripts/runSeed.ts). The seeder skips any component whose final/
// holds a video with no matching caption, so if these lists drift this script
// stops predicting what the seed will actually do.
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov"]);
const CAPTION_EXTS = new Set([".srt", ".vtt"]);

// The marker that names a component's default image. The seeder picks the first
// image in sort order whose filename contains this — there is no meta.json key
// for it.
const DEFAULT_IMAGE_MARKER = "(d)";

// ─────────────────────────────────────────────────────────────────────────────

const report = {
  created: [],
  skipped: [],
  retitled: [],
  unchanged: [],
  // Kept out of `warnings` on purpose: this is the list you act on before a
  // seed run, and burying it among unknown-type/domain-not-found warnings makes
  // it hard to scan.
  missingCaptions: [],
  // Same reasoning as missingCaptions: a to-do list you act on while arranging
  // assets, not a general warning. Unlike captions this one never blocks a
  // seed — it flags a choice the seeder would make silently.
  ambiguousDefaults: [],
  warnings: [],
  errors: [],
};

function folderNameToLabel(name) {
  return name.toLowerCase().replace(/_/g, " ");
}

// Every return value here must be one of the `exerciseEquipment` values in
// shared/src/taxonomy/components/exerciseDomain.ts. This used to return the
// short forms "band" and "putty", which are not taxonomy values — the nav then
// rendered them through the title-case fallback as "Band"/"Putty" instead of
// "Theraband"/"Theraputty".
//
// Order matters: "theraband" and "rubberband" both contain "band", so the
// specific spellings have to be tested before the generic branch. Folder names
// use both "rubber_band" and "rubberband", and only the underscored form used
// to be recognised — the rest fell through to the generic band branch.
function detectEquipment(folderName) {
  const name = folderName.toLowerCase();
  if (name.includes("rubber_band") || name.includes("rubberband"))
    return "rubber_band";
  if (name.includes("theraband")) return "theraband";
  if (name.includes("theraputty")) return "theraputty";
  if (name.includes("band")) return "theraband";
  if (name.includes("putty")) return "theraputty";
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
      };
    case "resistance": {
      // contraction_type is required for resistance by the app's create
      // schema and picks the dosage. Inferred from the folder name: anything
      // mentioning "isometric" is isometric (45 s hold, 5 sets, once a day),
      // the rest isotonic (reps, sets, frequency). Hand-edit when the name
      // does not say. Four fields is the app's maximum per component.
      const isometric = /isometric/i.test(name);
      return {
        ...base,
        attribute_type: "resistance",
        exercise_type: "resistance",
        contraction_type: isometric ? "isometric" : "isotonic",
        ...(isometric ? DEFAULTS_RESISTANCE_ISOMETRIC : DEFAULTS_RESISTANCE),
      };
    }
    // Not a typo. The exercise type was renamed "stretch" → "prom", but the
    // attribute set it is dosed on was not: the schedule fields still live in
    // hpc_schedule_attributes_stretch and insertHpcExercise switches on
    // attribute_type === "stretch" literally. Same asymmetry as
    // setAttributeTypeBasedOnQualityType in the client form, which this switch
    // mirrors. Setting attribute_type to "prom" here makes the seeder throw
    // `Unsupported attribute type: prom` on every PROM component.
    case "prom":
      return {
        ...base,
        attribute_type: "stretch",
        exercise_type: "prom",
        ...DEFAULTS_STRETCH,
      };
    case "misc":
      return {
        ...base,
        attribute_type: "misc",
        exercise_type: "misc",
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

  return { ...base, ...attrs };
}

function buildEducationMeta(levels, name) {
  return {
    ...buildBase("education", name),
    attribute_type: null,
    education_type: levels.education_type ?? null,
    education_path_type: levels.education_path_type ?? null,
  };
}

function buildSoftTissueMeta(levels, name) {
  return {
    ...buildBase("soft_tissue", name),
    attribute_type: null,
    soft_tissue_type: levels.soft_tissue_type ?? null,
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

// Case-insensitive subfolder lookup, mirroring findSubdir in the backend seeder
// so both agree on which folder counts as `final/` or `audio/`.
function findSubdir(dir, name) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = entries.find(
    (e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase(),
  );
  return found ? path.join(dir, found.name) : null;
}

// Mirrors listUsableFiles in the backend seeder: skips dotfiles (.DS_Store) and
// the `__`-prefixed scratch files that turn up in these folders.
function listUsableFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith(".") && !n.startsWith("__"));
  } catch {
    return [];
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

// Admin components are expected to ship captions with every video, and the
// backend seeder now refuses to create one that doesn't. This reports the same
// condition ahead of the seed, so the gap is visible while the assets are still
// being assembled rather than as a skipped folder mid-run.
//
// Only `final/` counts — `original/` and `bg_removed/` hold working copies that
// are never uploaded. Captions are matched by extension, not by name, because
// the naming in audio/ is inconsistent (`_cap.srt`, `_caption.srt`, `_video.srt`
// and bare names all appear).
function checkCaptions(leaf, domainKey) {
  const finalDir = findSubdir(leaf, "final");
  if (!finalDir) return;

  const hasVideo = listUsableFiles(finalDir).some((f) =>
    VIDEO_EXTS.has(path.extname(f).toLowerCase()),
  );
  if (!hasVideo) return;

  const audioDir = findSubdir(leaf, "audio");
  const hasCaption =
    audioDir !== null &&
    listUsableFiles(audioDir).some((f) =>
      CAPTION_EXTS.has(path.extname(f).toLowerCase()),
    );
  if (hasCaption) return;

  const reason = audioDir
    ? "video in final/ but no caption file (.srt/.vtt) in audio/"
    : "video in final/ but no audio/ folder";

  console.warn(`Warning: ${reason} — ${leaf}`);
  report.missingCaptions.push({ folder: leaf, domain: domainKey, reason });
}

// The default image is chosen by filename: the seeder takes the first image in
// sort order whose name contains "(d)". More than one marked image is therefore
// not an error — it just means the seeder picks silently, and which one wins
// depends on sort order rather than on anything the folder says. Reported so
// that choice surfaces while the assets are being arranged.
//
// Only `final/` counts, and only images: a "(d)" in a video filename is not a
// default-image marker. No warning when nothing is marked — that is the normal
// case and index 0 wins.
function checkDefaultImage(leaf, domainKey) {
  const finalDir = findSubdir(leaf, "final");
  if (!finalDir) return;

  const marked = listUsableFiles(finalDir)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .filter((f) => f.toLowerCase().includes(DEFAULT_IMAGE_MARKER));

  if (marked.length < 2) return;

  const reason =
    `${marked.length} images marked "${DEFAULT_IMAGE_MARKER}" — the seeder will use ` +
    `"${marked[0]}" and ignore ${marked.slice(1).map((f) => `"${f}"`).join(", ")}`;

  console.warn(`Warning: ${reason} — ${leaf}`);
  report.ambiguousDefaults.push({ folder: leaf, domain: domainKey, reason });
}

async function processLeaf(leaf, config, domainKey) {
  // First, before any early return below. A missing caption is worth reporting
  // whether or not the folder maps to a known type and whether or not its
  // meta.json already exists — both of those paths return early.
  checkCaptions(leaf, domainKey);
  checkDefaultImage(leaf, domainKey);

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
    `## Videos missing captions (${report.missingCaptions.length})`,
    ``,
    `_The seeder skips these — they will not be created until a caption file_`,
    `_(.srt or .vtt) exists in the component's audio/ folder._`,
    ``,
    ...(report.missingCaptions.length > 0
      ? report.missingCaptions.map(fmtIssue)
      : ["_None_"]),
    ``,
    `## Ambiguous default image (${report.ambiguousDefaults.length})`,
    ``,
    `_More than one image in final/ is marked "${DEFAULT_IMAGE_MARKER}". These still_`,
    `_seed — the first in sort order wins — but the choice is not yours until only_`,
    `_one image carries the marker._`,
    ``,
    ...(report.ambiguousDefaults.length > 0
      ? report.ambiguousDefaults.map(fmtIssue)
      : ["_None_"]),
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
    console.log(`  Missing captions: ${report.missingCaptions.length}`);
    console.log(`  Ambiguous default image: ${report.ambiguousDefaults.length}`);
    console.log(`  Warnings:  ${report.warnings.length}`);
    console.log(`  Errors:    ${report.errors.length}`);
    writeReport();
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
