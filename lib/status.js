// Scan the asset tree and compute everything the status outputs are built from:
// per-component rows (cells, seed status, issues, to-do), the per-file groups,
// the overview counts and the to-do list. Read-only. Shared by
// component_status.js (CSV + report), lib/html.js (dashboard page) and
// dashboard.js (live server).

import fs from "node:fs";
import path from "node:path";

import { ASSET_SUBFOLDERS, collectLeaves, rawDirents, skippedEntries } from "./tree.js";
import { DOMAIN_CONFIGS } from "./domains.js";
import {
  isStatusLeaf,
  scanLeaf,
  computeCells,
  cellState,
  seedStatus,
  buildTreeIndex,
  leafIssues,
  todoItems,
  PIPELINE_COLUMNS,
} from "./leaf.js";

export { PIPELINE_COLUMNS, cellState };

export const QUALITY_COLUMNS = {
  exercise: ["body_part", "exercise_type", "contraction_type", "equipment"],
  splint: ["splint_type", "primary_joint_location"],
  education: ["education_type", "education_path_type"],
  soft_tissue: ["soft_tissue_type"],
};

export const TODO_LABELS = {
  images_taken: "Needs photos taken",
  bg_removed: "Needs background removal",
  images_final: "Needs final images",
  video_taken: "Needs video",
  video_bg_removed: "Needs video edit (bg_removed)",
  video_final: "Needs final video",
  captions: "Needs captions",
  audio: "Needs audio",
  summary_txt: "Needs summary text",
  meta_json: "Needs meta.json",
};

export const OVERVIEW_HEADER = ["file", "domain", "exercise_type", "total", "complete", "pending", "error", "n/a", "with_issues"];
export const TODO_HEADER = ["component", "path", "domain", "exercise_type", "next_step", "seed_status", "todo", "issues"];

export function qualityValue(r, col) {
  const m = r.rec.meta.data;
  if (m && m[col] !== undefined && m[col] !== null) return String(m[col]);
  if (r.rec.levels[col] !== undefined && r.rec.levels[col] !== null) return String(r.rec.levels[col]);
  return "";
}

export function fileHeader(domain) {
  return ["component", "path", ...QUALITY_COLUMNS[domain], "title", ...PIPELINE_COLUMNS, "seed_status", "issues"];
}

export function fileRow(r, domain) {
  return [
    r.rec.name,
    r.rec.rel,
    ...QUALITY_COLUMNS[domain].map((c) => qualityValue(r, c)),
    r.rec.meta.data ? String(r.rec.meta.data.title_hpc ?? "") : "",
    ...PIPELINE_COLUMNS.map((c) => r.cells[c]),
    r.seed,
    r.issues.join("; "),
  ];
}

// Everything a component needs a look at: pending/error cells, a non-complete
// seed_status, and every issue.
export function fullTodo(r) {
  const items = [...r.todo];
  const seedState = cellState(r.seed);
  if (seedState === "error") items.push(`seed ${r.seed}`);
  else if (seedState === "pending" && items.length === 0) items.push(`seed ${r.seed}`);
  for (const i of r.issues) items.push(`issue: ${i}`);
  return items;
}

const issueOnly = (r) => r.allTodo.every((i) => i.startsWith("issue:"));
export function todoOrder(a, b) {
  return (
    Number(issueOnly(a)) - Number(issueOnly(b)) ||
    a.allTodo.length - b.allTodo.length ||
    a.rec.rel.localeCompare(b.rec.rel)
  );
}

