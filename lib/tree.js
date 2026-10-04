// Filesystem helpers shared by every asset script. Moved verbatim out of
// meta_generator.js; behaviour must stay identical because the generator's
// reports are diffed against a baseline whenever this file changes.

import fs from "node:fs";
import path from "node:path";

// Subfolders inside a component leaf that hold assets — never treated as domain
// hierarchy and never recursed into.
export const ASSET_SUBFOLDERS = new Set(["final", "original", "bg_removed", "audio"]);

// Kept identical to IMAGE_EXTS/VIDEO_EXTS/CAPTION_EXTS in the backend seeder
// (server/src/scripts/runSeed.ts). The seeder skips any component whose final/
// holds a video with no matching caption, so if these lists drift this script
// stops predicting what the seed will actually do.
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
export const VIDEO_EXTS = new Set([".mp4", ".mov"]);
export const CAPTION_EXTS = new Set([".srt", ".vtt"]);

// Not read by the seeder at all; tracked here only so the status sheet can show
// whether a narration file has been recorded.
export const AUDIO_EXTS = new Set([".mp3"]);

// The marker that names a component's default image. The seeder picks the first
// image in sort order whose filename contains this — there is no meta.json key
// for it.
export const DEFAULT_IMAGE_MARKER = "(d)";

// Anything named `<name>.skip` or `<name>.skip.<ext>` — file or folder — is
// invisible to every script: not a leaf, not an asset, not an issue. Rename
// something this way to park it without deleting it.
export const SKIP_RE = /\.skip(\.[^.]*)?$/i;
export function isSkipped(name) {
  return SKIP_RE.test(name);
}

export function extIn(name, exts) {
  return exts.has(path.extname(name).toLowerCase());
}

export function findSubdir(dir, name) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = entries.find(
    (e) => e.isDirectory() && !isSkipped(e.name) && e.name.toLowerCase() === name.toLowerCase(),
  );
  return found ? path.join(dir, found.name) : null;
}

// Mirrors listUsableFiles in the backend seeder: skips dotfiles (.DS_Store) and
// the `__`-prefixed scratch files that turn up in these folders.
export function listUsableFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith(".") && !n.startsWith("__") && !isSkipped(n));
  } catch {
    return [];
  }
}

// Unfiltered directory listing (dirents), for callers that need to see the
// hidden entries listUsableFiles drops — e.g. CapCut's `.__capcut_export_temp_*`
// folders. Returns [] when the directory cannot be read.
export function rawDirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !isSkipped(e.name));
  } catch {
    return [];
  }
}

// The `.skip` entries a directory holds, for reporting only.
export function skippedEntries(dir) {
  try {
    return fs.readdirSync(dir).filter(isSkipped);
  } catch {
    return [];
  }
}

// The generator's leaf rule: a component leaf is a directory that contains a
// `final/` folder.
export function hasFinalDir(entries) {
  return entries.some((e) => e.isDirectory() && e.name.toLowerCase() === "final");
}

// Recursion stops at a leaf (its asset subfolders are never treated as
// hierarchy). `isLeaf` receives the directory's dirents and defaults to the
// generator's rule above; the status script passes a broader predicate.
export function collectLeaves(dir, leaves, isLeaf = hasFinalDir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries = entries.filter((e) => !isSkipped(e.name));
  if (isLeaf(entries)) {
    leaves.push(dir);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (isSkipped(entry.name)) continue;
    if (ASSET_SUBFOLDERS.has(entry.name.toLowerCase())) continue;
    collectLeaves(path.join(dir, entry.name), leaves, isLeaf);
  }
}

export function mapLevels(levelNames, segments) {
  const out = {};
  levelNames.forEach((levelName, i) => {
    out[levelName] = segments[i] ?? null;
  });
  return out;
}
