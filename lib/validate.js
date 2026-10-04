// Mirrors the seeder's zod validation (ComponentCreate + the input shape built in
// addComponent.ts) using the rules copied into seed_rules.js. Messages follow
// zod 4's wording so a status row reads the same as a seed failure would.

import {
  DOMAINS,
  ENUMS,
  QUALITY_KEYS_BY_DOMAIN,
  REQUIRED_QUALITIES_BY_DOMAIN,
  DOSAGE_FIELDS_BY_DOMAIN,
  LIMITS,
  CREATABLE_ENUMS,
  isPendingAppValue,
} from "./seed_rules.js";

const optionList = (vals) => vals.map((v) => `"${v}"`).join("|");
const invalidOption = (vals) => `Invalid option: expected one of ${optionList(vals)}`;
const received = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const present = (v) => v !== undefined && v !== null && v !== "";

function checkString(push, path, value, { min, max, optional = false }) {
  if (value === undefined && optional) return;
  if (typeof value !== "string") {
    push(path, `Invalid input: expected string, received ${received(value)}`);
    return;
  }
  const t = value.trim();
  if (min !== undefined && t.length < min)
    push(path, `Too small: expected string to have >=${min} characters`);
  if (max !== undefined && t.length > max)
    push(path, `Too big: expected string to have <=${max} characters`);
}

// z.coerce.number().int().min().max()
function checkCoercedInt(push, path, value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    push(path, "Invalid input: expected number, received NaN");
    return;
  }
  if (!Number.isInteger(n)) push(path, "Invalid input: expected int, received number");
  if (n < min) push(path, `Too small: expected number to be >=${min}`);
  if (n > max) push(path, `Too big: expected number to be <=${max}`);
}

function validateQualities(push, domain, fields) {
  const keys = QUALITY_KEYS_BY_DOMAIN[domain];
  const q = Object.fromEntries(keys.map((k) => [k, fields[k]]));
  let typeErrors = 0;

  for (const k of REQUIRED_QUALITIES_BY_DOMAIN[domain]) {
    if (!ENUMS[k].includes(q[k])) {
      push(
        `qualities.${k}`,
        isPendingAppValue(k, q[k])
          ? `"${q[k]}" is not in the app yet — add it to the app before seeding`
          : invalidOption(ENUMS[k]),
      );
      typeErrors++;
    }
  }

  if (domain === "exercise") {
    // equipment: "" | enum | absent
    if (q.equipment !== undefined && q.equipment !== "" && !ENUMS.equipment.includes(q.equipment)) {
      push("qualities.equipment", "Invalid input");
      typeErrors++;
    }
    const ct = q.contraction_type;
    if (present(ct) && !ENUMS.contraction_type.includes(ct)) {
      push("qualities.contraction_type", "Invalid input");
      typeErrors++;
    }
    // Cross-field rules only run once the field types are clean (zod ordering).
    if (typeErrors === 0) {
      if (q.exercise_type === "resistance" && !present(ct)) {
        push(
          "qualities.contraction_type",
          "contraction_type (isotonic or isometric) is required for resistance",
        );
      } else if (q.exercise_type !== "resistance" && present(ct)) {
        push(
          "qualities.contraction_type",
          `contraction_type only applies to resistance, not ${q.exercise_type}`,
        );
      }
    }
  }
}

// pickAttributeColumns: only this domain's columns, dropping ""/null/undefined.
export function pickAttributeColumns(domain, fields) {
  const out = {};
  for (const f of DOSAGE_FIELDS_BY_DOMAIN[domain] ?? []) {
    const cols = f.kind === "enum" ? [f.key] : [`${f.key}_value`, `${f.key}_units`];
    for (const c of cols) if (present(fields[c])) out[c] = fields[c];
  }
  return out;
}

