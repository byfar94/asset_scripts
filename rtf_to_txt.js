import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT_DIR = "/Users/dwhitty/Documents/Hand_Theracraft/Component_assets";

const report = {
  converted: [],
  errors: [],
};

async function convertRtf(rtfPath) {
  const txtPath = rtfPath.replace(/\.rtf$/i, ".txt");

  try {
    // textutil -convert txt creates a .txt file alongside the .rtf
    await execFileAsync("textutil", ["-convert", "txt", rtfPath]);

    if (!fs.existsSync(txtPath)) {
      throw new Error("textutil ran but .txt file was not created");
    }

    fs.unlinkSync(rtfPath);
    console.log(`Converted: ${rtfPath}`);
    report.converted.push({ from: rtfPath, to: txtPath });
  } catch (err) {
    console.error(`Error converting ${rtfPath}:`, err.message);
    report.errors.push({ file: rtfPath, reason: err.message });
  }
}

async function walkDirectory(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(fullPath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".rtf")) {
      await convertRtf(fullPath);
    }
  }
}

function writeReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), `report-${timestamp}.md`);

  const lines = [
    `# RTF to TXT Conversion Report`,
    ``,
    `**Run:** ${new Date().toLocaleString()}`,
    ``,
    `## Converted (${report.converted.length})`,
    ``,
    ...(report.converted.length > 0
      ? report.converted.map((r) => `- ${r.from} → ${r.to}`)
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

walkDirectory(ROOT_DIR)
  .then(() => {
    console.log("");
    console.log("Summary:");
    console.log(`  Converted: ${report.converted.length}`);
    console.log(`  Errors:    ${report.errors.length}`);
    writeReport();
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
