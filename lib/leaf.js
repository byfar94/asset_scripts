// Per-component scanning for component_status.js: what is on disk, what the
// seeder would do with it, and which mismatches are worth a look. Read-only.

import fs from "node:fs";
import path from "node:path";
import {
  ASSET_SUBFOLDERS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  CAPTION_EXTS,
  AUDIO_EXTS,
  DEFAULT_IMAGE_MARKER,
  extIn,
  listUsableFiles,
  rawDirents,
  mapLevels,
} from "./tree.js";
import { folderNameToLabel } from "./domains.js";
import { CREATABLE_ENUMS as ENUMS, LIMITS, SEED_REASONS } from "./seed_rules.js";
import { validateMeta, formatIssues } from "./validate.js";

const CANONICAL = ["final", "original", "bg_removed", "audio"];
export const CANONICAL_KEYS = { final: "final", original: "original", bg_removed: "bgRemoved", audio: "audio" };

// Status-script leaf rule: the seeder's (has meta.json) OR the generator's /
// bg_removal's (has any asset subfolder). Receives dirents.
export function isStatusLeaf(entries) {
  return entries.some(
    (e) =>
      (e.isFile() && e.name === "meta.json") ||
      (e.isDirectory() && ASSET_SUBFOLDERS.has(e.name.toLowerCase())),
  );
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}

function describeSubdir(dirPath, actualName, matchKind) {
  const files = listUsableFiles(dirPath);
  const hiddenDirs = rawDirents(dirPath)
    .filter((e) => e.isDirectory() && e.name.startsWith("."))
    .map((e) => e.name);
  return {
    path: dirPath,
    actualName,
    matchKind, // exact | case | typo
    files,
    images: files.filter((f) => extIn(f, IMAGE_EXTS)),
    videos: files.filter((f) => extIn(f, VIDEO_EXTS)),
    captions: files.filter((f) => extIn(f, CAPTION_EXTS)),
    audio: files.filter((f) => extIn(f, AUDIO_EXTS)),
    other: files.filter(
      (f) => !extIn(f, IMAGE_EXTS) && !extIn(f, VIDEO_EXTS) && !extIn(f, CAPTION_EXTS) && !extIn(f, AUDIO_EXTS),
    ),
    hiddenDirs,
  };
}