function validateAttributes(push, domain, fields) {
  const attrs = pickAttributeColumns(domain, fields);
  let count = 0;
  for (const f of DOSAGE_FIELDS_BY_DOMAIN[domain] ?? []) {
    if (f.kind === "enum") {
      if (f.key in attrs) {
        count++;
        if (!f.options.includes(attrs[f.key]))
          push(`attributes.${f.key}`, invalidOption(f.options));
      }
      continue;
    }
    const vKey = `${f.key}_value`;
    const uKey = `${f.key}_units`;
    const hasV = vKey in attrs;
    const hasU = uKey in attrs;
    if (!hasV && !hasU) continue;
    count++;
    if (hasV) checkCoercedInt(push, `attributes.${vKey}`, attrs[vKey], f.min, f.max);
    if (hasU && !f.units.includes(attrs[uKey])) {
      push(
        `attributes.${uKey}`,
        f.units.length === 1
          ? `Invalid input: expected "${f.units[0]}"`
          : invalidOption(f.units),
      );
    }
    if (hasV !== hasU) {
      push(`attributes.${hasV ? uKey : vKey}`, `${f.label} needs both a value and units`);
    }
  }
  if (count > LIMITS.MAX_DOSAGE_FIELDS) {
    push("attributes", `A component can have at most ${LIMITS.MAX_DOSAGE_FIELDS} dosage fields`);
  }
}

/**
 * Validate a parsed meta.json plus its summary text the way the seeder would.
 * Returns an array of "path: message" strings (empty when valid). Join with
 * "; " to get the seeder's formatValidationIssues output.
 */
export function validateMeta(meta, summaryText) {
  const issues = [];
  const push = (path, message) => issues.push(path ? `${path}: ${message}` : message);

  // toFormFields in runSeed.ts: only equipment null → "".
  const fields = { ...meta, summary_hpc: summaryText };
  if (fields.equipment === null) fields.equipment = "";
  // runSeed.ts normalises the title before validation.
  fields.title_hpc = String(meta.title_hpc ?? "").trim().toLowerCase();

  checkString(push, "title_hpc", fields.title_hpc, { min: 1, max: LIMITS.TITLE_MAX });
  checkString(push, "summary_hpc", fields.summary_hpc, { min: 1, max: LIMITS.SUMMARY_MAX });
  checkString(push, "documentation_hpc", fields.documentation_hpc, {
    max: LIMITS.DOC_MAX,
    optional: true,
  });
  checkCoercedInt(push, "priority_hpc", fields.priority_hpc, LIMITS.PRIORITY_MIN, LIMITS.PRIORITY_MAX);

  const domain = fields.domain_hpc;
  if (!DOMAINS.includes(domain)) {
    push("domain_hpc", invalidOption(DOMAINS));
    return issues;
  }

  validateQualities(push, domain, fields);
  validateAttributes(push, domain, fields);
  return issues;
}

export function formatIssues(issues) {
  return issues.join("; ");
}

/**
 * Validate one intake-CSV row for add_components.js. `row` is an object keyed
 * by column name with trimmed string values ("" when blank). Returns an array
 * of "column: message" strings.
 */
export function validateIntakeRow(row) {
  const errors = [];
  const push = (col, msg) => errors.push(`${col}: ${msg}`);

  if (!row.name) push("name", "is required");

  const domain = (row.domain ?? "").toLowerCase();
  if (!DOMAINS.includes(domain)) {
    push("domain", invalidOption(DOMAINS));
    return errors;
  }

  for (const k of REQUIRED_QUALITIES_BY_DOMAIN[domain]) {
    if (!CREATABLE_ENUMS[k].includes(row[k])) push(k, invalidOption(CREATABLE_ENUMS[k]));
  }

  if (domain === "exercise") {
    if (row.equipment && !ENUMS.equipment.includes(row.equipment))
      push("equipment", invalidOption(ENUMS.equipment));
    const ct = row.contraction_type;
    if (ct && !ENUMS.contraction_type.includes(ct))
      push("contraction_type", invalidOption(ENUMS.contraction_type));
    else if (row.exercise_type === "resistance" && !ct)
      push("contraction_type", "contraction_type (isotonic or isometric) is required for resistance");
    else if (row.exercise_type !== "resistance" && ct && CREATABLE_ENUMS.exercise_type.includes(row.exercise_type))
      push("contraction_type", `contraction_type only applies to resistance, not ${row.exercise_type}`);
  }

  // Quality columns that belong to another domain must be blank.
  const mine = new Set(QUALITY_KEYS_BY_DOMAIN[domain]);
  for (const k of Object.keys(ENUMS)) {
    if (!mine.has(k) && row[k]) push(k, `does not apply to ${domain}`);
  }

  return errors;
}
