// Domain configuration and meta.json builders shared by meta_generator.js and
// add_components.js. Moved verbatim out of meta_generator.js; the only
// behavioural additions are the `aarom` case and the optional `opts` argument on
// buildExerciseMeta, both inert for the generator's existing folders.

import { ASSET_SUBFOLDERS } from "./tree.js";

// ─── Edit these to change the defaults written to each meta.json ──────────────
export const DEFAULTS_AROM = {
  reps_value: 20,
  reps_units: "Repetitions",
  hold_value: 5,
  hold_units: "seconds",
  frequency_value: 3,
  frequency_units: "times per day",
};

export const DEFAULTS_RESISTANCE = {
  reps_value: 10,
  reps_units: "Repetitions",
  sets_value: 3,
  sets_units: "sets",
  frequency_value: 1,
  frequency_units: "times per day",
};

// Misc (proprioception, weight bearing, anything uncategorised): timed work.
export const DEFAULTS_MISC = {
  perform_for_value: 60,
  perform_for_units: "seconds",
  sets_value: 3,
  sets_units: "sets",
  frequency_value: 2,
  frequency_units: "times per day",
};

export const DEFAULTS_STRETCH = {
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
export const DEFAULTS_RESISTANCE_ISOMETRIC = {
  hold_value: 45,
  hold_units: "seconds",
  sets_value: 5,
  sets_units: "sets",
  frequency_value: 1,
  frequency_units: "times per day",
};

export const DEFAULTS_SPLINT_STATIC = {
  wearing_schedule: "full time except showering",
  wear_for_value: 6,
  wear_for_units: "weeks",
};

// wearing_time_units must be exactly WEARING_TIME_UNITS ("hours per day").
export const DEFAULTS_SPLINT_MOBILITY = {
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
export const SPLINT_ATTRIBUTE_TYPE_BY_TYPE = {
  static: "static",
  dynamic: "static",
  static_progressive: "mobility",
  serial_static: "mobility",
  dynamic_progressive: "mobility",
};

export function folderNameToLabel(name) {
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
export function detectEquipment(folderName) {
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

export function buildBase(domain, name) {
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

// `opts` lets add_components.js pass values it knows explicitly (from the intake
// row) instead of sniffing them from the folder name: `opts.equipment` (null for
// none) and `opts.contractionType` ("isotonic" | "isometric"). Omitted → the
// generator's name-based behaviour, unchanged.
export function buildExerciseMeta(levels, name, opts = {}) {
  const base = {
    ...buildBase("exercise", name),
    body_part: levels.body_part ?? null,
    equipment: "equipment" in opts ? opts.equipment : detectEquipment(name),
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
    // Active-assisted range of motion: a real `exerciseTypes` value the generator
    // never had a folder for. Dosed like arom.
    case "aarom":
      return {
        ...base,
        attribute_type: "arom",
        exercise_type: "aarom",
        ...DEFAULTS_AROM,
      };
    case "resistance": {
      // contraction_type is required for resistance by the app's create
      // schema and picks the dosage. Inferred from the folder name: anything
      // mentioning "isometric" is isometric (45 s hold, 5 sets, once a day),
      // the rest isotonic (reps, sets, frequency). Hand-edit when the name
      // does not say. Four fields is the app's maximum per component.
      const isometric = opts.contractionType
        ? opts.contractionType === "isometric"
        : /isometric/i.test(name);
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
    // Weight bearing, proprioception: timed. Same dosage hthp suggests for misc
    // (EXERCISE_SUGGESTIONS in shared/src/taxonomy/components/attributeFields.ts).
    case "misc":
      return {
        ...base,
        attribute_type: "misc",
        exercise_type: "misc",
        ...DEFAULTS_MISC,
      };
    default:
      return null;
  }
}

export function buildSplintMeta(levels, name) {
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

export function buildEducationMeta(levels, name) {
  return {
    ...buildBase("education", name),
    attribute_type: null,
    education_type: levels.education_type ?? null,
    education_path_type: levels.education_path_type ?? null,
  };
}

export function buildSoftTissueMeta(levels, name) {
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

export const DOMAIN_CONFIGS = {
  Exercise: {
    domain: "exercise",
    levels: ["body_part", "exercise_type"],
    buildMeta: buildExerciseMeta,
  },
  splint: {
    domain: "splint",
    levels: ["splint_type", "primary_joint_location"],
    buildMeta: buildSplintMeta,
  },
  education: {
    domain: "education",
    levels: ["education_type", "education_path_type"],
    buildMeta: buildEducationMeta,
  },
  soft_tissue: {
    domain: "soft_tissue",
    levels: ["soft_tissue_type"],
    buildMeta: buildSoftTissueMeta,
  },
};

// Top-level folder name under the assets root for each domain_hpc value. Note
// `Exercise` is capitalised on disk; the others are lowercase.
export const DOMAIN_FOLDER_BY_DOMAIN = Object.fromEntries(
  Object.entries(DOMAIN_CONFIGS).map(([folder, cfg]) => [cfg.domain, folder]),
);

// Re-exported so callers that need the leaf layout alongside the configs have a
// single import.
export { ASSET_SUBFOLDERS };
