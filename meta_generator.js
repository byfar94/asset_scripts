import fs from "node:fs";
import path from "node:path";

const ROOT_DIR =
  "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets/Exercise";

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

// ─────────────────────────────────────────────────────────────────────────────

const report = {
  created: [],
  overwritten: [],
  warnings: [],
  errors: [],
};

function folderNameToLabel(name) {
  return name.toLowerCase().replace(/_/g, " ");
}

function detectEquipment(folderName) {
  const name = folderName.toLowerCase();
  if (name.includes("rubber_band")) return "rubber_band";
  if (name.includes("theraband")) return "band";
  if (name.includes("theraputty")) return "putty";
  if (name.includes("band") && !name.includes("rubber_band")) return "band";
  if (name.includes("putty")) return "putty";
  if (name.includes("towel")) return "towel";
  if (name.includes("dumbbell")) return "dumbbell";
  if (name.includes("gym")) return "gym_equipment";
  if (name.includes("therapy_equipment")) return "therapy_equipment";
  return null;
}

function buildTemplate(exerciseType, bodyPart, exerciseName) {
  const label = folderNameToLabel(exerciseName);
  const type = exerciseType.toLowerCase();

  const base = {
    title_hpc: label,
    documentation_hpc: label,
    domain_hpc: "exercise",
    priority_hpc: 10,
    body_part: bodyPart,
    equipment: detectEquipment(exerciseName),
  };

  switch (type) {
    case "arom":
      return {
        ...base,
        attribute_type: "arom",
        exercise_type: "arom",
        ...DEFAULTS_AROM,
        default_index: 0,
      };
    case "resistance":
      return {
        ...base,
        attribute_type: "resistance",
        exercise_type: "resistance",
        ...DEFAULTS_RESISTANCE,
        default_index: 0,
      };
    case "stretch":
      return {
        ...base,
        attribute_type: "stretch",
        exercise_type: "stretch",
        ...DEFAULTS_STRETCH,
        default_index: 0,
      };
    case "misc":
      return {
        ...base,
        attribute_type: "misc",
        exercise_type: "misc",
        default_index: 0,
      };
    default:
      return null;
  }
}

async function processExerciseDir(exercisePath, exerciseType, bodyPart) {
  const exerciseName = path.basename(exercisePath);

  const finalFolder = path.join(exercisePath, "final");
  const hasFinal =
    fs.existsSync(finalFolder) && fs.statSync(finalFolder).isDirectory();
  if (!hasFinal) {
    console.warn(`Skipping (no final/ folder): ${exercisePath}`);
    report.warnings.push({
      folder: exercisePath,
      reason: "No final/ folder found",
    });
    return;
  }

  const template = buildTemplate(exerciseType, bodyPart, exerciseName);

  if (template === null) {
    console.warn(
      `Warning: Unknown exercise type "${exerciseType}" at ${exercisePath}`,
    );
    report.warnings.push({
      folder: exercisePath,
      reason: `Unknown exercise type: "${exerciseType}"`,
    });
    return;
  }

  const metaPath = path.join(exercisePath, "meta.json");
  const exists = fs.existsSync(metaPath);

  try {
    await fs.promises.writeFile(metaPath, JSON.stringify(template, null, 2));
    if (exists) {
      console.log(`Overwritten: ${metaPath}`);
      report.overwritten.push(metaPath);
    } else {
      console.log(`Created: ${metaPath}`);
      report.created.push(metaPath);
    }
  } catch (err) {
    console.error(`Error writing ${metaPath}:`, err.message);
    report.errors.push({ file: metaPath, reason: err.message });
  }
}

async function walkExercise() {
  const bodyPartEntries = await fs.promises.readdir(ROOT_DIR, {
    withFileTypes: true,
  });

  for (const bodyPartEntry of bodyPartEntries) {
    if (!bodyPartEntry.isDirectory()) continue;

    const bodyPart = bodyPartEntry.name;
    const bodyPartPath = path.join(ROOT_DIR, bodyPart);

    const exerciseTypeEntries = await fs.promises.readdir(bodyPartPath, {
      withFileTypes: true,
    });

    for (const exerciseTypeEntry of exerciseTypeEntries) {
      if (!exerciseTypeEntry.isDirectory()) continue;

      const exerciseType = exerciseTypeEntry.name;
      const exerciseTypePath = path.join(bodyPartPath, exerciseType);

      const exerciseNameEntries = await fs.promises.readdir(exerciseTypePath, {
        withFileTypes: true,
      });

      for (const exerciseNameEntry of exerciseNameEntries) {
        if (!exerciseNameEntry.isDirectory()) continue;

        const exercisePath = path.join(
          exerciseTypePath,
          exerciseNameEntry.name,
        );
        await processExerciseDir(exercisePath, exerciseType, bodyPart);
      }
    }
  }
}

function writeReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), `report-${timestamp}.md`);

  const lines = [
    `# Meta Generator Report`,
    ``,
    `**Run:** ${new Date().toLocaleString()}`,
    ``,
    `## Created (${report.created.length})`,
    ``,
    ...(report.created.length > 0
      ? report.created.map((f) => `- ${f}`)
      : ["_None_"]),
    ``,
    `## Overwritten (${report.overwritten.length})`,
    ``,
    ...(report.overwritten.length > 0
      ? report.overwritten.map((f) => `- ${f}`)
      : ["_None_"]),
    ``,
    `## Warnings (${report.warnings.length})`,
    ``,
    ...(report.warnings.length > 0
      ? report.warnings.map((w) => `- **${w.folder}** — ${w.reason}`)
      : ["_None_"]),
    ``,
    `## Errors (${report.errors.length})`,
    ``,
    ...(report.errors.length > 0
      ? report.errors.map((e) => `- **${e.file}** — ${e.reason}`)
      : ["_None_"]),
    ``,
  ];

  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`Report saved: ${reportPath}`);
}

walkExercise()
  .then(() => {
    console.log("");
    console.log(`Summary:`);
    console.log(`  Created:     ${report.created.length}`);
    console.log(`  Overwritten: ${report.overwritten.length}`);
    console.log(`  Warnings:    ${report.warnings.length}`);
    console.log(`  Errors:      ${report.errors.length}`);
    writeReport();
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
