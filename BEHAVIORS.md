# Script Behaviors

Gotchas worth knowing before running anything. All four scripts walk
`~/Documents/Hand_Theracraft/Component_assets` and write a `report-<timestamp>.md`
into the **current working directory**.

## All scripts

- **`.skip` parks anything.** A file or folder named `<name>.skip` or
  `<name>.skip.<ext>` (e.g. `old_take.skip.mp4`, `scratch_folder.skip.`) is
  invisible to every script here: not a component, not an asset, not an issue,
  never sent to remove.bg, never converted. The status report lists what was
  skipped under "Tree notes". Note the hthp seeder has no such rule — it only
  ignores dot-prefixed names — so a `.skip` folder that still holds a
  `meta.json` would still be seeded; keep parked folders free of `meta.json`
  or ask for the seeder to learn the rule.

- **No database awareness.** Nothing here connects to the DB or checks whether a
  component already exists. Duplicate protection on seeding is entirely the
  backend seeder's business.
- **Almost no asset validation.** Duplicate titles, missing `.txt` summaries,
  and empty `final/` folders are not detected — they surface at seed time. The
  one exception is the missing-caption check in `meta_generator.js` below.
- Failures are per-item: one bad folder is reported and the run continues.

## meta_generator.js

- **Never overwrites an existing `meta.json`.** Default mode is create-if-missing;
  existing files are reported as skipped.
- **Never renames, moves, or deletes anything.** The only write is `meta.json`.
- **Titles come from the component folder name, not from filenames.** Renaming
  files inside `final/` has no effect on any field.
- **A rename does not refresh an existing title.** Because existing files are
  skipped, `title_hpc` stays frozen until you run `--retitle`.
- `--retitle` rewrites **only** `title_hpc` and `documentation_hpc` from the
  folder name; every other field, key order included, is preserved. It is
  idempotent — and it will flatten hand-tuned titles that intentionally differ
  from the folder name, so preview with `--dry-run` first.
- `--dry-run` writes nothing but still produces the report.
- A component leaf is any folder containing `final/`. Folder depth is flexible;
  intermediate folders map positionally to quality fields per `DOMAIN_CONFIGS`.
- Unrecognized type folders produce a **warning and no file**, not a guess.
  A missing domain folder is a warning, not an error.
- Fields the folder structure can't supply are written as `null`/placeholders and
  must be hand-edited before seeding. NOT NULL quality fields missing at seed
  time hard-fail the seed.
- Splint booleans (`isfo`/`isho`/`iswo`/`iseo`) are written as **quoted strings**
  (`"false"`) on purpose — the backend's `parseAndValidateBool` throws on a JSON
  boolean. Keep them quoted when hand-editing.
- **The default image is chosen by filename, not by `meta.json`.** Put `(d)` in
  one image's name inside `final/` — the seeder picks the first image whose name
  contains it, else index 0. This script writes no `default_index` key; older
  files still carry one and the seeder has always ignored it, so a file saying
  `0` while a `(d)` name selected index 2 was simply wrong.
- **Warns when more than one image in `final/` is marked `(d)`.** Reported under
  "Ambiguous default image", and never blocking — the seeder still creates the
  component, taking the first marked image in sort order. The warning exists
  because that pick is silent and depends on sort order rather than on anything
  you chose. Images only: a `(d)` in a video filename is not a marker. Runs on
  every leaf regardless of `--dry-run`, `--retitle`, or an existing `meta.json`.
- **Warns when a component has a video in `final/` but no caption in `audio/`.**
  Reported under "Videos missing captions" in the report and counted in the
  console summary. Report-only — it never blocks `meta.json` creation, and it
  runs on every leaf regardless of `--dry-run`, `--retitle`, or whether a
  `meta.json` already exists. Only `final/` counts; videos left in `original/`
  or `bg_removed/` are ignored. Captions are matched by extension (`.srt`,
  `.vtt`), not by name, because the naming in `audio/` is inconsistent.
  **The backend seeder skips these components outright** — they will not be
  created until a caption file exists, so treat this section as a to-do list
  before seeding. User-uploaded components may have a video without captions;
  this expectation applies only to admin components.
- `--folder <path>` overrides the assets root; useful for testing on a copy.

## meta_remap.js

Run with `npm run remap:dry` first, then `npm run remap`.

- **Rewrites one key, by name.** The field, old value and new value are the
  `REMAP` const at the top of the file — edit that, not a CLI flag. Matching is
  on `meta[field] === from`, never on searching the file for a string.
- **`REMAP` is blank between jobs and the script exits 1 while it is.** Fill it
  in, dry-run, run, then blank it again. That is what stops a finished migration
  re-firing because someone ran the command out of habit. `field` is any
  top-level meta.json key, so the script is general — the header lists the jobs
  it has run.