/** Scan one component folder. Never writes. */
export function scanLeaf(leafDir, domainKey, config, rootDir) {
  const rel = path.relative(rootDir, leafDir).split(path.sep).join("/");
  const relInDomain = path.relative(path.join(rootDir, domainKey), leafDir);
  const parts = relInDomain.split(path.sep).filter(Boolean);
  const name = parts[parts.length - 1] ?? path.basename(leafDir);
  const levels = mapLevels(config.levels, parts.slice(0, -1));

  const dirents = rawDirents(leafDir);
  const dirs = dirents.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const claimed = new Set();
  const subdirs = {};
  const typos = [];
  const caseIssues = [];

  for (const canon of CANONICAL) {
    const exact = dirs.find((e) => e.name === canon);
    const ci = exact ?? dirs.find((e) => e.name.toLowerCase() === canon);
    const typo =
      ci ??
      dirs.find(
        (e) =>
          !claimed.has(e.name) &&
          !CANONICAL.includes(e.name.toLowerCase()) &&
          levenshtein(e.name.toLowerCase(), canon) <= 2,
      );
    const hit = exact ?? ci ?? typo;
    if (!hit) {
      subdirs[CANONICAL_KEYS[canon]] = null;
      continue;
    }
    claimed.add(hit.name);
    const kind = exact ? "exact" : ci ? "case" : "typo";
    if (kind === "case") caseIssues.push({ actual: hit.name, expected: canon });
    if (kind === "typo") typos.push({ actual: hit.name, expected: canon });
    subdirs[CANONICAL_KEYS[canon]] = describeSubdir(path.join(leafDir, hit.name), hit.name, kind);
  }
  const extraSubdirs = dirs.filter((e) => !claimed.has(e.name)).map((e) => e.name);
  const hiddenRootDirs = dirents.filter((e) => e.isDirectory() && e.name.startsWith(".")).map((e) => e.name);

  const rootFiles = listUsableFiles(leafDir);
  const txtFiles = rootFiles.filter((f) => f.endsWith(".txt"));
  let summaryText = null;
  let txtState = "missing";
  if (txtFiles.length > 0) {
    try {
      summaryText = fs.readFileSync(path.join(leafDir, txtFiles[0]), "utf8").trim();
    } catch {
      summaryText = "";
    }
    txtState = summaryText ? (txtFiles.length > 1 ? "multiple" : "ok") : "empty";
  }

  const meta = { state: "missing", error: null, data: null };
  if (rootFiles.includes("meta.json")) {
    try {
      meta.data = JSON.parse(fs.readFileSync(path.join(leafDir, "meta.json"), "utf8"));
      meta.state = "ok";
    } catch (err) {
      meta.state = "invalid";
      meta.error = err.message;
    }
  }

  const finalImgsSorted = subdirs.final ? [...subdirs.final.images].sort() : [];
  const markedDefaults = finalImgsSorted.filter((f) => f.toLowerCase().includes(DEFAULT_IMAGE_MARKER));
  const markedOutsideFinal = [];
  for (const key of ["original", "bgRemoved", "audio"]) {
    const s = subdirs[key];
    if (!s) continue;
    for (const f of s.images) if (f.toLowerCase().includes(DEFAULT_IMAGE_MARKER)) markedOutsideFinal.push(`${s.actualName}/${f}`);
  }
  for (const extra of extraSubdirs) {
    for (const f of listUsableFiles(path.join(leafDir, extra)))
      if (extIn(f, IMAGE_EXTS) && f.toLowerCase().includes(DEFAULT_IMAGE_MARKER)) markedOutsideFinal.push(`${extra}/${f}`);
  }

  // Validation the way the seeder would run it. When the summary is missing or
  // empty the seeder never gets this far; we still validate against a
  // placeholder so meta-only problems show up in the meta_json column early.
  const validation =
    meta.state === "ok" ? validateMeta(meta.data, summaryText || "(placeholder)") : [];

  return {
    dir: leafDir,
    rel,
    name,
    domainKey,
    domain: config.domain,
    levels,
    subdirs,
    extraSubdirs,
    hiddenRootDirs,
    typos,
    caseIssues,
    txtFiles,
    txtState,
    summaryText,
    meta,
    validation,
    markedDefaults,
    markedOutsideFinal,
  };
}

// ─── Pipeline cells ───────────────────────────────────────────────────────────
// Vocabulary: complete | pending | n/a | error, with an optional "(detail)".
// Done-ness flows backwards from final/: once final has what it needs, the
// upstream stages stop reading as pending.

export const PIPELINE_COLUMNS = [
  "images_taken",
  "bg_removed",
  "images_final",
  "video_taken",
  "video_bg_removed",
  "video_final",
  "captions",
  "audio",
  "summary_txt",
  "meta_json",
];

export function computeCells(rec) {
  const s = rec.subdirs;
  const oi = s.original?.images.length ?? 0;
  const bi = s.bgRemoved?.images.length ?? 0;
  const fi = s.final?.images.length ?? 0;
  const ov = s.original?.videos.length ?? 0;
  const bv = s.bgRemoved?.videos.length ?? 0;
  const fv = s.final?.videos.length ?? 0;
  const caps = s.audio?.captions.length ?? 0;
  const mp3 = s.audio?.audio.length ?? 0;
  const c = {};

  c.images_final =
    fi > LIMITS.MAX_IMAGES_PER_COMPONENT
      ? `error (${fi} images, max ${LIMITS.MAX_IMAGES_PER_COMPONENT})`
      : fi > 0
        ? `complete (${fi})`
        : bi > 0 || oi > 0
          ? "pending"
          : "n/a";
  c.images_taken = oi > 0 ? `complete (${oi})` : fi > 0 ? "n/a (final done)" : "pending";
  c.bg_removed =
    bi > 0
      ? bi >= oi || fi > 0
        ? `complete (${bi})`
        : `pending (${bi}/${oi})`
      : fi > 0
        ? "n/a (final done)"
        : oi > 0
          ? "pending"
          : "n/a";

  c.video_final =
    fv > 1 ? `error (${fv} videos, seeder takes first)` : fv === 1 ? "complete" : ov > 0 || bv > 0 ? "pending" : "n/a";
  c.video_taken = ov > 0 ? "complete" : fv > 0 ? "n/a (final done)" : "n/a";
  c.video_bg_removed = bv > 0 ? "complete" : fv > 0 ? "n/a (final done)" : ov > 0 ? "pending" : "n/a";

  c.captions = caps > 0 ? "complete" : fv > 0 ? "pending" : "n/a";
  c.audio = mp3 > 0 ? "complete" : fv > 0 ? "pending" : "n/a";

  c.summary_txt =
    rec.txtState === "ok"
      ? "complete"
      : rec.txtState === "empty"
        ? "pending (empty)"
        : rec.txtState === "multiple"
          ? `error (${rec.txtFiles.length} files, seeder takes first)`
          : "pending (missing)";

  c.meta_json =
    rec.meta.state === "missing"
      ? "pending (missing, run meta_generator)"
      : rec.meta.state === "invalid"
        ? "error (invalid json)"
        : rec.validation.length > 0
          ? `error (${formatIssues(rec.validation)})`
          : "complete";

  return c;
}

