// remove-bg-recursive.mjs
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

const report = {
  completed: [],
  skipped: [],
  warnings: [],
  errors: [],
};

const ROOT_DIR = "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets";
const API_KEY = process.env.REMOVE_BG_API_KEY;

if (!API_KEY) {
  console.error("Missing REMOVE_BG_API_KEY environment variable");
  process.exit(1);
}

function isJpg(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg";
}

function folderExists(folderPath) {
  try {
    return fs.statSync(folderPath).isDirectory();
  } catch {
    return false;
  }
}

function isFolderEmpty(folderPath) {
  if (!folderExists(folderPath)) return true;
  const entries = fs.readdirSync(folderPath).filter((f) => !f.startsWith("."));
  return entries.length === 0;
}

async function removeBackground(inputPath, outputPath) {
  try {
    const fileBuffer = await fs.promises.readFile(inputPath);
    const fileBlob = new Blob([fileBuffer], { type: "image/jpeg" });

    const formData = new FormData();
    formData.append("size", "auto");
    formData.append("format", "jpg");
    formData.append("bg_color", "#FFFFFF");
    formData.append("image_file", fileBlob, path.basename(inputPath));

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const msg = `${response.status} ${errorText}`;
      console.error(`Failed for ${inputPath}: ${msg}`);
      report.errors.push({ file: inputPath, reason: msg });
      return false;
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(outputPath, Buffer.from(arrayBuffer));
    console.log(`Saved: ${outputPath}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${inputPath}:`, error.message);
    report.errors.push({ file: inputPath, reason: error.message });
    return false;
  }
}

async function walkDirectory(currentDir) {
  const entries = await fs.promises.readdir(currentDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (!entry.isDirectory()) continue;

    if (entry.name === "original") {
      const parentFolder = path.dirname(fullPath);
      const bgRemovedFolder = path.join(parentFolder, "bg_removed");

      const originalEntries = await fs.promises.readdir(fullPath, {
        withFileTypes: true,
      });

      const jpgFiles = originalEntries
        .filter((file) => file.isFile() && isJpg(file.name))
        .map((file) => path.join(fullPath, file.name));

      if (jpgFiles.length === 0) {
        console.warn(`Warning: No JPG files in: ${fullPath}`);
        report.warnings.push({
          folder: parentFolder,
          reason: "No JPG files in original folder",
        });
        continue;
      }

      if (!folderExists(bgRemovedFolder)) {
        console.warn(`Warning: ${parentFolder} has no bg_removed folder`);
        report.warnings.push({
          folder: parentFolder,
          reason: "bg_removed folder does not exist",
        });
        continue;
      }

      if (!isFolderEmpty(bgRemovedFolder)) {
        console.log(`Skipping ${parentFolder} because bg_removed is not empty`);
        report.skipped.push({
          folder: parentFolder,
          reason: "bg_removed folder is not empty",
        });
        continue;
      }

      let anyProcessed = false;
      let anyError = false;
      for (const jpgFile of jpgFiles) {
        const outputName = `${path.parse(jpgFile).name}.jpg`;
        const outputPath = path.join(bgRemovedFolder, outputName);

        if (fs.existsSync(outputPath)) {
          console.log(`Skipping existing output: ${outputPath}`);
          continue;
        }

        const success = await removeBackground(jpgFile, outputPath);
        if (success) anyProcessed = true;
        else anyError = true;
      }

      if (anyProcessed && !anyError) {
        console.log(`Completed: ${parentFolder}`);
        report.completed.push(parentFolder);
      } else if (anyError) {
        // errors already logged per-file in removeBackground
      }

      continue;
    }

    // Check for folders that have neither original nor bg_removed
    const hasOriginal = folderExists(path.join(fullPath, "original"));
    const hasBgRemoved = folderExists(path.join(fullPath, "bg_removed"));
    if (!hasOriginal && !hasBgRemoved) {
      // Not a leaf exercise folder — keep recursing
    } else if (!hasOriginal) {
      console.warn(
        `Warning: ${fullPath} has bg_removed but no original folder`,
      );
      report.warnings.push({
        folder: fullPath,
        reason: "Missing original folder",
      });
    } else if (!hasBgRemoved) {
      console.warn(
        `Warning: ${fullPath} has original but no bg_removed folder`,
      );
      report.warnings.push({
        folder: fullPath,
        reason: "Missing bg_removed folder",
      });
    }

    await walkDirectory(fullPath);
  }
}

walkDirectory(ROOT_DIR)
  .then(() => {
    console.log("Done");
    writeReport();
  })
  .catch((error) => {
    console.error("Fatal error:", error);
  });

function writeReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), `report-${timestamp}.md`);

  const lines = [
    `# Background Removal Report`,
    ``,
    `**Run:** ${new Date().toLocaleString()}`,
    ``,
    `## Completed (${report.completed.length})`,
    ``,
    ...(report.completed.length > 0
      ? report.completed.map((f) => `- ${f}`)
      : ["_None_"]),
    ``,
    `## Warnings (${report.warnings.length})`,
    ``,
    ...(report.warnings.length > 0
      ? report.warnings.map((w) => `- **${w.folder}** — ${w.reason}`)
      : ["_None_"]),
    ``,
    `## Skipped (${report.skipped.length})`,
    ``,
    ...(report.skipped.length > 0
      ? report.skipped.map((s) => `- **${s.folder}** — ${s.reason}`)
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