- **`attribute_type` cannot be remapped by this script.** `FORBIDDEN_FIELDS`
  makes it exit 1. Every meta.json with `exercise_type: "stretch"` also has
  `attribute_type: "stretch"`, and only the first was renamed to `prom` — the
  dosage still lives in `hpc_schedule_attributes_stretch` and the backend's
  `insertHpcExercise` compares `attribute_type === "stretch"` literally. A
  find/replace across these files, or lifting that guard, makes the seeder throw
  `Unsupported attribute type: prom` on every PROM component.
- **Never creates a `meta.json`.** Leaves without one are listed under "No
  meta.json" for `meta_generator.js` to handle.
- **Preserves everything else** — key order, hand-tuned dosage, the quoted splint
  booleans, keys added later. Only the one value changes.
- **Idempotent.** A second run reports every file under "Already <to>" and writes
  nothing.
- Walks the whole tree rather than per-domain, so `--folder` can point at a copy
  of a single domain. The asset tree is not under version control — rehearse on a
  `cp -R` copy before running live.
- `--dry-run` writes nothing but still produces the report.
- Files whose value is neither `from` nor `to` are counted by value in the report,
  not listed individually.

## bg_removal.js

- **Costs remove.bg API credits** — one call per image. Requires
  `REMOVE_BG_API_KEY` in `.env`; exits immediately if unset.
- Skips a component entirely if its `bg_removed/` is **non-empty**, and skips any
  individual output file that already exists. Existing outputs are never replaced.
- Will **not create** a missing `bg_removed/` folder — it warns and moves on.
- Only `.jpg`/`.jpeg` inputs. Output is flattened onto a white background.
- Root path is hardcoded; no `--folder` override.

## rtf_to_txt.js

- **Deletes the source `.rtf`** after a successful conversion. This is the only
  destructive operation in the repo, and there is no dry-run.
- **Overwrites** an existing `.txt` of the same name (via `textutil`).
- Root path is hardcoded; no `--folder` override.

## lib/

Shared code imported by `meta_generator.js`, `component_status.js` and
`add_components.js` (`meta_remap.js` still carries its own copy of
`collectLeaves`). `lib/seed_rules.js` is a **hand-maintained copy** of the
backend seeder's enum lists, dosage table, limits and skip/fail wording, dated
in its header. Nothing in this repo imports from or reads the hthp checkout —
the two are allowed to diverge; update `seed_rules.js` by hand when the seeder
changes.

## Values ahead of the app

`PENDING_APP_VALUES` in `lib/seed_rules.js` lists values asset_scripts may
create before the app accepts them. The dashboard form offers them and the
folder checks accept them, but validation still mirrors the seeder, so a
component using one shows `meta_json: error (… is not in the app yet …)` and is
never counted as ready to seed. When the app adds a value, move it from
`PENDING_APP_VALUES` into `ENUMS` and delete it from the pending list.

The list is empty. Exercise type `misc` and body part `upper_extremity` went
through it and were added to the app on 2026-10-04. Misc defaults to perform
for 60 seconds, 3 sets, 2 times a day, the same dosage the app suggests.

## component_status.js

Run with `npm run status` (writes CSVs), `npm run status:dry` or `npm run todo`
(print only).

- **Read-only on the asset tree.** The only writes are its own CSVs in
  `~/Documents/Hand_Theracraft/component_status/` and a `report-*.md` in the
  cwd. CSVs are overwritten in place; nothing is ever deleted. A CSV left over
  from an earlier run that is no longer produced is listed as stale, not removed.
- **One CSV per domain, and per exercise type** (`exercise_arom.csv`,
  `exercise_prom.csv`, `exercise_resistance.csv`, `exercise_misc.csv`,
  `splint.csv`, `education.csv`, `soft_tissue.csv`), plus `_overview.csv`
  (counts) and `_todo.csv` (every component with anything to look at: pending or
  error cells, a non-complete `seed_status`, and all `issues`, with `next_step`).
  Grouping is by the *folder-level* exercise type, so a leaf with a broken
  meta.json still lands somewhere.
- **Also writes `index.html`** next to the CSVs: the same data as a page with
  tabs, search, filters and colored cells. It is a static snapshot (regenerate
  with `npm run status`). For a live page with Finder buttons see
  `dashboard.js` below. Numbers cannot follow `file://` links, so the CSVs have
  no clickable path cell.
- **Every pipeline cell is `complete`, `pending`, `n/a` or `error`**, sometimes
  with a detail in parentheses. Filter a column on "pending" to see the work.
  Done-ness flows backwards from `final/`: once final has images, the
  `images_taken`/`bg_removed` cells read `n/a (final done)` rather than
  pending, because some final images never pass through bg_removed.
