import "dotenv/config";
import fs from "fs";
import { parseArgs } from "./cli/parser";
import { showHelp } from "./cli/help";
import { detectProject, resolveInputFile } from "./cli/resolver";
import { orchestrator } from "./composition/orchestrator";

/**
 * Entry Point
 * 
 * Responsibilities:
 * 1. Parse CLI arguments
 * 2. Show help if needed
 * 3. Resolve input files
 * 4. Delegate to orchestrator
 */

const args = process.argv.slice(2);
const parsed = parseArgs(args);

if (!parsed) {
  showHelp();
  process.exit(1);
}

const { mode, inputPath } = parsed;

try {
  // Resolve project and input file
  const project = detectProject(inputPath);
  const resolvedFile = resolveInputFile(inputPath, mode);
  const input = fs.readFileSync(resolvedFile, "utf-8");

  console.log(`🎯 Project: ${project}`);
  console.log(`📂 Input: ${resolvedFile}`);
  console.log("");

  // Run orchestrator
  orchestrator({ 
    type: mode as any, 
    input, 
    project, 
    inputFile: resolvedFile 
  })
    .then((result) => {
      console.log("\n--- AI OUTPUT ---\n", JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("\n❌ Error:", error.message);
      process.exit(1);
    });
} catch (error: any) {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
}