export function scanTree(rootDir) {
  const notes = { tree: [], warnings: [], errors: [], skipped: [] };
  const records = [];

  for (const [domainKey, config] of Object.entries(DOMAIN_CONFIGS)) {
    const domainDir = path.join(rootDir, domainKey);
    if (!fs.existsSync(domainDir) || !fs.statSync(domainDir).isDirectory()) {
      notes.warnings.push(`[${domainKey}] domain folder not found: ${domainDir}`);
      continue;
    }
    const leaves = [];
    collectLeaves(domainDir, leaves, isStatusLeaf);
    if (leaves.length === 0) notes.tree.push(`[${domainKey}] no component folders found`);
    for (const leaf of leaves) {
      try {
        records.push(scanLeaf(leaf, domainKey, config, rootDir));
      } catch (err) {
        notes.errors.push(`[${domainKey}] ${path.relative(rootDir, leaf)} — ${err.message}`);
      }
    }
    // Level folders that lead nowhere (e.g. an empty education/education/).
    const ancestors = new Set();
    for (const leaf of leaves) {
      let d = path.dirname(leaf);
      while (d.startsWith(domainDir) && d !== domainDir) {
        ancestors.add(d);
        d = path.dirname(d);
      }
    }
    const leafSet = new Set(leaves);
    const walk = (dir) => {
      for (const s of skippedEntries(dir)) notes.skipped.push(path.relative(rootDir, path.join(dir, s)));
      for (const e of rawDirents(dir)) {
        if (!e.isDirectory() || e.name.startsWith(".") || ASSET_SUBFOLDERS.has(e.name.toLowerCase())) continue;
        const p = path.join(dir, e.name);
        if (leafSet.has(p)) continue;
        if (!ancestors.has(p)) notes.tree.push(`[${domainKey}] empty level folder (no components): ${path.relative(rootDir, p)}`);
        else walk(p);
      }
    };
    walk(domainDir);
  }
  for (const e of rawDirents(rootDir)) {
    if (e.isDirectory() && !e.name.startsWith(".") && !(e.name in DOMAIN_CONFIGS))
      notes.tree.push(`top-level folder is not a domain (ignored): ${e.name}`);
  }
  for (const s of skippedEntries(rootDir)) notes.skipped.push(s);
  // Skipped entries inside leaves, for the note only.
  for (const leaf of records.map((r) => r.dir)) {
    for (const s of skippedEntries(leaf)) notes.skipped.push(path.relative(rootDir, path.join(leaf, s)));
    for (const sub of rawDirents(leaf)) {
      if (!sub.isDirectory()) continue;
      for (const s of skippedEntries(path.join(leaf, sub.name)))
        notes.skipped.push(path.relative(rootDir, path.join(leaf, sub.name, s)));
    }
  }
  if (notes.skipped.length) notes.tree.push(`skipped (.skip in name): ${notes.skipped.length} — ${notes.skipped.join(", ")}`);

  const index = buildTreeIndex(records);
  const rows = records.map((rec) => {
    const cells = computeCells(rec);
    const r = { rec, cells, seed: seedStatus(rec), issues: leafIssues(rec, index), todo: todoItems(cells) };
    r.allTodo = fullTodo(r);
    return r;
  });

  // Groups: one per output file, keyed by file name.
  const groups = new Map();
  const ensure = (file, domain, exerciseType) => {
    if (!groups.has(file)) groups.set(file, { file, domain, exerciseType, rows: [] });
    return groups.get(file);
  };
  for (const d of ["splint", "education", "soft_tissue"]) ensure(`${d}.csv`, d, "");
  for (const r of rows) {
    if (r.rec.domain === "exercise") {
      const t = String(r.rec.levels.exercise_type ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
      ensure(`exercise_${t}.csv`, "exercise", t).rows.push(r);
    } else {
      ensure(`${r.rec.domain}.csv`, r.rec.domain, "").rows.push(r);
    }
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => {
      const ka = `${qualityValue(a, "body_part")}|${a.rec.name.toLowerCase()}`;
      const kb = `${qualityValue(b, "body_part")}|${b.rec.name.toLowerCase()}`;
      return ka.localeCompare(kb);
    });
  }
  const sortedGroups = [...groups.values()].sort((a, b) => a.file.localeCompare(b.file));

  // Overview counts by seed_status state.
  const totals = { total: 0, complete: 0, pending: 0, error: 0, "n/a": 0, with_issues: 0 };
  const overviewRows = [];
  for (const g of sortedGroups) {
    const c = { total: g.rows.length, complete: 0, pending: 0, error: 0, "n/a": 0, with_issues: 0 };
    for (const r of g.rows) {
      c[cellState(r.seed)]++;
      if (r.issues.length) c.with_issues++;
    }
    for (const k of Object.keys(totals)) totals[k] += c[k];
    g.counts = c;
    overviewRows.push([g.file, g.domain, g.exerciseType, c.total, c.complete, c.pending, c.error, c["n/a"], c.with_issues]);
  }
  overviewRows.push(["TOTAL", "", "", totals.total, totals.complete, totals.pending, totals.error, totals["n/a"], totals.with_issues]);

  // To-do: real asset work first (rows whose only items are issues go last),
  // then fewest items first.
  const todoRowsSorted = rows.filter((r) => r.allTodo.length > 0).sort(todoOrder);
  const todoRows = todoRowsSorted.map((r) => [
    r.rec.name,
    r.rec.rel,
    r.rec.domain,
    qualityValue(r, "exercise_type"),
    r.allTodo[0],
    r.seed,
    r.allTodo.join("; "),
    r.issues.join("; "),
  ]);

  // Grouped by task for the console / page summary.
  const byTask = new Map();
  for (const r of rows) {
    for (const col of PIPELINE_COLUMNS) {
      if (cellState(r.cells[col]) === "pending") {
        if (!byTask.has(col)) byTask.set(col, []);
        byTask.get(col).push(r.rec.rel);
      }
    }
  }

  return {
    rootDir,
    scannedAt: new Date(),
    rows,
    groups: sortedGroups,
    overviewRows,
    totals,
    todoRows,
    todoRowsSorted,
    byTask,
    notes,
  };
}