- **Video is optional.** No video in `original/` → the video/caption/audio
  cells are `n/a`, not pending.
- **`seed_status` predicts the backend seeder** in its own words:
  `pending: <skip reason>`, `error: <fail reason>`, `complete`, or
  `n/a: no meta.json` (the seeder only discovers folders with a `meta.json`).
  The seeder's "already seeded" check needs the database and is not predicted;
  duplicate titles within the tree are flagged in `issues` instead.
- **Typo folders (`aduio/`, `bm_removed/`) are counted but flagged.** The
  pipeline cell says `complete` because the file exists, while `seed_status`
  says what the seeder will actually do (it does not see `aduio/`).
- `issues` is never blocking: folder case/typos, extra subfolders, CapCut temp
  folders, folder-vs-meta mismatches, more than one video or `(d)` image in
  final, stray files, duplicate titles/folder names.
- `--folder <root>` and `--out <dir>` override the tree and output folder.
  Rehearsing on a copy with `--folder` defaults `--out` to a sibling of that
  copy, so the real CSVs are untouched.

## add_components.js

Run with `npm run add:dry` first, then `npm run add`.

- **Only ever creates.** Refuses a target folder that already exists, creates
  `meta.json` and the summary with the `wx` flag (fail-if-exists), and never
  writes inside a directory that existed before the run. Nothing under the
  asset root is deleted, renamed or overwritten.
- Reads `~/Documents/Hand_Theracraft/component_status/new_components.csv`. If it is missing a
  header-only template is written. Columns: `name, domain, body_part,
  exercise_type, contraction_type, equipment, splint_type,
  primary_joint_location, education_type, education_path_type,
  soft_tissue_type, summary, status`. `summary` is optional text for the
  component's `.txt`. Fill only the columns that apply to the domain;
  values are the app's snake_case enum values (e.g. `forearm_elbow`,
  `theraband`, `isotonic`).
- **Rows with any text in `status` are skipped forever.** The script fills
  `status` with `created <date>`, `exists: <path>` or `error: <message>`.
  Blank the cell to retry a row. The previous file is kept as
  `new_components.csv.bak`.
- **Numbers cannot save a CSV in place** — it saves `.numbers` and the script
  never sees your rows. Edit the intake file in a text editor, or File →
  Export To → CSV from Numbers.
- Folder name is the slugified `name` (lowercase, `_` between words). The
  component "exists" if a folder with that name is anywhere in the domain, or
  any `meta.json` in the whole tree already has that title.
- `meta.json` is built from the row (`contraction_type` and `equipment` are
  taken from the row, not sniffed from the name) with the same dosage defaults
  `meta_generator.js` writes. The summary `.txt` holds the `summary` column, or
  is created **empty** so the status sheet shows `summary_txt: pending (empty)`
  until you write it.
- `misc` is a valid `exercise_type` (timed dosage, see above). The
  `forearm_elbow/misc` folder on disk still seeds as `arom` because that is
  what its meta.json says.
- `--folder <root>` and `--csv <path>` override the tree and intake file.
  Rehearse on a `cp -R` copy first.


## dashboard.js

`npm run dashboard` — live status page in Chrome, with **Finder** buttons.

- Starts a tiny http server on `127.0.0.1:4848` (localhost only) and opens it in
  the default browser. Leave the terminal running; Ctrl+C stops it. `--port <n>`
  if 4848 is taken, `--no-open` to skip launching the browser, `--folder <root>`
  as usual.
- **Every page load rescans the tree**, so "Refresh (rescan)" is the only sync
  step; no CSV regeneration needed while it runs.
- **+ Add component** opens a form: name, domain, and only that domain's
  fields as dropdowns of valid values (contraction type appears only for
  resistance), an optional summary textarea, and a live preview of the folder
  it will create. Submitting posts to `/add`, which uses the same create-only
  code as `add_components.js` (`lib/add.js`): refuses existing folders/titles,
  `wx` writes, never overwrites. The page rescans afterwards.
- **Finder** asks the server to run macOS `open` on that component's folder.
  `/open` only accepts a path that resolves inside the assets root and is a
  directory; anything else is a 400. **Files** opens Chrome's own listing of the
  folder (view only). **Copy path** copies the absolute path for ⇧⌘G in Finder.
- `/add` and `/open` refuse requests whose `Origin` header is not this server,
  so another web page open in Chrome cannot drive them. Apart from `/add`
  (which only creates new component folders) the server writes nothing.
- The same page is what `component_status.js` writes to `index.html`; opened via
  `file://` it has no Finder button (Chrome cannot open Finder from a page).
