import * as path from "path";
import * as fs from "fs";
import { ProjectContext, DirectiveType, AgentTask } from "./types";

export function extractFeatureFolder(inputFile: string | undefined, project: string): string {
  if (!inputFile) return "";
  
  const parts = inputFile.split(path.sep);
  const projectIdx = parts.findIndex(p => p === project);
  if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
    return parts[projectIdx + 1];
  }
  return "";
}

/**
 * Get directive for a specific task
 * Priority: directive.md > directive-nnn.md (latest)
 */
export function getDirective(context: ProjectContext, task: AgentTask): string | null {
  const directiveDir = path.join(
    context.workingDir,
    "workspace",
    context.project,
    context.featureFolder,
    "inputs/directives",
    task
  );

  if (!fs.existsSync(directiveDir)) {
    return null;
  }

  // 1. Check directive.md (default)
  const defaultPath = path.join(directiveDir, "directive.md");
  if (fs.existsSync(defaultPath)) {
    const content = fs.readFileSync(defaultPath, "utf8").trim();
    return content.length > 0 ? content : null;
  }

  // 2. Find latest directive-nnn.md
  const files = fs.readdirSync(directiveDir)
    .filter(f => /^directive-\d+\.md$/.test(f))
    .map(f => {
      const match = f.match(/^directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter((item): item is { name: string; number: number } => item !== null)
    .sort((a, b) => b.number - a.number);

  if (files.length > 0) {
    const content = fs.readFileSync(path.join(directiveDir, files[0].name), "utf8").trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

// Legacy support - will be removed after migration
export function getDirectivePath(context: ProjectContext, type: DirectiveType): string {
  return path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder,
    "directives",
    type
  );
}

export function readDirective(directivesPath: string, type: DirectiveType): string | null {
  if (!fs.existsSync(directivesPath)) return null;

  const files = fs.readdirSync(directivesPath)
    .filter(f => f.startsWith("directive-") && f.endsWith(".md"))
    .map(f => {
      const match = f.match(/directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter((item): item is {name: string, number: number } => item !== null)
    .sort((a, b) => b.number - a.number);

  if (files.length > 0) {
    const content = fs.readFileSync(path.join(directivesPath, files[0].name), "utf8").trim();
    return content.length > 0 ? content : null;
  }

  const defaultFile = path.join(directivesPath, "directive.md");
  if (fs.existsSync(defaultFile)) {
    const content = fs.readFileSync(defaultFile, "utf8").trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

/**
 * Get source materials (PRD + all resources)
 * Shared by all tasks (design, code, learn)
 */
export function getSource(context: ProjectContext): {
  prd: string;
  figmaLink?: string;
  figmaData?: any;
  wireframes?: string[];
  [key: string]: any;
} {
  const sourceDir = path.join(
    context.workingDir,
    "workspace",
    context.project,
    context.featureFolder,
    "inputs/sources"
  );

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  // prd.md is required
  const prdPath = path.join(sourceDir, "prd.md");
  if (!fs.existsSync(prdPath)) {
    throw new Error("prd.md not found in source directory");
  }
  const prd = fs.readFileSync(prdPath, "utf8");

  const result: any = { prd };

  // Optional: Figma link
  const figmaPath = path.join(sourceDir, "figma-link.txt");
  if (fs.existsSync(figmaPath)) {
    result.figmaLink = fs.readFileSync(figmaPath, "utf8").trim();
  }

  // Optional: Figma export
  const figmaExportPath = path.join(sourceDir, "figma-export.json");
  if (fs.existsSync(figmaExportPath)) {
    result.figmaData = JSON.parse(fs.readFileSync(figmaExportPath, "utf8"));
  }

  // Optional: Wireframes
  const wireframesDir = path.join(sourceDir, "wireframes");
  if (fs.existsSync(wireframesDir)) {
    result.wireframes = fs.readdirSync(wireframesDir)
      .filter(f => /\.(png|jpg|jpeg|svg|gif)$/i.test(f))
      .map(f => path.join(wireframesDir, f));
  }

  return result;
}

/**
 * Find latest design document
 */
export function findLatestDesign(context: ProjectContext): string {
  const designPath = path.join(
    context.workingDir,
    "workspace",
    context.project,
    context.featureFolder || "default",
    "outputs/design"
  );
  
  if (!fs.existsSync(designPath)) return "";
  
  const designFiles = fs.readdirSync(designPath)
    .filter(f => f.startsWith("design-") && f.endsWith(".md"))
    .sort()
    .reverse();
  
  if (designFiles.length === 0) return "";
  
  return fs.readFileSync(path.join(designPath, designFiles[0]), "utf8");
}

/**
 * Generate and save report
 */
export function generateReport(
  type: string,
  context: ProjectContext,
  content: string,
  metadata: Record<string, any> = {}
): string {
  const reportDir = path.join(
    context.workingDir,
    "workspace",
    context.project,
    context.featureFolder || "default",
    "outputs/reports"
  );
  fs.mkdirSync(reportDir, { recursive: true });
  
  const reportFile = path.join(reportDir, `${type}-report-${Date.now()}.md`);
  fs.writeFileSync(reportFile, content, "utf8");
  
  return reportFile;
}