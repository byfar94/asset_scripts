import fs from "node:fs";
import path from "node:path";

import { DEFAULT_ROOT, parseArgs } from "./lib/args.js";
import {
  IMAGE_EXTS,
  VIDEO_EXTS,
  CAPTION_EXTS,
  DEFAULT_IMAGE_MARKER,
  findSubdir,
  listUsableFiles,
  collectLeaves,
  mapLevels,
} from "./lib/tree.js";
import { DOMAIN_CONFIGS, folderNameToLabel } from "./lib/domains.js";
import { writeReportFile } from "./lib/report.js";

// ─── Assets root ─────────────────────────────────────────────────────────────
// Defaults to the real Component_assets tree; override with `--folder <path>`
// (useful for testing against a throwaway copy).

const args = parseArgs(process.argv.slice(2));
const ROOT_DIR = args.value("--folder") ?? DEFAULT_ROOT;

// `--retitle` refreshes title_hpc/documentation_hpc on meta.json files that already
// exist, re-deriving them from the (possibly renamed) component folder name. Every
// other field is preserved verbatim — this is the only mode that touches an existing
// file, and it touches nothing else. Without it, existing files are left alone.
const RETITLE = args.has("--retitle");

// `--dry-run` reports exactly what would change without writing anything. Worth using
// before a --retitle run: hand-tuned titles that intentionally diverge from their
// folder name (e.g. "fpl repair week 4") get flattened back to the folder name.
const DRY_RUN = args.has("--dry-run");

// Dosage defaults, per-domain meta builders, DOMAIN_CONFIGS and the filesystem
// helpers live in lib/ (shared with component_status.js and add_components.js).

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

  writeReportFile(lines);
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
