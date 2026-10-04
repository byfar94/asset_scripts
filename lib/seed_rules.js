// ─── Seeder rules, copied by hand ────────────────────────────────────────────
//
// Copied from the hthp backend on 2026-10-03 (exercise enums updated 2026-10-04):
//   shared/src/taxonomy/components/{exerciseDomain,splintDomain,educationDomain,
//     softTissueDomain,attributeFields,attributeUnits}.ts
//   shared/src/validation/components/componentMain.ts  (ComponentCreate)
//   shared/src/limits.ts
//   server/src/serviceFunctions/addComponent.ts         (quality keys per domain)
//   server/src/scripts/runSeed.ts                       (skip / fail reasons)
//
// This file is INTENTIONALLY a copy, not an import. asset_scripts and hthp are
// allowed to diverge; when the seeder changes, update this file by hand. Nothing
// in this repo reads from the hthp checkout.

export const DOMAINS = ["exercise", "splint", "education", "soft_tissue"];

export const ENUMS = {
  exercise_type: ["arom", "aarom", "prom", "resistance", "misc"],
  body_part: ["hand", "wrist", "forearm_elbow", "upper_extremity"],
  equipment: [
    "none",
    "rubber_band",
    "towel",
    "theraband",
    "theraputty",
    "dumbbell",
    "gym_equipment",
    "therapy_equipment",
  ],
  contraction_type: ["isotonic", "isometric"],
  splint_type: [
    "static",
    "dynamic",
    "static_progressive",
    "dynamic_progressive",
    "serial_static",
  ],
  primary_joint_location: ["finger", "wrist", "elbow", "shoulder"],
  education_type: ["diagnosis_education", "precaution", "assistive_device", "splint"],
  education_path_type: [
    "tendon_pathology",
    "ligament_joint_pathology",
    "peripheral_nerve_injury",
    "fracture",
    "misc",
  ],
  soft_tissue_type: ["scar_wound_management", "edema_swelling"],
};

// Values asset_scripts may CREATE before the app accepts them (added
// 2026-10-04). The add form and folder checks treat them as valid, but
// validation still mirrors the seeder, so a component using one shows as an
// error on the status sheet ("not in the app yet") and is never counted as
// ready to seed. When the app adds a value, move it into ENUMS above and delete
// it here. Empty since 2026-10-04: hthp now accepts exercise type "misc" and
// body part "upper_extremity", the two values this was added for.
export const PENDING_APP_VALUES = {};

// ENUMS plus PENDING_APP_VALUES: what the add form offers and folder checks accept.
export const CREATABLE_ENUMS = Object.fromEntries(
  Object.entries(ENUMS).map(([k, vals]) => [k, [...vals, ...(PENDING_APP_VALUES[k] ?? [])]]),
);

export const isPendingAppValue = (key, value) =>
  (PENDING_APP_VALUES[key] ?? []).includes(value);

// The fixed keys addComponent.ts reads for each domain. Anything else in
// meta.json (attribute_type, default_index, isfo/isho/iswo/iseo, …) is ignored.
export const QUALITY_KEYS_BY_DOMAIN = {
  exercise: ["exercise_type", "body_part", "equipment", "contraction_type"],
  splint: ["splint_type", "primary_joint_location"],
  education: ["education_type", "education_path_type"],
  soft_tissue: ["soft_tissue_type"],
};

// Required = must be a valid enum value. `equipment` is optional (null/"" OK);
// `contraction_type` is required only for resistance and forbidden otherwise.
export const REQUIRED_QUALITIES_BY_DOMAIN = {
  exercise: ["exercise_type", "body_part"],
  splint: ["splint_type", "primary_joint_location"],
  education: ["education_type", "education_path_type"],
  soft_tissue: ["soft_tissue_type"],
};

export const UNITS = {
  reps: ["Repetitions"],
  sets: ["sets"],
  wearing_time: ["hours per day"],
  seconds_minutes: ["seconds", "minutes"],
  wear_for: ["days", "weeks", "months"],
  frequency: [
    "times per day",
    "times per week",
    "times per month",
    "every hour",
    "every other hour",
  ],
  wearing_schedules: [
    "nighttime only",
    "daytime only",
    "full time except showering",
    "full time no exceptions",
  ],
};

// Dosage ("attribute") fields per domain. `value_units` fields are stored as
// `<key>_value` (integer within [min,max]) + `<key>_units` (one of `units`);
// `enum` fields are a single `<key>` column. Values must be integers.
export const DOSAGE_FIELDS_BY_DOMAIN = {
  exercise: [
    { key: "reps", label: "Repetitions", kind: "value_units", min: 0, max: 49, units: UNITS.reps },
    { key: "perform_for", label: "Perform for", kind: "value_units", min: 0, max: 60, units: UNITS.seconds_minutes },
    { key: "hold", label: "Hold", kind: "value_units", min: 0, max: 60, units: UNITS.seconds_minutes },
    { key: "sets", label: "Sets", kind: "value_units", min: 0, max: 10, units: UNITS.sets },
    { key: "frequency", label: "Frequency", kind: "value_units", min: 0, max: 10, units: UNITS.frequency },
  ],
  splint: [
    { key: "wearing_schedule", label: "Wearing schedule", kind: "enum", options: UNITS.wearing_schedules },
    { key: "wearing_time", label: "Hours per day", kind: "value_units", min: 1, max: 24, units: UNITS.wearing_time },
    { key: "wear_for", label: "Wear for", kind: "value_units", min: 1, max: 365, units: UNITS.wear_for },
  ],
  soft_tissue: [
    { key: "perform_for", label: "Perform for", kind: "value_units", min: 0, max: 60, units: UNITS.seconds_minutes },
    { key: "frequency", label: "Frequency", kind: "value_units", min: 0, max: 10, units: UNITS.frequency },
  ],
  education: [],
};

export const LIMITS = {
  TITLE_MAX: 100,
  DOC_MAX: 300,
  SUMMARY_MAX: 1500,
  PRIORITY_MIN: 1,
  PRIORITY_MAX: 10,
  MAX_IMAGES_PER_COMPONENT: 4,
  MAX_DOSAGE_FIELDS: 4,
};

// Skip reasons (seeder logs "skipped — <reason>" and moves on) and fail
// reasons (seeder logs "✗ <folder>: <reason>"), verbatim from runSeed.ts.
export const SEED_REASONS = {
  NO_TXT: "no .txt summary file",
  EMPTY_TXT: ".txt summary file is empty",
  NO_FINAL: 'no "final" subfolder',
  NO_IMAGES: "no image files in final/",
  tooManyImages: (n) => `too many images (${n}) — max is ${LIMITS.MAX_IMAGES_PER_COMPONENT}`,
  VIDEO_NO_CAPTION: "video in final/ but no caption file in audio/",
  VIDEO_NO_AUDIO_DIR: "video in final/ but no audio/ folder",
};
