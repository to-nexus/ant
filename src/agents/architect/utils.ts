import * as path from "path";
import * as fs from "fs";
import { ProjectContext, DirectiveType } from "./types";

export function extractFeatureFolder(inputFile: string | undefined, project: string): string {
  if (!inputFile) return "";
  
  const parts = inputFile.split(path.sep);
  const projectIdx = parts.findIndex(p => p === project);
  if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
    return parts[projectIdx + 1];
  }
  return "";
}

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

export function findLatestDesign(context: ProjectContext): string {
  const designPath = path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder || "default",
    "generated",
    "design"
  );
  
  if (!fs.existsSync(designPath)) return "";
  
  const designFiles = fs.readdirSync(designPath)
    .filter(f => f.startsWith("design-") && f.endsWith(".md"))
    .sort()
    .reverse();
  
  if (designFiles.length === 0) return "";
  
  return fs.readFileSync(path.join(designPath, designFiles[0]), "utf8");
}

export function generateReport(
  type: string,
  context: ProjectContext,
  content: string,
  metadata: Record<string, any> = {}
): string {
  const reportDir = path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder || "default",
    "generated",
    "reports"
  );
  fs.mkdirSync(reportDir, { recursive: true });
  
  const reportFile = path.join(reportDir, `${type}-report-${Date.now()}.md`);
  fs.writeFileSync(reportFile, content, "utf8");
  
  return reportFile;
}