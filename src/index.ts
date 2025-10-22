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

// 디렉티브 파일 찾기 헬퍼 함수
function findLatestDirective(dirPath: string): string | null {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const files = fs.readdirSync(dirPath);
  
  // 1. directive-N.md 파일 찾기 (가장 높은 번호)
  const numberedFiles = files
    .filter(f => f.startsWith("directive-") && f.endsWith(".md"))
    .map(f => {
      const match = f.match(/directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.number - a!.number);

  if (numberedFiles.length > 0) {
    return path.join(dirPath, numberedFiles[0]!.name);
  }

  // 2. directive.md 찾기
  const defaultFile = files.find(f => f === "directive.md");
  if (defaultFile) {
    return path.join(dirPath, defaultFile);
  }

  return null;
}

// Auto-detect input file based on mode
function resolveInputFile(inputPath: string, mode: string): string {
  const stats = fs.statSync(inputPath);
  
  if (stats.isFile()) {
    return inputPath;
  }
  
  if (stats.isDirectory()) {
    switch (mode) {
      case 'arch-learn': {
        const learnDir = path.join(inputPath, "directives", "learn");
        const directiveFile = findLatestDirective(learnDir);
        
        if (!directiveFile) {
          throw new Error(`No directive files found in: ${learnDir}\nCreate either directive.md or directive-N.md`);
        }
        
        console.log(`📄 Using learn directive: ${directiveFile}`);
        return directiveFile;
      }
      
      case 'arch-code': {
        // code 모드는 design 문서를 기본으로 사용하고, 디렉티브가 있으면 추가로 적용
        const designDir = path.join(inputPath, "generated", "design");
        if (!fs.existsSync(designDir)) {
          throw new Error(`No generated/design/ directory found in: ${inputPath}`);
        }
        
        const files = fs.readdirSync(designDir);
        const designFiles = files
          .filter(f => f.startsWith("design-") && f.endsWith(".md"))
          .sort()
          .reverse();
        
        if (designFiles.length === 0) {
          throw new Error(`No design-*.md files found in: ${designDir}`);
        }
        
        const latestDesign = path.join(designDir, designFiles[0]);
        console.log(`📄 Using design file: ${latestDesign}`);
        
        // code 디렉티브 확인 (있으면 로그만)
        const codeDir = path.join(inputPath, "directives", "code");
        const directiveFile = findLatestDirective(codeDir);
        if (directiveFile) {
          console.log(`📄 Found code directive: ${directiveFile}`);
        }
        
        return latestDesign;
      }
      
      default: {
        // arch-design 등 다른 모드는 generated/design/ 찾기
        const designDir = path.join(inputPath, "generated", "design");
        if (!fs.existsSync(designDir)) {
          throw new Error(`No generated/design/ directory found in: ${inputPath}`);
        }
        
        const files = fs.readdirSync(designDir);
        const designFiles = files
          .filter(f => f.startsWith("design-") && f.endsWith(".md"))
          .sort()
          .reverse();
        
        if (designFiles.length === 0) {
          throw new Error(`No design-*.md files found in: ${designDir}`);
        }
        
        const latestDesign = path.join(designDir, designFiles[0]);
        console.log(`📄 Using design file: ${latestDesign}`);
        return latestDesign;
      }
    }
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
const resolvedFile = resolveInputFile(inputPath, mode);
let input = fs.readFileSync(resolvedFile, "utf-8");

console.log(`🎯 Project: ${project}`);
console.log(`📂 Input: ${resolvedFile}`);

// Run pipeline
{
  console.log("");
  
  runPipeline({ type: mode as any, input, project, inputFile: resolvedFile })
    .then((result) => console.log("\n--- AI OUTPUT ---\n", JSON.stringify(result, null, 2)))
    .catch(console.error);
}