export function cellState(v) {
  return v.split(/[ (:]/)[0]; // complete | pending | n/a | error
}

// ─── Seeder prediction (runSeed.ts order) ────────────────────────────────────

export function seedStatus(rec) {
  if (rec.meta.state === "missing") return "n/a: no meta.json (seeder will not see this folder)";
  if (rec.meta.state === "invalid") return `error: ${rec.meta.error}`;
  if (rec.txtState === "missing") return `pending: ${SEED_REASONS.NO_TXT}`;
  if (rec.txtState === "empty") return `pending: ${SEED_REASONS.EMPTY_TXT}`;

  // Seeder view: final/audio by case-insensitive name only (typos invisible).
  const fin = rec.subdirs.final?.matchKind !== "typo" ? rec.subdirs.final : null;
  if (!fin) return `pending: ${SEED_REASONS.NO_FINAL}`;
  const n = fin.images.length;
  if (n === 0) return `pending: ${SEED_REASONS.NO_IMAGES}`;
  if (n > LIMITS.MAX_IMAGES_PER_COMPONENT) return `error: ${SEED_REASONS.tooManyImages(n)}`;

  const aud = rec.subdirs.audio?.matchKind !== "typo" ? rec.subdirs.audio : null;
  if (fin.videos.length > 0 && !(aud && aud.captions.length > 0)) {
    return `pending: ${aud ? SEED_REASONS.VIDEO_NO_CAPTION : SEED_REASONS.VIDEO_NO_AUDIO_DIR}`;
  }

  if (rec.validation.length > 0) return `error: ${formatIssues(rec.validation)}`;
  return "complete";
}

// ─── Issues (never blocking) ─────────────────────────────────────────────────

export function buildTreeIndex(records) {
  const titles = new Map();
  const names = new Map();
  for (const r of records) {
    const t = r.meta.data ? String(r.meta.data.title_hpc ?? "").trim().toLowerCase() : "";
    if (t) titles.set(t, [...(titles.get(t) ?? []), r.rel]);
    const n = r.name.toLowerCase();
    names.set(n, [...(names.get(n) ?? []), r.rel]);
  }
  return { titles, names };
}

export function leafIssues(rec, index) {
  const out = [];
  const s = rec.subdirs;
  const m = rec.meta.data;

  for (const c of rec.caseIssues) out.push(`folder case: ${c.actual} -> ${c.expected}`);
  for (const t of rec.typos) out.push(`folder typo: ${t.actual} -> ${t.expected}`);
  for (const e of rec.extraSubdirs) out.push(`extra subfolder: ${e}`);
  for (const key of ["final", "original", "bgRemoved", "audio"]) {
    const sub = s[key];
    if (sub?.hiddenDirs.some((h) => /^\.__capcut/.test(h))) out.push(`capcut temp folder in ${sub.actualName}/`);
  }
  if (rec.hiddenRootDirs.some((h) => /^\.__capcut/.test(h))) out.push("capcut temp folder at root");

  if (!s.final && m) out.push("meta.json but no final/");
  if (s.final && !m && rec.meta.state === "missing") out.push("no meta.json (run meta_generator)");
  // Missing working folders only matter while there is still work upstream of
  // final/; once final is populated they are history, not a to-do.
  const finalImages = s.final?.images.length ?? 0;
  const finalVideos = s.final?.videos.length ?? 0;
  if (!s.original && finalImages === 0) out.push("no original/");
  if (!s.bgRemoved && finalImages === 0) out.push("no bg_removed/");
  if (!s.audio && finalVideos > 0) out.push("no audio/");

  if (m) {
    if (m.domain_hpc !== rec.domain) out.push(`meta domain_hpc ${m.domain_hpc} != folder domain ${rec.domain}`);
    for (const [level, folderVal] of Object.entries(rec.levels)) {
      if (folderVal === null) continue;
      const fv = String(folderVal).toLowerCase();
      const mv = m[level] === null || m[level] === undefined ? null : String(m[level]).toLowerCase();
      if (mv !== null && mv !== fv) out.push(`folder ${level} ${folderVal} != meta ${m[level]}`);
      if (ENUMS[level] && !ENUMS[level].includes(fv)) out.push(`folder level "${folderVal}" not a valid ${level}`);
    }
    const label = folderNameToLabel(rec.name);
    const title = String(m.title_hpc ?? "").trim().toLowerCase();
    if (title && title !== label) out.push(`title_hpc "${m.title_hpc}" differs from folder label "${label}"`);
    const dupTitles = (index.titles.get(title) ?? []).filter((r) => r !== rec.rel);
    if (title && dupTitles.length) out.push(`duplicate title "${title}" also at ${dupTitles.join(", ")}`);
  } else {
    for (const [level, folderVal] of Object.entries(rec.levels)) {
      if (folderVal !== null && ENUMS[level] && !ENUMS[level].includes(String(folderVal).toLowerCase()))
        out.push(`folder level "${folderVal}" not a valid ${level}`);
    }
  }
  const dupNames = (index.names.get(rec.name.toLowerCase()) ?? []).filter((r) => r !== rec.rel);
  if (dupNames.length) out.push(`duplicate folder name also at ${dupNames.join(", ")}`);

  const oi = s.original?.images.length ?? 0;
  const bi = s.bgRemoved?.images.length ?? 0;
  const fi = s.final?.images.length ?? 0;
  const ov = s.original?.videos.length ?? 0;
  const fv = s.final?.videos.length ?? 0;
  if (bi > 0 && fi === 0) out.push(`${bi} images in bg_removed but none in final (copy to final)`);
  if (s.original && s.bgRemoved && oi > bi && fi === 0) out.push(`${oi - bi} originals not yet bg-removed`);
  if (ov > 0 && fv === 0) out.push("video in original but none in final");
  if (fv > 1) out.push(`${fv} videos in final (seeder takes first)`);
  if (s.final?.other.length) out.push(`stray files in final: ${s.final.other.join(", ")}`);
  if (s.final?.captions.length) out.push(`caption file in final/ (seeder reads audio/): ${s.final.captions.join(", ")}`);
  if (s.audio?.videos.length) out.push(`.mp4 in audio/: ${s.audio.videos.join(", ")}`);
  if (rec.markedDefaults.length > 1)
    out.push(`${rec.markedDefaults.length} images marked (d): ${rec.markedDefaults.join(", ")} (seeder uses ${rec.markedDefaults[0]})`);
  if (rec.markedOutsideFinal.length) out.push(`(d) image outside final/: ${rec.markedOutsideFinal.join(", ")}`);
  if (rec.txtFiles.length > 1) out.push(`${rec.txtFiles.length} .txt files at root (seeder takes ${rec.txtFiles[0]})`);

  return out;
}

/** Work remaining for one record: pipeline cells that are pending or error. */
export function todoItems(cells) {
  return PIPELINE_COLUMNS.filter((col) => {
    const st = cellState(cells[col]);
    return st === "pending" || st === "error";
  }).map((col) => `${col} ${cells[col]}`);
}
