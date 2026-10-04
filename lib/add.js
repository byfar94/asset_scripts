// Create a new component folder skeleton from a row of values. Shared by
// add_components.js (intake CSV) and dashboard.js (POST /add).
//
// Only ever CREATES: refuses a target that already exists, writes meta.json and
// the summary with the "wx" flag (fail-if-exists), never writes inside a
// directory that existed before. Nothing is deleted, renamed or overwritten.

import fs from "node:fs";
import path from "node:path";

import { ASSET_SUBFOLDERS, findSubdir, rawDirents, mapLevels } from "./tree.js";
import { DOMAIN_CONFIGS, DOMAIN_FOLDER_BY_DOMAIN, folderNameToLabel } from "./domains.js";
import { validateIntakeRow } from "./validate.js";

export const INTAKE_COLUMNS = [
  "name",
  "domain",
  "body_part",
  "exercise_type",
  "contraction_type",
  "equipment",
  "splint_type",
  "primary_joint_location",
  "education_type",
  "education_path_type",
  "soft_tissue_type",
  "summary",
  "status",
];

export function slugify(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Existing folder names (per domain folder) and meta.json titles (whole tree). */
export function indexTree(rootDir) {
  const names = new Map(); // domainFolder -> Map(lowerBasename -> relPath)
  const titles = new Map(); // normalised title -> relPath
  for (const domainFolder of Object.keys(DOMAIN_CONFIGS)) {
    const domainDir = findSubdir(rootDir, domainFolder);
    const map = new Map();
    names.set(domainFolder, map);
    if (!domainDir) continue;
    const walk = (dir) => {
      for (const e of rawDirents(dir)) {
        if (!e.isDirectory() || e.name.startsWith(".") || ASSET_SUBFOLDERS.has(e.name.toLowerCase())) continue;
        const p = path.join(dir, e.name);
        const rel = path.relative(rootDir, p);
        if (!map.has(e.name.toLowerCase())) map.set(e.name.toLowerCase(), rel);
        const metaPath = path.join(p, "meta.json");
        if (fs.existsSync(metaPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
            const t = String(m.title_hpc ?? "").trim().toLowerCase();
            if (t && !titles.has(t)) titles.set(t, rel);
          } catch {
            /* unreadable meta.json — the status script reports it */
          }
        }
        walk(p);
      }
    };
    walk(domainDir);
  }
  return { names, titles };
}

/** Trim every intake column; lowercase the domain. */
export function normalizeRow(input) {
  const row = {};
  for (const c of INTAKE_COLUMNS) row[c] = String(input?.[c] ?? "").trim();
  row.domain = row.domain.toLowerCase();
  return row;
}

/**
 * Create one component. Returns
 *   { outcome: "created" | "would_create" | "exists" | "error", rel?, where?, message? }
 * `index` (from indexTree) is updated on success so later rows collide.
 */
export function createComponent({ rootDir, index, row: input, dryRun = false }) {
  const row = normalizeRow(input);

  const errors = validateIntakeRow(row);
  if (errors.length) return { outcome: "error", message: errors.join("; ") };

  const slug = slugify(row.name);
  if (!slug) return { outcome: "error", message: "name produces an empty folder name" };
  if (slug.length > 100) return { outcome: "error", message: "folder name longer than 100 characters" };

  const domainFolder = DOMAIN_FOLDER_BY_DOMAIN[row.domain];
  const config = DOMAIN_CONFIGS[domainFolder];

  const byName = index.names.get(domainFolder)?.get(slug);
  const label = folderNameToLabel(slug);
  const byTitle = index.titles.get(label) ?? index.titles.get(row.name.toLowerCase());
  if (byName || byTitle) {
    const where = byName ?? byTitle;
    return { outcome: "exists", where, message: `exists: ${where}${byName ? "" : " (title match)"}` };
  }

  let dir = findSubdir(rootDir, domainFolder) ?? path.join(rootDir, domainFolder);
  const levelValues = config.levels.map((k) => row[k]);
  for (const v of levelValues) dir = findSubdir(dir, v) ?? path.join(dir, v);
  const leaf = path.join(dir, slug);
  const rel = path.relative(rootDir, leaf);

  if (fs.existsSync(leaf)) return { outcome: "exists", where: rel, message: `exists: ${rel}` };

  const meta = config.buildMeta(mapLevels(config.levels, levelValues), slug, {
    equipment: row.equipment || null,
    contractionType: row.contraction_type || undefined,
  });
  if (meta === null) {
    return { outcome: "error", message: `unsupported ${config.levels.join("/")} combination` };
  }

  if (dryRun) return { outcome: "would_create", rel, meta };

  try {
    fs.mkdirSync(leaf, { recursive: true });
    for (const sub of ["final", "bg_removed", "original", "audio"]) {
      fs.mkdirSync(path.join(leaf, sub), { recursive: true });
    }
    fs.writeFileSync(path.join(leaf, "meta.json"), JSON.stringify(meta, null, 2), { flag: "wx" });
    const summary = row.summary ? row.summary.replace(/\r\n/g, "\n").trim() + "\n" : "";
    fs.writeFileSync(path.join(leaf, `${slug}_summary.txt`), summary, { flag: "wx" });
  } catch (err) {
    return { outcome: "error", rel, message: `${err.message} (partial folder may remain at ${rel})` };
  }

  index.names.get(domainFolder)?.set(slug, rel);
  index.titles.set(meta.title_hpc, rel);
  return { outcome: "created", rel, meta, summaryWritten: Boolean(row.summary) };
}
