import "dotenv/config";
import { runPipeline } from "./orchestrator";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const mode = args[0];
const inputPath = args[1];

// Check for --directive option and optional directive file path
let directiveFilePath: string | null = null;
let hasDirective = false;
const directiveIdx = args.indexOf("--directive");
if (directiveIdx >= 0) {
  hasDirective = true;
  // Check if next arg is a file path (not starting with --)
  if (directiveIdx + 1 < args.length && !args[directiveIdx + 1].startsWith("--")) {
    directiveFilePath = args[directiveIdx + 1];
  }
}

if (!mode || !inputPath) {
  console.error("Usage:");
  console.error("  pnpm tsx src/index.ts <mode> <inputPath> [options]");
  console.error("");
  console.error("Modes:");
  console.error("  arch-design     - PRD → System design document");
  console.error("  arch-code       - Design doc → Code (staged, with learning & report)");
  console.error("  feedback        - Design directive → ChromaDB");
  console.error("  review          - Code review");
  console.error("");
  console.error("Options:");
  console.error("  --directive [file] - Apply directive (auto-detect latest or use specified file)");
  console.error("");
  console.error("Examples:");
  console.error("  # Generate design from PRD");
  console.error("  pnpm tsx src/index.ts arch-design projects/cross-ramp/feature-ui-1.2.0/prd/spec.md");
  console.error("");
  console.error("  # Generate code (always with learning & report)");
  console.error("  pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0");
  console.error("  pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0 --directive  # with latest code-directive");
  console.error("");
  console.error("  # Process design directive");
  console.error("  pnpm tsx src/index.ts feedback projects/cross-ramp/feature-ui-1.2.0 --directive");
  console.error("  echo 'Use Zustand' | pnpm tsx src/index.ts feedback projects/cross-ramp/feature-ui-1.2.0");
  console.error("");
  console.error("Note: arch-code ALWAYS learns and generates reports");
  process.exit(1);
}

// Auto-detect project name from path (e.g., projects/cross-ramp/... → cross-ramp)
function detectProject(inputPath: string): string {
  const parts = inputPath.split(path.sep);
  const projectsIdx = parts.indexOf("projects");
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    return parts[projectsIdx + 1];
  }
  return "default";
}

// Auto-detect design file if inputPath is a directory
function resolveInputFile(inputPath: string): string {
  const stats = fs.statSync(inputPath);
  
  if (stats.isFile()) {
    return inputPath;
  }
  
  if (stats.isDirectory()) {
    // Look for generated/design/design-*.md files
    const designDir = path.join(inputPath, "generated", "design");
    
    if (!fs.existsSync(designDir)) {
      throw new Error(`No generated/design/ directory found in: ${inputPath}`);
    }
    
    const files = fs.readdirSync(designDir);
    const designFiles = files
      .filter(f => f.startsWith("design-") && f.endsWith(".md"))
      .sort()
      .reverse(); // Latest first (timestamp in filename)
    
    if (designFiles.length === 0) {
      throw new Error(`No design-*.md files found in: ${designDir}`);
    }
    
    const latestDesign = path.join(designDir, designFiles[0]);
    console.log(`📄 Auto-detected design file: ${latestDesign}`);
    return latestDesign;
  }
  
  throw new Error(`Invalid input path: ${inputPath}`);
}

// Auto-detect latest design directive file from directives/ directory
function resolveLatestDesignDirective(inputPath: string): string | null {
  const directivesDir = path.join(inputPath, "directives");
  
  if (!fs.existsSync(directivesDir)) {
    return null;
  }
  
  const files = fs.readdirSync(directivesDir);
  const directiveFiles = files
    .filter(f => f.startsWith("design-directive-") && f.endsWith(".md"))
    .map(f => {
      // Extract number from design-directive-N.md
      const match = f.match(/design-directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.number - a!.number); // Sort by number descending
  
  if (directiveFiles.length === 0) {
    return null;
  }
  
  const latestDirective = path.join(directivesDir, directiveFiles[0]!.name);
  console.log(`📋 Auto-detected design directive file: ${latestDirective}`);
  return latestDirective;
}

const project = detectProject(inputPath);
const resolvedFile = resolveInputFile(inputPath);
let input = fs.readFileSync(resolvedFile, "utf-8");

console.log(`🎯 Project: ${project}`);
console.log(`📂 Input: ${resolvedFile}`);

// Handle --directive option for design review
if (mode === "feedback") {
  if (hasDirective) {
    let directiveFile: string | null;
    
    if (directiveFilePath) {
      // Use specified directive file
      if (!fs.existsSync(directiveFilePath)) {
        console.error(`❌ Directive file not found: ${directiveFilePath}`);
        process.exit(1);
      }
      directiveFile = directiveFilePath;
      console.log(`📋 Using specified design directive file: ${directiveFile}`);
    } else {
      // Auto-detect latest design directive file
      directiveFile = resolveLatestDesignDirective(inputPath);
      
      if (!directiveFile) {
        console.error(`❌ No design-directive-*.md files found in: ${path.join(inputPath, "directives")}`);
        console.error(`💡 Create a directive file: projects/<project>/<feature>/directives/design-directive-1.md`);
        process.exit(1);
      }
    }
    
    const directiveText = fs.readFileSync(directiveFile, "utf-8");
    console.log(`📋 Design directive: ${directiveText.substring(0, 100)}...`);
    console.log("");
    
    runPipeline({ 
      type: "feedback" as any, 
      input: directiveText, 
      project, 
      inputFile: resolvedFile 
    })
      .then((result) => console.log("\n--- AI OUTPUT ---\n", JSON.stringify(result, null, 2)))
      .catch(console.error);
  } else {
    // Read from stdin
    console.log("📋 Reading design directive from stdin...");
    const stdinBuffer = fs.readFileSync(0, "utf-8");
    const directiveText = stdinBuffer.trim();
    
    if (!directiveText) {
      console.error("❌ No directive provided via stdin");
      process.exit(1);
    }
    
    console.log(`📋 Directive: ${directiveText.substring(0, 100)}...`);
    console.log("");
    
    runPipeline({ 
      type: "feedback" as any, 
      input: directiveText, 
      project, 
      inputFile: resolvedFile 
    })
      .then((result) => console.log("\n--- AI OUTPUT ---\n", JSON.stringify(result, null, 2)))
      .catch(console.error);
  }
} else {
  console.log("");
  
  runPipeline({ type: mode as any, input, project, inputFile: resolvedFile })
    .then((result) => console.log("\n--- AI OUTPUT ---\n", JSON.stringify(result, null, 2)))
    .catch(console.error);
}
